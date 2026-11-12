import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { HttpError, isAdminOf, loadProject, projectSummaries, resolveEntity } from '../scope'
import { projectIdsForUser } from '../auth'
import { audit, notify, projectMemberIds } from '../lib'

export const budgetRoutes = new Hono<AppEnv>()

budgetRoutes.get('/projects/:id/budget', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  const budget = await one<any>(c.env.DB, `SELECT * FROM budgets WHERE project_id = ?`, project.id)
  const canSee = isAdminOf(user, project, member) || !!member || (budget?.visibility === 'entity')
  if (!canSee) return c.json({ error: 'Anggaran proyek ini bersifat khusus tim.' }, 403)
  const editable = isAdminOf(user, project, member)
  const history = await q<any>(
    c.env.DB,
    `SELECT h.*, u.name AS changed_by_name FROM budget_history h
     LEFT JOIN users u ON u.id = h.changed_by WHERE h.project_id = ? ORDER BY h.changed_at DESC LIMIT 30`,
    project.id,
  )
  return c.json({
    budget: budget ? { ...budget, is_confirmed: !!budget.is_confirmed } : null,
    history,
    can_edit: editable,
    note: budget?.is_confirmed
      ? 'Anggaran terkonfirmasi dihitung pada total resmi.'
      : 'Anggaran tersimpan sebagai usulan dan tidak dihitung pada total resmi.',
  })
})

budgetRoutes.put('/projects/:id/budget', async (c) => {
  const user = c.get('user')
  const { project } = await loadProject(c.env, user, c.req.param('id'))
  const member = null
  const existing = await one<any>(c.env.DB, `SELECT * FROM budgets WHERE project_id = ?`, project.id)
  const canEdit =
    user.role === 'MA' ||
    (user.role === 'SA' && user.entity_id === project.entity_id) ||
    (await one<any>(c.env.DB, `SELECT * FROM project_members WHERE project_id = ? AND user_id = ? AND (access = 'admin' OR is_primary_pic = 1)`, project.id, user.id))
  if (!canEdit) throw new HttpError(403, 'Hanya PIC/PA proyek atau admin entitas yang dapat mengubah anggaran.')
  const body = await c.req.json().catch(() => ({}))
  const amount = Math.max(0, Number(body.amount ?? 0))
  if (!Number.isFinite(amount)) return c.json({ error: 'Nominal anggaran tidak valid.' }, 400)
  const confirmed = !!body.isConfirmed
  const visibility = body.visibility === 'entity' ? 'entity' : 'team'
  const wasConfirmed = existing?.is_confirmed === 1
  const changesConfirmed = wasConfirmed && (Number(existing?.amount ?? 0) !== amount || !confirmed)
  if (changesConfirmed && body.confirmReconfirm !== true) {
    return c.json({
      error: 'Nominal anggaran yang sudah pasti berubah. Konfirmasi ulang diperlukan.',
      code: 'BUDGET_RECONFIRM_REQUIRED',
      current: { amount: existing?.amount ?? 0, isConfirmed: true },
    }, 409)
  }
  const ts = nowIso()
  if (existing) {
    await run(
      c.env.DB,
      `UPDATE budgets SET amount = ?, is_confirmed = ?, visibility = ?, updated_by = ?, updated_at = ? WHERE project_id = ?`,
      amount, confirmed ? 1 : 0, visibility, user.id, ts, project.id,
    )
  } else {
    await run(
      c.env.DB,
      `INSERT INTO budgets (project_id, amount, is_confirmed, visibility, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
      project.id, amount, confirmed ? 1 : 0, visibility, user.id, ts,
    )
  }
  await run(
    c.env.DB,
    `INSERT INTO budget_history (id, project_id, amount, is_confirmed, visibility, note, changed_by, changed_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    uid('bhx_'), project.id, amount, confirmed ? 1 : 0, visibility, body.note ?? null, user.id, ts,
  )
  if (existing && Number(existing.amount) !== amount) {
    for (const memberId of await projectMemberIds(c.env, project.id)) {
      if (memberId === user.id) continue
      await notify(c.env, {
        userIds: [memberId], type: 'budget.updated', title: 'Anggaran proyek diperbarui',
        body: `${project.title}`, link: `/app/projects/${project.id}?tab=budget`,
        entityId: project.entity_id, projectId: project.id,
        dedupeKey: `budget:${project.id}:${ts}`,
      })
    }
  }
  await audit(
    c.env, user, 'budget.updated', 'project', project.id,
    `Memperbarui anggaran ${project.title}: Rp${amount.toLocaleString('id-ID')} (${confirmed ? 'pasti' : 'belum pasti'})`,
    project.entity_id,
  )
  return c.json({ ok: true, budget: await one<any>(c.env.DB, `SELECT * FROM budgets WHERE project_id = ?`, project.id) })
})

budgetRoutes.get('/budget/summary', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const ids = await projectIdsForUser(c.env.DB, user, entity.id)
  const rows = await projectSummaries(c.env, user, entity.id, ids)
  const confirmedTotal = rows.reduce((sum, r) => sum + (r.budget_amount ?? 0), 0)
  const provisionalTotal = rows.reduce((sum, r) => {
    if (r.budget_confirmed) return sum
    const include = r.is_member || user.role === 'SA' || user.role === 'MA' || r.budget_visibility === 'entity'
    return include ? sum + (r.budget_amount ?? 0) : sum
  }, 0)
  return c.json({
    confirmedTotal,
    provisionalTotal,
    byCategory: Object.entries(
      rows.reduce<Record<string, number>>((acc, r) => {
        if (r.budget_amount) acc[r.category] = (acc[r.category] ?? 0) + r.budget_amount
        return acc
      }, {}),
    ).map(([category, amount]) => ({ category, amount })),
  })
})
