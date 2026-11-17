import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { HttpError, canSeeVisibility, isAdminOf, loadProject } from '../scope'
import { audit } from '../lib'

export const galleryRoutes = new Hono<AppEnv>()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_PER_UPLOAD = 20

galleryRoutes.get('/projects/:id/gallery', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  const rows = await q<any>(
    c.env.DB,
    `SELECT g.*, u.name AS uploader_name, u.avatar_id AS uploader_avatar_id
     FROM gallery_photos g LEFT JOIN users u ON u.id = g.created_by
     WHERE g.project_id = ?
     ORDER BY g.photo_date DESC, g.created_at DESC`,
    project.id,
  )
  const admin = isAdminOf(user, project, member)
  return c.json({
    photos: rows
      .filter((row) => canSeeVisibility(user, row.visibility, project, member))
      .map((row) => ({
        ...row,
        url: `/api/files/${row.file_id}`,
        uploader_avatar_url: row.uploader_avatar_id ? `/api/files/${row.uploader_avatar_id}` : null,
        can_delete: admin || row.created_by === user.id,
      })),
    can_contribute: !!member || admin,
  })
})

galleryRoutes.post('/projects/:id/gallery', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) {
    throw new HttpError(403, 'Anda tidak dapat menambah foto galeri proyek ini.')
  }
  const body = await c.req.json().catch(() => ({}))
  const date = String(body.date ?? '').slice(0, 10)
  if (!DATE_RE.test(date)) return c.json({ error: 'Tanggal foto wajib diisi.' }, 400)
  const fileIds: string[] = Array.isArray(body.fileIds)
    ? body.fileIds.filter((id: unknown) => typeof id === 'string' && id.length > 0)
    : []
  if (!fileIds.length) return c.json({ error: 'Pilih minimal satu foto untuk diunggah.' }, 400)
  if (fileIds.length > MAX_PER_UPLOAD) {
    return c.json({ error: `Maksimum ${MAX_PER_UPLOAD} foto per unggahan.` }, 400)
  }
  const visibility = body.visibility === 'entity' ? 'entity' : 'team'
  const ids: string[] = []
  for (const fileId of fileIds) {
    const file = await one<any>(c.env.DB, `SELECT * FROM files WHERE id = ?`, fileId)
    if (!file) return c.json({ error: 'Berkas foto tidak ditemukan.' }, 404)
    if (file.project_id && file.project_id !== project.id) {
      return c.json({ error: 'Berkas milik proyek lain.' }, 400)
    }
    if (file.entity_id && file.entity_id !== project.entity_id) {
      return c.json({ error: 'Berkas milik entitas lain.' }, 400)
    }
    if (!/^image\//i.test(file.mime)) {
      return c.json({ error: 'Galeri hanya menerima berkas gambar.' }, 400)
    }
    const id = uid('glp_')
    await run(
      c.env.DB,
      `INSERT INTO gallery_photos (id, project_id, file_id, photo_date, visibility, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      id, project.id, fileId, date, visibility, user.id, nowIso(),
    )
    ids.push(id)
  }
  await audit(
    c.env, user, 'gallery.created', 'project', project.id,
    `Menambahkan ${ids.length} foto galeri (${date}) pada ${project.title}`, project.entity_id,
  )
  return c.json({ ids, date })
})

galleryRoutes.delete('/gallery/:id', async (c) => {
  const user = c.get('user')
  const photo = await one<any>(c.env.DB, `SELECT * FROM gallery_photos WHERE id = ?`, c.req.param('id'))
  if (!photo) return c.json({ error: 'Foto galeri tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, photo.project_id)
  if (photo.created_by !== user.id && !isAdminOf(user, project, member)) {
    throw new HttpError(403, 'Hanya pengunggah atau admin proyek yang dapat menghapus foto ini.')
  }
  await run(c.env.DB, `DELETE FROM gallery_photos WHERE id = ?`, photo.id)
  await pruneFile(c.env, photo.file_id)
  await audit(
    c.env, user, 'gallery.deleted', 'project', project.id,
    `Menghapus foto galeri (${photo.photo_date}) pada ${project.title}`, project.entity_id,
  )
  return c.json({ ok: true })
})

/**
 * Remove the stored object only when nothing else references it. Photos can be
 * reused by logbooks, map pins, task attachments, chat, covers or avatars.
 */
async function pruneFile(env: any, fileId: string) {
  const file = await one<any>(env.DB, `SELECT * FROM files WHERE id = ?`, fileId)
  if (!file) return
  const refs = await one<any>(
    env.DB,
    `SELECT
      (SELECT COUNT(*) FROM gallery_photos WHERE file_id = ?) AS gallery,
      (SELECT COUNT(*) FROM logbook_photos WHERE file_id = ?) AS logbook,
      (SELECT COUNT(*) FROM location_photos WHERE file_id = ?) AS location,
      (SELECT COUNT(*) FROM task_attachments WHERE file_id = ?) AS task,
      (SELECT COUNT(*) FROM chat_attachments WHERE object_key = ?) AS chat,
      (SELECT COUNT(*) FROM projects WHERE cover_id = ?) AS cover,
      (SELECT COUNT(*) FROM users WHERE avatar_id = ?) AS avatar`,
    fileId, fileId, fileId, fileId, file.object_key, fileId, fileId,
  )
  if (!refs) return
  if (Object.values(refs).some((value) => Number(value) > 0)) return
  await env.FILES.delete(file.object_key)
  await run(env.DB, `DELETE FROM files WHERE id = ?`, fileId)
}
