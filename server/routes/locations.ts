import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso, parseJson } from '../db'
import { projectIdsForUser } from '../auth'
import { HttpError, isAdminOf, loadProject, resolveEntity, canSeeVisibility } from '../scope'
import { audit } from '../lib'

export const locationRoutes = new Hono<AppEnv>()

function geometryCenter(geojson: any): { lon: number | null; lat: number | null } {
  const coords: number[][] = []
  const collect = (c: any) => {
    if (typeof c?.[0] === 'number' && typeof c?.[1] === 'number') coords.push(c)
    else if (Array.isArray(c)) c.forEach(collect)
  }
  collect(geojson?.coordinates)
  if (!coords.length) return { lon: null, lat: null }
  const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length
  return { lon, lat }
}

function serializeLocation(row: any, canSeeTeam: boolean) {
  return {
    ...row,
    geojson: parseJson<any>(row.geojson, null),
    photos: [],
    restricted: row.visibility === 'team' && !canSeeTeam,
  }
}

locationRoutes.get('/locations', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const projectParam = c.req.query('project') ?? ''
  const ids = await projectIdsForUser(c.env.DB, user, entity.id)
  const memberships = new Set(
    (await q<any>(c.env.DB, `SELECT project_id FROM project_members WHERE user_id = ?`, user.id)).map((m: any) => m.project_id),
  )
  let rows: any[] = []
  if (projectParam) {
    await loadProject(c.env, user, projectParam)
    rows = await q<any>(
      c.env.DB,
      `SELECT l.*, p.title AS project_title, p.code AS project_code FROM locations l
       JOIN projects p ON p.id = l.project_id
       WHERE l.project_id = ? AND p.deleted_at IS NULL ORDER BY l.created_at DESC`,
      projectParam,
    )
  } else {
    if (!ids.length) return c.json({ locations: [], entity })
    const placeholders = ids.map(() => '?').join(',')
    rows = await q<any>(
      c.env.DB,
      `SELECT l.*, p.title AS project_title, p.code AS project_code FROM locations l
       JOIN projects p ON p.id = l.project_id
       WHERE l.project_id IN (${placeholders}) AND p.deleted_at IS NULL ORDER BY l.created_at DESC`,
      ...ids,
    )
  }
  const isEntityAdmin = user.role === 'MA' || user.role === 'SA'
  const visible = rows.filter((r) => {
    const member = memberships.has(r.project_id)
    if (isEntityAdmin) return true
    if (r.visibility === 'team') return member
    return true
  })
  const photoRows = visible.length
    ? await q<any>(
        c.env.DB,
        `SELECT lp.* FROM location_photos lp WHERE lp.location_id IN (${visible.map(() => '?').join(',')}) ORDER BY lp.created_at DESC`,
        ...visible.map((v) => v.id),
      )
    : []
  const logbookCounts = visible.length
    ? await q<any>(
        c.env.DB,
        `SELECT location_id, COUNT(*) AS n, MAX(visit_date) AS last_visit FROM logbooks
         WHERE location_id IN (${visible.map(() => '?').join(',')}) GROUP BY location_id`,
        ...visible.map((v) => v.id),
      )
    : []
  return c.json({
    locations: visible.map((r) => ({
      ...serializeLocation(r, true),
      photos: photoRows.filter((p) => p.location_id === r.id).map((p) => ({ ...p, url: `/api/files/${p.file_id}` })),
      logbook_count: logbookCounts.find((l) => l.location_id === r.id)?.n ?? 0,
      last_visit: logbookCounts.find((l) => l.location_id === r.id)?.last_visit ?? null,
    })),
    entity,
  })
})

locationRoutes.post('/locations', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const projectId = String(body.projectId ?? '')
  const { project, member } = await loadProject(c.env, user, projectId)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Anda tidak dapat menambah lokasi proyek ini.')
  const name = String(body.name ?? '').trim()
  if (!name) return c.json({ error: 'Nama lokasi wajib diisi.' }, 400)
  const geometry = body.geometry ?? body.geojson
  if (!geometry?.type || !geometry?.coordinates) return c.json({ error: 'Geometri lokasi tidak valid.' }, 400)
  const type = ['point', 'line', 'polygon'].includes(body.type) ? body.type : geometry.type === 'Point' ? 'point' : geometry.type === 'LineString' ? 'line' : 'polygon'
  const center = geometryCenter(geometry)
  const id = uid('loc_')
  await run(
    c.env.DB,
    `INSERT INTO locations (id, entity_id, project_id, name, description, type, geojson, lon, lat, visibility, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, project.entity_id, project.id, name, body.description ?? null, type,
    JSON.stringify({ type: geometry.type, coordinates: geometry.coordinates }),
    center.lon, center.lat, body.visibility === 'team' ? 'team' : 'entity', user.id, nowIso(),
  )
  if (Array.isArray(body.photoIds)) {
    for (const fileId of body.photoIds) {
      await run(
        c.env.DB,
        `INSERT INTO location_photos (id, location_id, file_id, caption, created_at) VALUES (?,?,?,?,?)`,
        uid('lph_'), id, fileId, null, nowIso(),
      )
    }
  }
  await audit(c.env, user, 'location.created', 'location', id, `Menambah lokasi ${name} pada ${project.title}`, project.entity_id)
  return c.json({ location: await one<any>(c.env.DB, `SELECT * FROM locations WHERE id = ?`, id) })
})

locationRoutes.post('/locations/import', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const projectId = String(body.projectId ?? '')
  const { project, member } = await loadProject(c.env, user, projectId)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Anda tidak dapat mengimpor lokasi proyek ini.')
  const features = Array.isArray(body.features) ? body.features : []
  if (!features.length) return c.json({ error: 'Tidak ada fitur untuk diimpor.' }, 400)
  if (features.length > 2000) return c.json({ error: 'Maksimum 2000 fitur per impor.' }, 400)
  const saved: string[] = []
  const skipped: string[] = []
  for (const f of features) {
    const geometry = f.geometry ?? (f.lat !== undefined ? { type: 'Point', coordinates: [Number(f.lon), Number(f.lat)] } : null)
    if (!geometry?.type || !Array.isArray(geometry?.coordinates)) {
      skipped.push(f.name ?? '(tanpa nama)')
      continue
    }
    const center = geometryCenter(geometry)
    if (center.lon === null || center.lat === null || Number.isNaN(center.lon) || Number.isNaN(center.lat)) {
      skipped.push(f.name ?? '(tanpa nama)')
      continue
    }
    const id = uid('loc_')
    const type = geometry.type === 'Point' ? 'point' : geometry.type === 'LineString' ? 'line' : 'polygon'
    await run(
      c.env.DB,
      `INSERT INTO locations (id, entity_id, project_id, name, description, type, geojson, lon, lat, visibility, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, project.entity_id, project.id, String(f.name ?? 'Lokasi tanpa nama'), f.description ?? null, type,
      JSON.stringify({ type: geometry.type, coordinates: geometry.coordinates }),
      center.lon, center.lat, body.visibility === 'team' ? 'team' : 'entity', user.id, nowIso(),
    )
    saved.push(id)
  }
  await audit(
    c.env, user, 'location.imported', 'project', project.id,
    `Mengimpor ${saved.length} lokasi (${body.source ?? 'berkas'}) ke ${project.title}`, project.entity_id,
    { skipped: skipped.length },
  )
  return c.json({ imported: saved.length, skipped, ids: saved })
})

locationRoutes.patch('/locations/:id', async (c) => {
  const user = c.get('user')
  const loc = await one<any>(c.env.DB, `SELECT * FROM locations WHERE id = ?`, c.req.param('id'))
  if (!loc) return c.json({ error: 'Lokasi tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, loc.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  let geojson = loc.geojson
  let lon = loc.lon
  let lat = loc.lat
  if (body.geometry) {
    geojson = JSON.stringify(body.geometry)
    const center = geometryCenter(body.geometry)
    lon = center.lon
    lat = center.lat
  }
  await run(
    c.env.DB,
    `UPDATE locations SET name = ?, description = ?, visibility = ?, geojson = ?, lon = ?, lat = ? WHERE id = ?`,
    body.name ?? loc.name, body.description !== undefined ? body.description : loc.description,
    body.visibility ?? loc.visibility, geojson, lon, lat, loc.id,
  )
  await audit(c.env, user, 'location.updated', 'location', loc.id, `Memperbarui lokasi ${body.name ?? loc.name}`, project.entity_id)
  return c.json({ ok: true })
})

locationRoutes.delete('/locations/:id', async (c) => {
  const user = c.get('user')
  const loc = await one<any>(c.env.DB, `SELECT * FROM locations WHERE id = ?`, c.req.param('id'))
  if (!loc) return c.json({ error: 'Lokasi tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, loc.project_id)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat menghapus lokasi.')
  await run(c.env.DB, `UPDATE logbooks SET location_id = NULL WHERE location_id = ?`, loc.id)
  await run(c.env.DB, `DELETE FROM location_photos WHERE location_id = ?`, loc.id)
  await run(c.env.DB, `DELETE FROM locations WHERE id = ?`, loc.id)
  await audit(c.env, user, 'location.deleted', 'location', loc.id, `Menghapus lokasi ${loc.name}`, project.entity_id)
  return c.json({ ok: true })
})

locationRoutes.get('/locations/:id', async (c) => {
  const user = c.get('user')
  const loc = await one<any>(c.env.DB, `SELECT * FROM locations WHERE id = ?`, c.req.param('id'))
  if (!loc) return c.json({ error: 'Lokasi tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, loc.project_id)
  if (loc.visibility === 'team' && !canSeeVisibility(user, loc.visibility, project, member)) {
    throw new HttpError(403, 'Lokasi ini khusus tim proyek.')
  }
  const photos = await q<any>(c.env.DB, `SELECT * FROM location_photos WHERE location_id = ? ORDER BY created_at DESC`, loc.id)
  const logbooks = await q<any>(
    c.env.DB,
    `SELECT lb.*, u.name AS staff_name FROM logbooks lb LEFT JOIN users u ON u.id = lb.created_by
     WHERE lb.location_id = ? ORDER BY lb.visit_date DESC LIMIT 30`,
    loc.id,
  )
  return c.json({
    location: { ...serializeLocation(loc, true), project_title: project.title, photos: photos.map((p) => ({ ...p, url: `/api/files/${p.file_id}` })) },
    logbooks,
  })
})

locationRoutes.post('/locations/:id/photos', async (c) => {
  const user = c.get('user')
  const loc = await one<any>(c.env.DB, `SELECT * FROM locations WHERE id = ?`, c.req.param('id'))
  if (!loc) return c.json({ error: 'Lokasi tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, loc.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const file = await one<any>(c.env.DB, `SELECT * FROM files WHERE id = ?`, body.fileId)
  if (!file) return c.json({ error: 'Berkas tidak ditemukan.' }, 404)
  await run(
    c.env.DB,
    `INSERT INTO location_photos (id, location_id, file_id, caption, created_at) VALUES (?,?,?,?,?)`,
    uid('lph_'), loc.id, file.id, body.caption ?? null, nowIso(),
  )
  return c.json({ ok: true })
})

locationRoutes.delete('/location-photos/:id', async (c) => {
  const user = c.get('user')
  const photo = await one<any>(c.env.DB, `SELECT * FROM location_photos WHERE id = ?`, c.req.param('id'))
  if (!photo) return c.json({ error: 'Foto tidak ditemukan.' }, 404)
  const loc = await one<any>(c.env.DB, `SELECT * FROM locations WHERE id = ?`, photo.location_id)
  const { project, member } = await loadProject(c.env, user, loc.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  await run(c.env.DB, `DELETE FROM location_photos WHERE id = ?`, photo.id)
  return c.json({ ok: true })
})
