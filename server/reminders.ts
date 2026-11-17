import { q, one } from './db'
import type { SessionUser } from './auth'
import { projectIdsForUser } from './auth'

/**
 * Pengingat (reminders) are derived from live project data instead of being
 * copied once: calendar agendas, task deadlines and project milestones are
 * re-read on every request inside the user's configurable lead-time window.
 * Manual reminders live in the `reminders` table and are merged into the list.
 */

export type ReminderSource = 'event' | 'task' | 'project' | 'manual'

export type ReminderItem = {
  id: string
  source: ReminderSource
  title: string
  body: string | null
  date: string
  time: string | null
  link: string | null
  project_id: string | null
  project_title?: string | null
  urgent: boolean
  done?: boolean
}

const DEFAULT_LEAD_DAYS = 3

export function jakartaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function getLeadDays(env: any, userId: string): Promise<number> {
  const row = await one<any>(env.DB, `SELECT lead_days FROM reminder_settings WHERE user_id = ?`, userId)
  const value = Number(row?.lead_days ?? DEFAULT_LEAD_DAYS)
  if (!Number.isFinite(value)) return DEFAULT_LEAD_DAYS
  return Math.min(30, Math.max(0, Math.round(value)))
}

/**
 * Auto reminders for one user inside one entity. Visibility mirrors the rest of
 * the app: entity-wide events are visible to the entity, team-only material
 * only to project members (and entity admins), PA only sees own projects.
 */
export async function buildAutoReminders(
  env: any,
  user: SessionUser,
  entity: { id: string; key: string },
  leadDays: number,
): Promise<ReminderItem[]> {
  const today = jakartaToday()
  const until = addDaysIso(today, leadDays)
  const isEntityAdmin = user.role === 'MA' || (user.role === 'SA' && user.entity_id === entity.id)
  const projectIds = await projectIdsForUser(env.DB, user, entity.id)
  const projectSet = new Set(projectIds)
  const memberships = await q<any>(
    env.DB,
    `SELECT project_id FROM project_members WHERE user_id = ?`,
    user.id,
  )
  const memberSet = new Set(memberships.map((m) => m.project_id))
  const items: ReminderItem[] = []

  // 1. Agenda / calendar events, including entity-wide agendas without a project.
  const events = await q<any>(
    env.DB,
    `SELECT e.id, e.title, e.start_local, e.all_day, e.project_id, e.visibility, e.location,
       p.title AS project_title
     FROM events e LEFT JOIN projects p ON p.id = e.project_id
     WHERE e.entity_id = ? AND e.cancelled_at IS NULL
       AND e.start_local >= ? AND e.start_local <= ?
     ORDER BY e.start_local`,
    entity.id, `${today}T00:00`, `${until}T23:59`,
  )
  for (const event of events) {
    if (event.project_id) {
      if (!projectSet.has(event.project_id)) continue
      if (event.visibility === 'team' && !isEntityAdmin && !memberSet.has(event.project_id)) continue
    } else if (event.visibility === 'team' && !isEntityAdmin) {
      continue
    }
    const date = String(event.start_local).slice(0, 10)
    items.push({
      id: `event:${event.id}`,
      source: 'event',
      title: event.title,
      body: `${event.project_title ?? 'Agenda entitas'}${event.location ? ` · ${event.location}` : ''}`,
      date,
      time: event.all_day ? null : String(event.start_local).slice(11, 16),
      link: `/app/calendar`,
      project_id: event.project_id ?? null,
      project_title: event.project_title ?? null,
      urgent: date === today,
    })
  }

  if (projectIds.length) {
    const placeholders = projectIds.map(() => '?').join(',')

    // 2. Task deadlines inside the lead-time window.
    const tasks = await q<any>(
      env.DB,
      `SELECT t.id, t.title, t.due_date, t.priority, t.project_id, p.title AS project_title,
         u.name AS assignee_name, t.assignee_id
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.project_id IN (${placeholders}) AND p.deleted_at IS NULL
         AND t.completed_at IS NULL AND t.due_date IS NOT NULL
         AND t.due_date >= ? AND t.due_date <= ?
       ORDER BY t.due_date`,
      ...projectIds, today, until,
    )
    for (const task of tasks) {
      const date = String(task.due_date).slice(0, 10)
      items.push({
        id: `task:${task.id}`,
        source: 'task',
        title: `Tenggat tugas: ${task.title}`,
        body: `${task.project_title}${task.assignee_name ? ` · penanggung jawab ${task.assignee_name}` : ' · belum ada penanggung jawab'}`,
        date,
        time: null,
        link: `/app/projects/${task.project_id}?tab=kanban`,
        project_id: task.project_id,
        project_title: task.project_title,
        urgent: date === today || task.assignee_id === user.id,
      })
    }

    // 3. Project milestones (target end date).
    const milestones = await q<any>(
      env.DB,
      `SELECT id, title, code, end_date, status FROM projects
       WHERE id IN (${placeholders}) AND deleted_at IS NULL AND archived_at IS NULL
         AND end_date IS NOT NULL AND end_date >= ? AND end_date <= ? AND status <> 'Selesai'
       ORDER BY end_date`,
      ...projectIds, today, until,
    )
    for (const milestone of milestones) {
      const date = String(milestone.end_date).slice(0, 10)
      items.push({
        id: `project:${milestone.id}:${date}`,
        source: 'project',
        title: `Milestone proyek: ${milestone.title}`,
        body: `${milestone.code} · target selesai ${date}`,
        date,
        time: null,
        link: `/app/projects/${milestone.id}`,
        project_id: milestone.id,
        project_title: milestone.title,
        urgent: date === today,
      })
    }
  }

  return items.sort((a, b) => `${a.date}${a.time ?? '00:00'}`.localeCompare(`${b.date}${b.time ?? '00:00'}`))
}

export async function getManualReminders(env: any, userId: string, entityId: string): Promise<ReminderItem[]> {
  const rows = await q<any>(
    env.DB,
    `SELECT r.*, p.title AS project_title FROM reminders r
     LEFT JOIN projects p ON p.id = r.project_id
     WHERE r.user_id = ? AND r.entity_id = ? ORDER BY r.remind_at`,
    userId, entityId,
  )
  return rows.map((row) => {
    const raw = String(row.remind_at)
    return {
      id: row.id,
      source: 'manual' as const,
      title: row.title,
      body: row.body ?? row.project_title ?? null,
      date: raw.slice(0, 10),
      time: raw.length > 10 ? raw.slice(11, 16) : null,
      link: row.project_id ? `/app/projects/${row.project_id}` : null,
      project_id: row.project_id ?? null,
      project_title: row.project_title ?? null,
      urgent: !row.done_at && raw.slice(0, 10) <= jakartaToday(),
      done: !!row.done_at,
    }
  })
}
