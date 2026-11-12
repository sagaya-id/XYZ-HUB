import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { projectIdsForUser } from '../auth'

export const notificationRoutes = new Hono<AppEnv>()

const PREFS = ['task.assigned', 'task.due', 'calendar.created', 'calendar.updated', 'calendar.cancelled', 'project.assigned', 'project.pic', 'project.removed', 'budget.updated']

function jakartaToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  return parts
}

/**
 * Time-based reminders are materialised on read (deduplicated by key).
 * No external cron is configured for this project, so reminders are produced
 * when a user next loads the app rather than pushed in the background.
 */
async function materialiseReminders(env: any, user: any) {
  const today = jakartaToday()
  const in2Days = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)
  const dueTasks = await q<any>(
    env.DB,
    `SELECT t.id, t.title, t.due_date, t.project_id, p.title AS project_title, p.entity_id
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.assignee_id = ? AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?
       AND t.completed_at IS NULL AND p.deleted_at IS NULL`,
    user.id, today, in2Days,
  )
  for (const t of dueTasks) {
    try {
      await run(
        env.DB,
        `INSERT INTO notifications (id, user_id, type, title, body, link, entity_id, project_id, dedupe_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uid('ntf_'), user.id, 'task.due', 'Tenggat tugas mendekat',
        `${t.title} — ${t.project_title} (${t.due_date})`,
        `/app/projects/${t.project_id}?tab=kanban`, t.entity_id, t.project_id,
        `task-due:${t.id}:${t.due_date}`, nowIso(),
      )
    } catch { /* duplicate */ }
  }
  const dates = await q<any>(
    env.DB,
    `SELECT e.id, e.title, e.start_local, e.project_id, e.entity_id FROM events e
     JOIN projects p ON p.id = e.project_id
     WHERE e.start_local >= ? AND e.start_local <= ? AND e.cancelled_at IS NULL
       AND e.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)`,
    today, in2Days + 'T23:59', user.id,
  )
  for (const e of dates) {
    try {
      await run(
        env.DB,
        `INSERT INTO notifications (id, user_id, type, title, body, link, entity_id, project_id, dedupe_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uid('ntf_'), user.id, 'calendar.created', 'Pengingat agenda',
        `${e.title} • ${e.start_local.replace('T', ' ')}`,
        '/app/calendar', e.entity_id, e.project_id, `event-soon:${e.id}:${today}`, nowIso(),
      )
    } catch { /* duplicate */ }
  }
}

notificationRoutes.get('/notifications', async (c) => {
  const user = c.get('user')
  await materialiseReminders(c.env, user)
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
