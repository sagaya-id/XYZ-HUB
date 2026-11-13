import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { HttpError, loadProject, resolveEntity } from '../scope'
import { audit } from '../lib'
import {
  buildAutoReminders, getLeadDays, getManualReminders, jakartaToday,
} from '../reminders'

export const reminderRoutes = new Hono<AppEnv>()

const MIN_LEAD = 0
const MAX_LEAD = 30

function clampLead(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 3
  return Math.min(MAX_LEAD, Math.max(MIN_LEAD, Math.round(parsed)))
}

reminderRoutes.get('/reminders', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const leadDays = await getLeadDays(c.env, user.id)
  const [auto, manual] = await Promise.all([
    buildAutoReminders(c.env, user, entity, leadDays),
    getManualReminders(c.env, user.id, entity.id),
  ])
  const items = [...auto, ...manual].sort((a, b) =>
    `${a.done ? '1' : '0'}${a.date}${a.time ?? '00:00'}`.localeCompare(`${b.done ? '1' : '0'}${b.date}${b.time ?? '00:00'}`),
  )
  return c.json({
    items,
    leadDays,
    today: jakartaToday(),
    counts: {
      total: items.length,
      event: auto.filter((item) => item.source === 'event').length,
      task: auto.filter((item) => item.source === 'task').length,
      project: auto.filter((item) => item.source === 'project').length,
      manual: manual.length,
      done: items.filter((item) => item.done).length,
    },
    entity,
  })
})

reminderRoutes.put('/reminders/settings', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const leadDays = clampLead(body.leadDays)
  await run(
    c.env.DB,
    `INSERT INTO reminder_settings (user_id, lead_days, updated_at) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET lead_days = excluded.lead_days, updated_at = excluded.updated_at`,
    user.id, leadDays, nowIso(),
  )
  return c.json({ leadDays })
})

reminderRoutes.post('/reminders', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const body = await c.req.json().catch(() => ({}))
  const title = String(body.title ?? '').trim()
  if (!title) return c.json({ error: 'Judul pengingat wajib diisi.' }, 400)
  const remindAt = String(body.remindAt ?? '').slice(0, 16)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(remindAt)) {
    return c.json({ error: 'Tanggal dan waktu pengingat tidak valid.' }, 400)
  }
  let projectId: string | null = null
  if (body.projectId) {
    const { project } = await loadProject(c.env, user, String(body.projectId))
    projectId = project.id
  }
  const id = uid('rmd_')
  await run(
    c.env.DB,
    `INSERT INTO reminders (id, user_id, entity_id, project_id, title, body, remind_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, user.id, entity.id, projectId, title, body.body ? String(body.body) : null, remindAt, nowIso(),
  )
  await audit(c.env, user, 'reminder.created', 'reminder', id, `Menambah pengingat manual "${title}"`, entity.id)
  return c.json({
    reminder: await one<any>(c.env.DB, `SELECT * FROM reminders WHERE id = ?`, id),
  })
})

reminderRoutes.post('/reminders/:id/done', async (c) => {
  const user = c.get('user')
  const reminder = await one<any>(c.env.DB, `SELECT * FROM reminders WHERE id = ? AND user_id = ?`, c.req.param('id'), user.id)
  if (!reminder) return c.json({ error: 'Pengingat tidak ditemukan.' }, 404)
  const done = reminder.done_at ? null : nowIso()
  await run(c.env.DB, `UPDATE reminders SET done_at = ? WHERE id = ?`, done, reminder.id)
  return c.json({ ok: true, done: !!done })
})

reminderRoutes.delete('/reminders/:id', async (c) => {
  const user = c.get('user')
  const reminder = await one<any>(c.env.DB, `SELECT * FROM reminders WHERE id = ? AND user_id = ?`, c.req.param('id'), user.id)
  if (!reminder) return c.json({ error: 'Pengingat tidak ditemukan.' }, 404)
  await run(c.env.DB, `DELETE FROM reminders WHERE id = ?`, reminder.id)
  return c.json({ ok: true })
})

/** Debug/usage helper: how many auto reminders would fire right now. */
reminderRoutes.get('/reminders/preview', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const leadDays = await getLeadDays(c.env, user.id)
  const auto = await buildAutoReminders(c.env, user, entity, leadDays)
  return c.json({ leadDays, total: auto.length, bySource: {
    event: auto.filter((item) => item.source === 'event').length,
    task: auto.filter((item) => item.source === 'task').length,
    project: auto.filter((item) => item.source === 'project').length,
  } })
})
