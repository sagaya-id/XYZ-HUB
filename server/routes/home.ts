import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q } from '../db'
import { projectIdsForUser } from '../auth'
import { projectSummaries, resolveEntity } from '../scope'

export const homeRoutes = new Hono<AppEnv>()

function jakartaNow(): Date {
  return new Date()
}

function localDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

homeRoutes.get('/home', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const ids = await projectIdsForUser(c.env.DB, user, entity.id)
  const projects = await projectSummaries(c.env, user, entity.id, ids)
  const active = projects.filter((p) => !p.archived_at)
  const memberships = new Set(
    (await q<any>(c.env.DB, `SELECT project_id FROM project_members WHERE user_id = ?`, user.id)).map((m: any) => m.project_id),
  )
  const isEntityAdmin = user.role === 'MA' || (user.role === 'SA' && user.entity_id === entity.id)

  const today = localDate(jakartaNow())
  const weekAhead = localDate(new Date(Date.now() + 7 * 86400_000))

  const upcoming = await q<any>(
    c.env.DB,
    `SELECT e.*, p.title AS project_title, p.code AS project_code, p.location_text, cat.name AS category_name, cat.color AS category_color
     FROM events e LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN event_categories cat ON cat.id = e.category_id
     WHERE e.entity_id = ? AND e.cancelled_at IS NULL AND e.start_local >= ? AND e.start_local <= ?
     ORDER BY e.start_local LIMIT 40`,
    entity.id, `${today}T00:00`, `${weekAhead}T23:59`,
  )
  const agenda = upcoming
    .filter((e) => {
      if (!e.project_id) return true
      if (isEntityAdmin) return true
      if (!ids.includes(e.project_id)) return false
      return e.visibility === 'entity' || memberships.has(e.project_id)
    })
    .slice(0, 7)
    .map((e) => ({
      ...e,
      all_day: !!e.all_day,
      time_label: e.all_day ? 'Sepanjang hari' : e.start_local.slice(11, 16),
      date: e.start_local.slice(0, 10),
    }))

  const taskStats = ids.length
    ? await one<any>(
        c.env.DB,
        `SELECT
           SUM(CASE WHEN b.is_done = 1 THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN b.is_done = 0 THEN 1 ELSE 0 END) AS open,
           COUNT(*) AS total
         FROM tasks t JOIN boards b ON b.id = t.board_id
         WHERE t.project_id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      )
    : { done: 0, open: 0, total: 0 }

  const logbookStats = ids.length
    ? await one<any>(
        c.env.DB,
        `SELECT COUNT(*) AS total,
           SUM(CASE WHEN substr(visit_date,1,7) = ? THEN 1 ELSE 0 END) AS this_month
         FROM logbooks WHERE project_id IN (${ids.map(() => '?').join(',')})`,
        today.slice(0, 7), ...ids,
      )
    : { total: 0, this_month: 0 }

  const locationStats = ids.length
    ? await one<any>(
        c.env.DB,
        `SELECT COUNT(*) AS total FROM locations WHERE project_id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      )
    : { total: 0 }

  const trend: { month: string; label: string; count: number }[] = []
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    trend.push({ month: key, label: monthLabels[d.getMonth()], count: 0 })
  }
  if (ids.length) {
    const rows = await q<any>(
      c.env.DB,
      `SELECT substr(visit_date,1,7) AS month, COUNT(*) AS n FROM logbooks
       WHERE project_id IN (${ids.map(() => '?').join(',')}) GROUP BY month`,
      ...ids,
    )
    for (const r of rows) {
      const slot = trend.find((t) => t.month === r.month)
      if (slot) slot.count = r.n
    }
  }

  const confirmedBudget = active.reduce((sum, p) => sum + (p.budget_amount ?? 0), 0)
  const provisionalBudget = active.reduce((sum, p) => sum + (!p.budget_confirmed && p.budget_amount ? p.budget_amount : 0), 0)

  const recentAudit = isEntityAdmin
    ? await q<any>(
        c.env.DB,
        `SELECT a.*, e.name AS entity_name FROM audit_log a LEFT JOIN entities e ON e.id = a.entity_id
         WHERE a.entity_id = ? ORDER BY a.created_at DESC LIMIT 8`,
        entity.id,
      )
    : await q<any>(
        c.env.DB,
        `SELECT a.*, e.name AS entity_name FROM audit_log a LEFT JOIN entities e ON e.id = a.entity_id
         WHERE a.actor_id = ? OR a.target_id IN (${ids.length ? ids.map(() => '?').join(',') : `''`})
         ORDER BY a.created_at DESC LIMIT 8`,
        user.id, ...(ids.length ? ids : []),
      )

  const unread = await one<any>(c.env.DB, `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`, user.id)
  const entityUsers = await one<any>(
    c.env.DB,
    `SELECT COUNT(DISTINCT m.user_id) AS n FROM project_members m JOIN projects p ON p.id = m.project_id
     WHERE p.entity_id = ? AND p.deleted_at IS NULL`,
    entity.id,
  )

  const statusCounts = active.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1
    return acc
  }, {})

  return c.json({
    entity,
    today,
    stats: {
      activeProjects: active.length,
      archivedProjects: projects.length - active.length,
      teamMembers: entityUsers?.n ?? 0,
      locations: locationStats.total ?? 0,
      logbooks: logbookStats.total ?? 0,
      logbooksThisMonth: logbookStats.this_month ?? 0,
      tasksDone: taskStats.done ?? 0,
      tasksOpen: taskStats.open ?? 0,
      confirmedBudget,
      provisionalBudget,
      unread: unread?.n ?? 0,
    },
    agenda,
    projects: active.slice(0, 6).map((p) => ({
      id: p.id, title: p.title, code: p.code, category: p.category, progress: p.progress,
      status: p.status, cover_url: p.cover_url, pic_name: p.pic_name,
    })),
    charts: {
      progress: active.slice(0, 6).map((p) => ({ label: p.code, value: p.progress ?? 0, title: p.title })),
      status: Object.entries(statusCounts).map(([label, value]) => ({ label, value })),
      logbookTrend: trend,
      tasks: [
        { label: 'Selesai', value: Number(taskStats.done ?? 0) },
        { label: 'Berjalan', value: Number(taskStats.open ?? 0) },
      ],
      budgetByCategory: Object.entries(
        active.reduce<Record<string, number>>((acc, p) => {
          if (p.budget_amount) acc[p.category] = (acc[p.category] ?? 0) + p.budget_amount
          return acc
        }, {}),
      )
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
    },
    recentActivity: recentAudit,
  })
})

homeRoutes.get('/home/agenda', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const ids = await projectIdsForUser(c.env.DB, user, entity.id)
  const from = c.req.query('from') ?? localDate(new Date())
  const to = c.req.query('to') ?? localDate(new Date(Date.now() + 7 * 86400_000))
  const rows = await q<any>(
    c.env.DB,
    `SELECT e.*, p.title AS project_title, p.location_text, cat.color AS category_color
     FROM events e LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN event_categories cat ON cat.id = e.category_id
     WHERE e.entity_id = ? AND e.cancelled_at IS NULL AND e.start_local >= ? AND e.start_local <= ?
     ORDER BY e.start_local LIMIT 100`,
    entity.id, `${from}T00:00`, `${to}T23:59`,
  )
  const isEntityAdmin = user.role === 'MA' || (user.role === 'SA' && user.entity_id === entity.id)
  return c.json({
    agenda: rows
      .filter((e) => !e.project_id || isEntityAdmin || ids.includes(e.project_id))
      .map((e) => ({
        ...e,
        all_day: !!e.all_day,
        time_label: e.all_day ? 'Sepanjang hari' : e.start_local.slice(11, 16),
        date: e.start_local.slice(0, 10),
      })),
  })
})
