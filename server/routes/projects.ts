import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso, parseJson } from '../db'
import { projectIdsForUser } from '../auth'
import {
  assertRole, assertEntityAccess, HttpError, isAdminOf, loadProject, memberRow,
  projectSummaries, requireProjectAdmin, resolveEntity,
} from '../scope'
import { audit, notify, projectMemberIds } from '../lib'
import { publicUser } from './auth'

export const projectRoutes = new Hono<AppEnv>()

const DEFAULT_COLUMNS = ['Backlog', 'Rencana', 'Sedang Berjalan', 'Selesai']
const DEFAULT_KPIS = [
  { label: 'Target Sasaran', unit: 'orang', target_value: 100, current_value: 0 },
  { label: 'Kegiatan Terlaksana', unit: 'kegiatan', target_value: 12, current_value: 0 },
]

projectRoutes.get('/projects', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const includeArchived = c.req.query('archived') === '1'
  const search = (c.req.query('q') ?? '').trim().toLowerCase()
  const status = c.req.query('status') ?? ''
  const category = c.req.query('category') ?? ''
  const ids = await projectIdsForUser(c.env.DB, user, entity.id)
  let list = await projectSummaries(c.env, user, entity.id, ids)
  if (!includeArchived) list = list.filter((p) => !p.archived_at)
  if (status) list = list.filter((p) => p.status === status)
  if (category) list = list.filter((p) => p.category === category)
  if (search) {
    list = list.filter(
      (p) =>
        p.title.toLowerCase().includes(search) ||
        p.code.toLowerCase().includes(search) ||
        (p.location_text ?? '').toLowerCase().includes(search) ||
        (p.pic_name ?? '').toLowerCase().includes(search),
    )
  }
  const categories = [...new Set(list.map((p) => p.category))].sort()
  return c.json({ projects: list, categories, entity })
})

projectRoutes.post('/projects', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const body = await c.req.json().catch(() => ({}))
  const entityId = user.role === 'MA'
    ? (body.entityId ?? (await resolveEntity(c.env, c, user)).id)
    : user.entity_id!
  assertEntityAccess(c.env, user, entityId)
  const title = String(body.title ?? '').trim()
  const code = String(body.code ?? '').trim().toUpperCase()
  const category = String(body.category ?? '').trim() || 'Umum'
  if (!title || !code) return c.json({ error: 'Judul dan kode proyek wajib diisi.' }, 400)
  const dupe = await one<any>(c.env.DB, `SELECT id FROM projects WHERE entity_id = ? AND code = ? AND deleted_at IS NULL`, entityId, code)
  if (dupe) return c.json({ error: `Kode proyek ${code} sudah dipakai di entitas ini.` }, 409)
  const id = uid('prj_')
  const ts = nowIso()
  await run(
    c.env.DB,
    `INSERT INTO projects (id, entity_id, code, title, category, description, location_text, cover_id, progress, status,
      start_date, end_date, visibility, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, entityId, code, title, category, body.description ?? null, body.locationText ?? null,
    body.coverId ?? null, Number(body.progress ?? 0), body.status ?? 'Berjalan',
    body.startDate ?? null, body.endDate ?? null, body.visibility === 'entity' ? 'entity' : 'team',
    user.id, ts, ts,
  )
  for (const [i, name] of DEFAULT_COLUMNS.entries()) {
    await run(
      c.env.DB,
      `INSERT INTO boards (id, project_id, name, position, is_done) VALUES (?,?,?,?,?)`,
      uid('brd_'), id, name, i, i === DEFAULT_COLUMNS.length - 1 ? 1 : 0,
    )
  }
  for (const [i, kpi] of DEFAULT_KPIS.entries()) {
    await run(
      c.env.DB,
      `INSERT INTO project_kpis (id, project_id, label, unit, target_value, current_value, position) VALUES (?,?,?,?,?,?,?)`,
      uid('kpi_'), id, kpi.label, kpi.unit, kpi.target_value, kpi.current_value, i,
    )
  }
  await run(
    c.env.DB,
    `INSERT INTO budgets (project_id, amount, is_confirmed, visibility, updated_by, updated_at) VALUES (?,?,?,?,?,?)`,
    id, 0, 0, 'team', user.id, ts,
  )
  const paIds: string[] = Array.isArray(body.paIds) ? body.paIds : []
  for (const paId of paIds) {
    await run(
      c.env.DB,
      `INSERT OR IGNORE INTO project_members (id, project_id, user_id, access, is_primary_pic, added_by, created_at) VALUES (?,?,?,?,?,?,?)`,
      uid('pmm_'), id, paId, 'admin', 0, user.id, ts,
    )
  }
  if (body.primaryPicId) {
    const exists = await memberRow(c.env, body.primaryPicId, id)
    if (!exists) {
      await run(
        c.env.DB,
        `INSERT OR IGNORE INTO project_members (id, project_id, user_id, access, is_primary_pic, added_by, created_at) VALUES (?,?,?,?,?,?,?)`,
        uid('pmm_'), id, body.primaryPicId, 'admin', 1, user.id, ts,
      )
    } else {
      await run(c.env.DB, `UPDATE project_members SET is_primary_pic = 1 WHERE id = ?`, exists.id)
    }
    await notify(c.env, {
      userIds: [body.primaryPicId], type: 'project.pic', title: 'Anda ditunjuk sebagai PIC utama',
      body: `Proyek ${title} (${code})`, link: `/app/projects/${id}`, entityId, projectId: id,
      dedupeKey: `pic:${id}:${body.primaryPicId}`,
    })
  }
  for (const paId of paIds) {
    await notify(c.env, {
      userIds: [paId], type: 'project.assigned', title: 'Anda ditambahkan ke proyek',
      body: `${title} (${code})`, link: `/app/projects/${id}`, entityId, projectId: id,
      dedupeKey: `assign:${id}:${paId}`,
    })
  }
  await audit(c.env, user, 'project.created', 'project', id, `Membuat proyek ${title} (${code})`, entityId)
  const project = await one<any>(c.env.DB, `SELECT * FROM projects WHERE id = ?`, id)
  return c.json({ project })
})

projectRoutes.get('/projects/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { project, member } = await loadProject(c.env, user, id)
  const [entity, members, kpis, budget] = await Promise.all([
    one<any>(c.env.DB, `SELECT * FROM entities WHERE id = ?`, project.entity_id),
    q<any>(
      c.env.DB,
      `SELECT m.id AS membership_id, m.access, m.is_primary_pic, m.created_at AS joined_at,
        u.id, u.name, u.email, u.role, u.job_title, u.avatar_id, u.entity_id
       FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? ORDER BY m.is_primary_pic DESC, u.name`,
      id,
    ),
    q<any>(c.env.DB, `SELECT * FROM project_kpis WHERE project_id = ? ORDER BY position`, id),
    one<any>(c.env.DB, `SELECT * FROM budgets WHERE project_id = ?`, id),
  ])
  const counts = await one<any>(
    c.env.DB,
    `SELECT
       (SELECT COUNT(*) FROM tasks WHERE project_id = ?) AS tasks,
       (SELECT COUNT(*) FROM locations WHERE project_id = ?) AS locations,
       (SELECT COUNT(*) FROM logbooks WHERE project_id = ?) AS logbooks,
       (SELECT COUNT(*) FROM notes WHERE project_id = ?) AS notes,
       (SELECT COUNT(*) FROM data_records WHERE project_id = ?) AS records`,
    id, id, id, id, id,
  )
  const canSeeBudget =
    isAdminOf(user, project, member) || member || (budget && budget.visibility === 'entity')
  return c.json({
    project: {
      ...project,
      cover_url: project.cover_id ? `/api/files/${project.cover_id}` : null,
      is_member: !!member,
      can_manage: isAdminOf(user, project, member),
      can_contribute: !!member || user.role === 'SA' || user.role === 'MA',
      can_see_budget: !!canSeeBudget,
      is_primary_pic: !!member?.is_primary_pic,
    },
    members: members.map((m) => ({ ...m, avatar_id: m.avatar_id, avatar_url: m.avatar_id ? `/api/files/${m.avatar_id}` : null })),
    kpis,
    budget: canSeeBudget ? budget : null,
    counts,
    entity,
  })
})

projectRoutes.patch('/projects/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { project, member } = await loadProject(c.env, user, id)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat mengubah proyek ini.')
  const body = await c.req.json().catch(() => ({}))
  const fields: string[] = []
  const values: any[] = []
  const map: Record<string, string> = {
    title: 'title', code: 'code', category: 'category', description: 'description',
    locationText: 'location_text', coverId: 'cover_id', status: 'status', startDate: 'start_date',
    endDate: 'end_date', visibility: 'visibility',
  }
  for (const [key, column] of Object.entries(map)) {
    if (body[key] !== undefined) {
      fields.push(`${column} = ?`)
      values.push(body[key] === null ? null : String(body[key]))
    }
  }
  if (body.progress !== undefined) {
    fields.push('progress = ?')
    values.push(Math.max(0, Math.min(100, Number(body.progress))))
  }
  if (!fields.length) return c.json({ error: 'Tidak ada perubahan.' }, 400)
  fields.push('updated_at = ?')
  values.push(nowIso())
  await run(c.env.DB, `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, ...values, id)
  await audit(c.env, user, 'project.updated', 'project', id, `Memperbarui proyek ${project.title}`, project.entity_id, body)
  const updated = await one<any>(c.env.DB, `SELECT * FROM projects WHERE id = ?`, id)
  return c.json({ project: updated })
})

projectRoutes.post('/projects/:id/archive', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { project, member } = await loadProject(c.env, user, id)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const archived = body.archived ? nowIso() : null
  await run(c.env.DB, `UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?`, archived, nowIso(), id)
  await audit(
    c.env, user, archived ? 'project.archived' : 'project.restored', 'project', id,
    `${archived ? 'Mengarsipkan' : 'Mengaktifkan kembali'} proyek ${project.title}`, project.entity_id,
  )
  return c.json({ ok: true, archived: !!archived })
})

projectRoutes.delete('/projects/:id', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const id = c.req.param('id')
  const { project } = await loadProject(c.env, user, id)
  await run(c.env.DB, `UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), id)
  await audit(c.env, user, 'project.deleted', 'project', id, `Menghapus proyek ${project.title} (soft delete)`, project.entity_id)
  return c.json({ ok: true })
})

projectRoutes.post('/projects/:id/members', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { project } = await requireProjectAdmin(c.env, user, id)
  const body = await c.req.json().catch(() => ({}))
  const userId = String(body.userId ?? '')
  const target = await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ? AND is_active = 1`, userId)
  if (!target) return c.json({ error: 'Pengguna tidak ditemukan.' }, 404)
  if (target.role !== 'MA' && target.entity_id !== project.entity_id) {
    return c.json({ error: 'Pengguna berasal dari entitas lain.' }, 400)
  }
  const existing = await memberRow(c.env, userId, id)
  if (existing) return c.json({ error: 'Pengguna sudah menjadi anggota proyek.' }, 409)
  const makePic = !!body.isPrimaryPic
  if (makePic) {
    const currentPic = await one<any>(
      c.env.DB,
      `SELECT m.id, u.name FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? AND m.is_primary_pic = 1`,
      id,
    )
    if (currentPic && currentPic.name !== target.name && body.confirmReplace !== true) {
      return c.json({ error: `PIC utama saat ini adalah ${currentPic.name}. Konfirmasi pergantian PIC diperlukan.`, code: 'PIC_CONFIRM_REQUIRED' }, 409)
    }
    await run(c.env.DB, `UPDATE project_members SET is_primary_pic = 0 WHERE project_id = ?`, id)
  }
  await run(
    c.env.DB,
    `INSERT INTO project_members (id, project_id, user_id, access, is_primary_pic, added_by, created_at) VALUES (?,?,?,?,?,?,?)`,
    uid('pmm_'), id, userId, body.access === 'admin' || target.role === 'PA' ? 'admin' : 'member',
    makePic ? 1 : 0, user.id, nowIso(),
  )
  await notify(c.env, {
    userIds: [userId],
    type: makePic ? 'project.pic' : 'project.assigned',
    title: makePic ? 'Anda ditunjuk sebagai PIC utama' : 'Anda ditambahkan ke proyek',
    body: `${project.title} (${project.code})`,
    link: `/app/projects/${id}`,
    entityId: project.entity_id,
    projectId: id,
    dedupeKey: `${makePic ? 'pic' : 'assign'}:${id}:${userId}:${Date.now()}`,
  })
  await audit(c.env, user, 'project.member_added', 'project', id, `Menambahkan ${target.name} ke ${project.title}`, project.entity_id)
  return c.json({ ok: true })
})

projectRoutes.patch('/projects/:id/members/:memberId', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { project } = await requireProjectAdmin(c.env, user, id)
  const body = await c.req.json().catch(() => ({}))
  const membership = await one<any>(c.env.DB, `SELECT * FROM project_members WHERE id = ? AND project_id = ?`, c.req.param('memberId'), id)
  if (!membership) return c.json({ error: 'Keanggotaan tidak ditemukan.' }, 404)
  const target = await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ?`, membership.user_id)
  if (body.isPrimaryPic === true && !membership.is_primary_pic) {
    const currentPic = await one<any>(
      c.env.DB,
      `SELECT m.id, u.name FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? AND m.is_primary_pic = 1`,
      id,
    )
    if (currentPic && body.confirmReplace !== true) {
      return c.json({ error: `PIC utama saat ini adalah ${currentPic.name}. Konfirmasi pergantian PIC diperlukan.`, code: 'PIC_CONFIRM_REQUIRED' }, 409)
    }
    await run(c.env.DB, `UPDATE project_members SET is_primary_pic = 0 WHERE project_id = ?`, id)
  }
  if (body.access) {
    await run(c.env.DB, `UPDATE project_members SET access = ? WHERE id = ?`, body.access === 'admin' ? 'admin' : 'member', membership.id)
  }
  if (body.isPrimaryPic !== undefined) {
    await run(c.env.DB, `UPDATE project_members SET is_primary_pic = ? WHERE id = ?`, body.isPrimaryPic ? 1 : 0, membership.id)
    if (body.isPrimaryPic) {
      await notify(c.env, {
        userIds: [membership.user_id], type: 'project.pic', title: 'Anda ditunjuk sebagai PIC utama',
        body: `${project.title} (${project.code})`, link: `/app/projects/${id}`,
        entityId: project.entity_id, projectId: id, dedupeKey: `pic:${id}:${membership.user_id}:${Date.now()}`,
      })
    }
  }
  await audit(c.env, user, 'project.member_updated', 'project', id, `Memperbarui keanggotaan ${target?.name ?? ''}`, project.entity_id)
  return c.json({ ok: true })
})

projectRoutes.delete('/projects/:id/members/:memberId', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { project } = await requireProjectAdmin(c.env, user, id)
  const membership = await one<any>(c.env.DB, `SELECT * FROM project_members WHERE id = ? AND project_id = ?`, c.req.param('memberId'), id)
  if (!membership) return c.json({ error: 'Keanggotaan tidak ditemukan.' }, 404)
  // Access is revoked; historical work (notes, logbooks, photos, tasks) is preserved
  // because all content rows are owned by ids, never cascaded from membership.
  await run(c.env.DB, `DELETE FROM project_members WHERE id = ?`, membership.id)
  const target = await one<any>(c.env.DB, `SELECT name FROM users WHERE id = ?`, membership.user_id)
  await notify(c.env, {
    userIds: [membership.user_id], type: 'project.removed', title: 'Akses proyek dicabut',
    body: `${project.title} (${project.code})`, link: '/app/projects',
    entityId: project.entity_id, projectId: id,
    dedupeKey: `remove:${id}:${membership.user_id}:${Date.now()}`,
  })
  await audit(c.env, user, 'project.member_removed', 'project', id, `Mencabut akses ${target?.name ?? ''} dari ${project.title}`, project.entity_id)
  return c.json({ ok: true })
})

projectRoutes.get('/projects/:id/members/candidates', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { project } = await requireProjectAdmin(c.env, user, id)
  const rows = await q<any>(
    c.env.DB,
    `SELECT u.id, u.name, u.email, u.role, u.job_title, u.avatar_id FROM users u
     WHERE u.is_active = 1 AND (u.entity_id = ? OR u.role = 'MA')
       AND u.id NOT IN (SELECT user_id FROM project_members WHERE project_id = ?)
     ORDER BY u.name`,
    project.entity_id, id,
  )
  return c.json({ users: rows })
})

projectRoutes.post('/projects/:id/kpis', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { project } = await requireProjectAdmin(c.env, user, id)
  const body = await c.req.json().catch(() => ({}))
  const label = String(body.label ?? '').trim()
  if (!label) return c.json({ error: 'Nama indikator wajib diisi.' }, 400)
  const count = await one<any>(c.env.DB, `SELECT COUNT(*) AS n FROM project_kpis WHERE project_id = ?`, id)
  const kpiId = uid('kpi_')
  await run(
    c.env.DB,
    `INSERT INTO project_kpis (id, project_id, label, unit, target_value, current_value, position) VALUES (?,?,?,?,?,?,?)`,
    kpiId, id, label, body.unit ?? null, Number(body.targetValue ?? 0), Number(body.currentValue ?? 0), count?.n ?? 0,
  )
  await audit(c.env, user, 'project.kpi_added', 'project', id, `Menambah indikator ${label}`, project.entity_id)
  return c.json({ kpi: await one<any>(c.env.DB, `SELECT * FROM project_kpis WHERE id = ?`, kpiId) })
})

projectRoutes.patch('/kpis/:kpiId', async (c) => {
  const user = c.get('user')
  const kpi = await one<any>(c.env.DB, `SELECT * FROM project_kpis WHERE id = ?`, c.req.param('kpiId'))
  if (!kpi) return c.json({ error: 'Indikator tidak ditemukan.' }, 404)
  const { project } = await requireProjectAdmin(c.env, user, kpi.project_id)
  const body = await c.req.json().catch(() => ({}))
  await run(
    c.env.DB,
    `UPDATE project_kpis SET label = ?, unit = ?, target_value = ?, current_value = ? WHERE id = ?`,
    body.label ?? kpi.label, body.unit ?? kpi.unit,
    body.targetValue !== undefined ? Number(body.targetValue) : kpi.target_value,
    body.currentValue !== undefined ? Number(body.currentValue) : kpi.current_value,
    kpi.id,
  )
  await audit(c.env, user, 'project.kpi_updated', 'project', project.id, `Memperbarui indikator ${body.label ?? kpi.label}`, project.entity_id)
  return c.json({ ok: true })
})

projectRoutes.delete('/kpis/:kpiId', async (c) => {
  const user = c.get('user')
  const kpi = await one<any>(c.env.DB, `SELECT * FROM project_kpis WHERE id = ?`, c.req.param('kpiId'))
  if (!kpi) return c.json({ error: 'Indikator tidak ditemukan.' }, 404)
  await requireProjectAdmin(c.env, user, kpi.project_id)
  await run(c.env.DB, `DELETE FROM project_kpis WHERE id = ?`, kpi.id)
  return c.json({ ok: true })
})
