import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { projectIdsForUser } from '../auth'
import { HttpError, assertEntityAccess, assertRole, loadProject, resolveEntity } from '../scope'
import { audit, notify, projectMemberIds } from '../lib'

export const eventRoutes = new Hono<AppEnv>()

const DEFAULT_CATEGORIES = [
  { name: 'Monitoring', color: '#245A46' },
  { name: 'Rapat', color: '#2F6F8F' },
  { name: 'Pelatihan', color: '#B7791F' },
  { name: 'Kunjungan', color: '#7C5CBF' },
]

eventRoutes.get('/events', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const from = c.req.query('from') ?? ''
  const to = c.req.query('to') ?? ''
  const projectFilter = (c.req.query('projectIds') ?? '').split(',').filter(Boolean)
  const visibleProjects = await projectIdsForUser(c.env.DB, user, entity.id)
  const memberProjects = new Set<string>()
  const memberships = await q<any>(c.env.DB, `SELECT project_id FROM project_members WHERE user_id = ?`, user.id)
  memberships.forEach((m) => memberProjects.add(m.project_id))
  const filters: string[] = ['e.entity_id = ?', 'e.cancelled_at IS NULL']
  const params: any[] = [entity.id]
  if (from) { filters.push('e.start_local >= ?'); params.push(from) }
  if (to) { filters.push('e.start_local <= ?'); params.push(to) }
  const rows = await q<any>(
    c.env.DB,
    `SELECT e.*, p.title AS project_title, p.code AS project_code, cat.name AS category_name,
      cat.color AS category_color, u.name AS creator_name
     FROM events e
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN event_categories cat ON cat.id = e.category_id
     LEFT JOIN users u ON u.id = e.created_by
     WHERE ${filters.join(' AND ')}
     ORDER BY e.start_local`,
    ...params,
  )
  const isEntityAdmin = user.role === 'MA' || (user.role === 'SA' && user.entity_id === entity.id)
  let events = rows.filter((e) => {
    if (e.project_id) {
      const isMember = memberProjects.has(e.project_id)
      if (!isEntityAdmin && !isMember) return false
      if (e.visibility === 'team' && !isMember && !isEntityAdmin) return false
    }
    if (e.visibility === 'team' && !e.project_id && !isEntityAdmin) return false
    return true
  })
  events = events.filter((e) => visibleProjects.includes(e.project_id) || !e.project_id)
  if (projectFilter.length) events = events.filter((e) => !e.project_id || projectFilter.includes(e.project_id))
  const categories = await q<any>(c.env.DB, `SELECT * FROM event_categories WHERE entity_id = ? ORDER BY name`, entity.id)
  return c.json({ events: events.map(decorate), categories, entity })
})

function decorate(e: any) {
  return {
    ...e,
    all_day: !!e.all_day,
    time_label: e.all_day ? '' : (e.start_local ?? '').slice(11, 16),
    date: (e.start_local ?? '').slice(0, 10),
  }
}

eventRoutes.get('/event-categories', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  return c.json({ categories: await q<any>(c.env.DB, `SELECT * FROM event_categories WHERE entity_id = ? ORDER BY name`, entity.id) })
})

eventRoutes.post('/event-categories', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  assertRole(user, ['MA', 'SA'])
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name ?? '').trim()
  if (!name) return c.json({ error: 'Nama kategori wajib diisi.' }, 400)
  const id = uid('cat_')
  await run(
    c.env.DB,
    `INSERT INTO event_categories (id, entity_id, name, color) VALUES (?,?,?,?)`,
    id, entity.id, name, body.color || '#245A46',
  )
  return c.json({ category: await one<any>(c.env.DB, `SELECT * FROM event_categories WHERE id = ?`, id) })
})

eventRoutes.patch('/event-categories/:id', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const cat = await one<any>(c.env.DB, `SELECT * FROM event_categories WHERE id = ?`, c.req.param('id'))
  if (!cat) return c.json({ error: 'Kategori tidak ditemukan.' }, 404)
  await assertEntityAccess(c.env, user, cat.entity_id)
  const body = await c.req.json().catch(() => ({}))
  await run(c.env.DB, `UPDATE event_categories SET name = ?, color = ? WHERE id = ?`, body.name ?? cat.name, body.color ?? cat.color, cat.id)
  return c.json({ ok: true })
})

eventRoutes.delete('/event-categories/:id', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const cat = await one<any>(c.env.DB, `SELECT * FROM event_categories WHERE id = ?`, c.req.param('id'))
  if (!cat) return c.json({ error: 'Kategori tidak ditemukan.' }, 404)
  await assertEntityAccess(c.env, user, cat.entity_id)
  await run(c.env.DB, `UPDATE events SET category_id = NULL WHERE category_id = ?`, cat.id)
  await run(c.env.DB, `DELETE FROM event_categories WHERE id = ?`, cat.id)
  return c.json({ ok: true })
})

async function validateEventInput(c: any, user: any, body: any) {
  const entity = await resolveEntity(c.env, c, user)
  let projectId: string | null = body.projectId || null
  let project: any = null
  if (projectId) {
    const loaded = await loadProject(c.env, user, projectId)
    project = loaded.project
    const canCreate = !!loaded.member || user.role === 'MA' || (user.role === 'SA' && user.entity_id === project.entity_id)
    if (!canCreate) throw new HttpError(403, 'Anda tidak memiliki akses ke proyek ini.')
  } else {
    assertRole(user, ['MA', 'SA'])
  }
  const title = String(body.title ?? '').trim()
  if (!title) throw new HttpError(400, 'Judul agenda wajib diisi.')
  if (!body.startLocal) throw new HttpError(400, 'Waktu mulai wajib diisi.')
  const entityId = project ? project.entity_id : entity.id
  return { entityId, projectId, title, project }
}

eventRoutes.post('/events', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const { entityId, projectId, title, project } = await validateEventInput(c, user, body)
  const id = uid('evt_')
  const startLocal = String(body.startLocal)
  const allDay = !!body.allDay
  const endLocal = body.endLocal ? String(body.endLocal) : startLocal
  await run(
    c.env.DB,
    `INSERT INTO events (id, entity_id, project_id, title, description, start_local, end_local, all_day,
      category_id, visibility, location, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, entityId, projectId, title, body.description ?? null, startLocal, endLocal, allDay ? 1 : 0,
    body.categoryId || null, body.visibility === 'team' ? 'team' : 'entity',
    body.location ?? null, user.id, nowIso(),
  )
  const recipients = projectId
    ? await projectMemberIds(c.env, projectId)
    : (await q<any>(c.env.DB, `SELECT id FROM users WHERE is_active = 1 AND (entity_id = ? OR role = 'MA')`, entityId)).map((r: any) => r.id)
  await notify(c.env, {
    userIds: recipients.filter((id2) => id2 !== user.id),
    type: 'calendar.created',
    title: 'Agenda baru ditambahkan',
    body: `${title}${project ? ` — ${project.title}` : ''} • ${startLocal.replace('T', ' ')}`,
    link: '/app/calendar',
    entityId,
    projectId,
    dedupeKey: `event-created:${id}`,
  })
  await audit(c.env, user, 'event.created', 'event', id, `Membuat agenda "${title}"`, entityId)
  const created = await one<any>(c.env.DB, `SELECT * FROM events WHERE id = ?`, id)
  return c.json({ event: decorate(created) })
})

eventRoutes.patch('/events/:id', async (c) => {
  const user = c.get('user')
  const event = await one<any>(c.env.DB, `SELECT * FROM events WHERE id = ?`, c.req.param('id'))
  if (!event) return c.json({ error: 'Agenda tidak ditemukan.' }, 404)
  await assertEntityAccess(c.env, user, event.entity_id)
  const canEdit = user.role !== 'PA' && user.role !== undefined
    ? user.role === 'MA' || user.role === 'SA'
    : event.created_by === user.id
  const isCreator = event.created_by === user.id
  if (!canEdit && !isCreator) throw new HttpError(403, 'Anda tidak dapat mengubah agenda ini.')
  if (event.project_id && user.role === 'PA') {
    await loadProject(c.env, user, event.project_id)
  }
  const body = await c.req.json().catch(() => ({}))
  await run(
    c.env.DB,
    `UPDATE events SET title = ?, description = ?, start_local = ?, end_local = ?, all_day = ?,
      category_id = ?, visibility = ?, location = ? WHERE id = ?`,
    body.title ?? event.title,
    body.description !== undefined ? body.description : event.description,
    body.startLocal ?? event.start_local,
    body.endLocal ?? event.end_local,
    body.allDay !== undefined ? (body.allDay ? 1 : 0) : event.all_day,
    body.categoryId !== undefined ? (body.categoryId || null) : event.category_id,
    body.visibility ?? event.visibility,
    body.location !== undefined ? body.location : event.location,
    event.id,
  )
  const recipients = event.project_id
    ? await projectMemberIds(c.env, event.project_id)
    : (await q<any>(c.env.DB, `SELECT id FROM users WHERE is_active = 1 AND (entity_id = ? OR role = 'MA')`, event.entity_id)).map((r: any) => r.id)
  await notify(c.env, {
    userIds: recipients.filter((uid2) => uid2 !== user.id),
    type: 'calendar.updated',
    title: 'Agenda diperbarui',
    body: `${body.title ?? event.title} • ${String(body.startLocal ?? event.start_local).replace('T', ' ')}`,
    link: '/app/calendar',
    entityId: event.entity_id,
    projectId: event.project_id,
    dedupeKey: `event-updated:${event.id}:${nowIso()}`,
  })
  await audit(c.env, user, 'event.updated', 'event', event.id, `Memperbarui agenda "${body.title ?? event.title}"`, event.entity_id)
  return c.json({ event: decorate(await one<any>(c.env.DB, `SELECT * FROM events WHERE id = ?`, event.id)) })
})

eventRoutes.delete('/events/:id', async (c) => {
  const user = c.get('user')
  const event = await one<any>(c.env.DB, `SELECT * FROM events WHERE id = ?`, c.req.param('id'))
  if (!event) return c.json({ error: 'Agenda tidak ditemukan.' }, 404)
  await assertEntityAccess(c.env, user, event.entity_id)
  const isAdmin = user.role === 'MA' || user.role === 'SA'
  if (!isAdmin && event.created_by !== user.id) throw new HttpError(403, 'Anda tidak dapat menghapus agenda ini.')
  await run(c.env.DB, `DELETE FROM events WHERE id = ?`, event.id)
  const recipients = event.project_id
    ? await projectMemberIds(c.env, event.project_id)
    : (await q<any>(c.env.DB, `SELECT id FROM users WHERE is_active = 1 AND (entity_id = ? OR role = 'MA')`, event.entity_id)).map((r: any) => r.id)
  await notify(c.env, {
    userIds: recipients.filter((id2) => id2 !== user.id),
    type: 'calendar.cancelled',
    title: 'Agenda dibatalkan',
    body: event.title,
    link: '/app/calendar',
    entityId: event.entity_id,
    projectId: event.project_id,
    dedupeKey: `event-cancelled:${event.id}`,
  })
  await audit(c.env, user, 'event.deleted', 'event', event.id, `Menghapus agenda "${event.title}"`, event.entity_id)
  return c.json({ ok: true })
})

eventRoutes.get('/holidays', async (c) => {
  const year = c.req.query('year') ?? String(new Date().getFullYear())
  const rows = await q<any>(c.env.DB, `SELECT * FROM holidays WHERE date LIKE ? ORDER BY date`, `${year}%`)
  return c.json({ holidays: rows })
})
