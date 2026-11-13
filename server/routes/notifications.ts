import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { q, run, uid, nowIso } from '../db'
import { resolveEntity } from '../scope'
import { buildAutoReminders, getLeadDays, jakartaToday } from '../reminders'

export const notificationRoutes = new Hono<AppEnv>()

const PREFS = [
  'task.assigned', 'task.due', 'calendar.created', 'calendar.updated', 'calendar.cancelled',
  'project.assigned', 'project.pic', 'project.removed', 'project.milestone', 'budget.updated',
]

/**
 * Time-based reminders are materialised on read (deduplicated by key).
 * No external cron is configured for this project, so reminders are produced
 * when a user next loads the app rather than pushed in the background.
 * The reminder window follows each user's lead time (default 3 days).
 */
async function materialiseReminders(env: any, user: any, entity: any) {
  const leadDays = await getLeadDays(env, user.id)
  const today = jakartaToday()
  const items = await buildAutoReminders(env, user, entity, leadDays)
  const typeFor = (source: string) =>
    source === 'task' ? 'task.due' : source === 'project' ? 'project.milestone' : 'calendar.created'
  for (const item of items) {
    const type = typeFor(item.source)
    const pref = await q<any>(
      env.DB,
      `SELECT enabled FROM notification_prefs WHERE user_id = ? AND type = ?`,
      user.id, type,
    )
    if (pref[0] && pref[0].enabled === 0) continue
    try {
      await run(
        env.DB,
        `INSERT INTO notifications (id, user_id, type, title, body, link, entity_id, project_id, dedupe_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uid('ntf_'), user.id, type, item.title, item.body, item.link, entity.id, item.project_id,
        `reminder:${item.id}:${today}`, nowIso(),
      )
    } catch {
      /* duplicate dedupe key — already reminded today */
    }
  }
}

notificationRoutes.get('/notifications', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  await materialiseReminders(c.env, user, entity)
  const rows = await q<any>(
    c.env.DB,
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60`,
    user.id,
  )
  const unread = rows.filter((r) => !r.read_at).length
  return c.json({ notifications: rows.map((r) => ({ ...r, unread: !r.read_at })), unreadCount: unread })
})

notificationRoutes.post('/notifications/:id/read', async (c) => {
  const user = c.get('user')
  await run(c.env.DB, `UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?`, nowIso(), c.req.param('id'), user.id)
  return c.json({ ok: true })
})

notificationRoutes.post('/notifications/read-all', async (c) => {
  const user = c.get('user')
  await run(c.env.DB, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, nowIso(), user.id)
  return c.json({ ok: true })
})

notificationRoutes.get('/notifications/prefs', async (c) => {
  const user = c.get('user')
  const rows = await q<any>(c.env.DB, `SELECT type, enabled FROM notification_prefs WHERE user_id = ?`, user.id)
  return c.json({
    prefs: PREFS.map((type) => ({
      type,
      enabled: rows.find((r) => r.type === type)?.enabled !== 0,
    })),
  })
})

notificationRoutes.put('/notifications/prefs', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const prefs: { type: string; enabled: boolean }[] = Array.isArray(body.prefs) ? body.prefs : []
  for (const p of prefs) {
    if (!PREFS.includes(p.type)) continue
    await run(
      c.env.DB,
      `INSERT INTO notification_prefs (user_id, type, enabled) VALUES (?,?,?)
       ON CONFLICT(user_id, type) DO UPDATE SET enabled = excluded.enabled`,
      user.id, p.type, p.enabled ? 1 : 0,
    )
  }
  return c.json({ ok: true })
})
