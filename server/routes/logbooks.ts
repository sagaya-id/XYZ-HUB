import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso, parseJson } from '../db'
import { HttpError, canSeeVisibility, isAdminOf, loadProject } from '../scope'
import { audit } from '../lib'

export const logbookRoutes = new Hono<AppEnv>()

logbookRoutes.get('/projects/:id/logbooks', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  const locationFilter = c.req.query('location') ?? ''
  const params: any[] = [project.id]
  let sql = `SELECT lb.*, u.name AS staff_name, u.avatar_id AS staff_avatar_id, l.name AS location_name
    FROM logbooks lb LEFT JOIN users u ON u.id = lb.staff_id LEFT JOIN locations l ON l.id = lb.location_id
    WHERE lb.project_id = ?`
  if (locationFilter) { sql += ` AND lb.location_id = ?`; params.push(locationFilter) }
  sql += ` ORDER BY lb.visit_date DESC, lb.created_at DESC`
  const rows = await q<any>(c.env.DB, sql, ...params)
  const ids = rows.map((r) => r.id)
  const photos = ids.length
    ? await q<any>(
        c.env.DB,
        `SELECT * FROM logbook_photos WHERE logbook_id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      )
    : []
  const visible = rows.filter((r) => canSeeVisibility(user, r.visibility, project, member))
  return c.json({
    logbooks: visible.map((r) => ({
      ...r,
      indicators: parseJson<any>(r.indicators, {}),
      photos: photos.filter((p) => p.logbook_id === r.id).map((p) => ({ ...p, url: `/api/files/${p.file_id}` })),
      staff_avatar_url: r.staff_avatar_id ? `/api/files/${r.staff_avatar_id}` : null,
    })),
    can_contribute: !!member || isAdminOf(user, project, member),
  })
})

logbookRoutes.post('/projects/:id/logbooks', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Anda tidak dapat menulis logbook proyek ini.')
  const body = await c.req.json().catch(() => ({}))
  if (!body.visitDate) return c.json({ error: 'Tanggal kunjungan wajib diisi.' }, 400)
  if (!String(body.observations ?? '').trim()) return c.json({ error: 'Catatan observasi wajib diisi.' }, 400)
  const id = uid('lgb_')
  await run(
    c.env.DB,
    `INSERT INTO logbooks (id, project_id, location_id, visit_date, visit_time, staff_id, activity_type,
      observations, indicators, follow_up, gps_lat, gps_lng, visibility, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, project.id, body.locationId || null, String(body.visitDate),
    body.visitTime || null, body.staffId || user.id, body.activityType || null,
    String(body.observations), JSON.stringify(body.indicators ?? {}),
    body.followUp ?? null,
    body.gpsLat !== undefined && body.gpsLat !== null ? Number(body.gpsLat) : null,
    body.gpsLng !== undefined && body.gpsLng !== null ? Number(body.gpsLng) : null,
    body.visibility === 'entity' ? 'entity' : 'team', user.id, nowIso(),
  )
  for (const fileId of Array.isArray(body.photoIds) ? body.photoIds : []) {
    await run(
      c.env.DB,
      `INSERT INTO logbook_photos (id, logbook_id, file_id, created_at) VALUES (?,?,?,?)`,
      uid('lph_'), id, fileId, nowIso(),
    )
  }
  await audit(c.env, user, 'logbook.created', 'logbook', id, `Mencatat logbook ${body.activityType ?? ''} pada ${project.title}`, project.entity_id)
  return c.json({ id })
})

logbookRoutes.patch('/logbooks/:id', async (c) => {
  const user = c.get('user')
  const lb = await one<any>(c.env.DB, `SELECT * FROM logbooks WHERE id = ?`, c.req.param('id'))
  if (!lb) return c.json({ error: 'Logbook tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, lb.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  if (lb.created_by !== user.id && !isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya penulis atau admin proyek.')
  const body = await c.req.json().catch(() => ({}))
  await run(
    c.env.DB,
    `UPDATE logbooks SET location_id = ?, visit_date = ?, visit_time = ?, staff_id = ?, activity_type = ?,
      observations = ?, indicators = ?, follow_up = ?, gps_lat = ?, gps_lng = ?, visibility = ? WHERE id = ?`,
    body.locationId !== undefined ? (body.locationId || null) : lb.location_id,
    body.visitDate ?? lb.visit_date,
    body.visitTime !== undefined ? body.visitTime : lb.visit_time,
    body.staffId ?? lb.staff_id,
    body.activityType !== undefined ? body.activityType : lb.activity_type,
    body.observations ?? lb.observations,
    body.indicators !== undefined ? JSON.stringify(body.indicators) : lb.indicators,
    body.followUp !== undefined ? body.followUp : lb.follow_up,
    body.gpsLat !== undefined ? body.gpsLat : lb.gps_lat,
    body.gpsLng !== undefined ? body.gpsLng : lb.gps_lng,
    body.visibility ?? lb.visibility,
    lb.id,
  )
  await audit(c.env, user, 'logbook.updated', 'logbook', lb.id, `Memperbarui logbook ${project.title}`, project.entity_id)
  return c.json({ ok: true })
})

logbookRoutes.delete('/logbooks/:id', async (c) => {
  const user = c.get('user')
  const lb = await one<any>(c.env.DB, `SELECT * FROM logbooks WHERE id = ?`, c.req.param('id'))
  if (!lb) return c.json({ error: 'Logbook tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, lb.project_id)
  if (!isAdminOf(user, project, member) && lb.created_by !== user.id) throw new HttpError(403, 'Tidak diizinkan.')
  await run(c.env.DB, `DELETE FROM logbook_photos WHERE logbook_id = ?`, lb.id)
  await run(c.env.DB, `DELETE FROM logbooks WHERE id = ?`, lb.id)
  await audit(c.env, user, 'logbook.deleted', 'logbook', lb.id, `Menghapus logbook ${project.title}`, project.entity_id)
  return c.json({ ok: true })
})

logbookRoutes.delete('/logbook-photos/:id', async (c) => {
  const user = c.get('user')
  const photo = await one<any>(c.env.DB, `SELECT * FROM logbook_photos WHERE id = ?`, c.req.param('id'))
  if (!photo) return c.json({ error: 'Foto tidak ditemukan.' }, 404)
  const lb = await one<any>(c.env.DB, `SELECT * FROM logbooks WHERE id = ?`, photo.logbook_id)
  await loadProject(c.env, user, lb.project_id)
  await run(c.env.DB, `DELETE FROM logbook_photos WHERE id = ?`, photo.id)
  return c.json({ ok: true })
})
