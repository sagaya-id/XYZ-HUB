import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, run, uid, nowIso } from '../db'
import { HttpError, assertEntityAccess, loadProject } from '../scope'

export const fileRoutes = new Hono<AppEnv>()

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = /^(image\/(png|jpe?g|webp|gif|svg\+xml|heic|heif)|application\/(pdf|msword|vnd\..*|json|geo\+json)|text\/(plain|csv)|application\/octet-stream)$/

fileRoutes.post('/files', async (c) => {
  const user = c.get('user')
  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ error: 'Formulir unggahan tidak valid.' }, 400)
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ error: 'Berkas tidak ditemukan.' }, 400)
  if (file.size > MAX_BYTES) return c.json({ error: 'Ukuran berkas maksimum 10 MB.' }, 400)
  const mime = file.type || 'application/octet-stream'
  if (!ALLOWED.test(mime)) return c.json({ error: `Tipe berkas ${mime} tidak diizinkan.` }, 400)
  const projectId = (form.get('projectId') as string) || null
  let entityId = user.entity_id
  if (projectId) {
    const { project } = await loadProject(c.env, user, projectId)
    entityId = project.entity_id
  } else {
    const requested = form.get('entityId') as string | null
    if (requested) {
      await assertEntityAccess(c.env, user, requested)
      entityId = requested
    }
    if (!entityId) entityId = user.entity_id
  }
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().slice(0, 8)
  const id = uid('fil_')
  const objectKey = `${entityId ?? 'shared'}/${id}.${ext}`
  await c.env.FILES.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: mime, contentDisposition: `inline; filename="${encodeURIComponent(file.name)}"` },
  })
  await run(
    c.env.DB,
    `INSERT INTO files (id, object_key, name, mime, size, entity_id, project_id, uploaded_by, visibility, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, objectKey, file.name, mime, file.size, entityId, projectId, user.id,
    (form.get('visibility') as string) === 'team' ? 'team' : 'entity', nowIso(),
  )
  return c.json({ file: { id, name: file.name, mime, size: file.size, url: `/api/files/${id}` } })
})

fileRoutes.get('/files/:id', async (c) => {
  const user = c.get('user')
  const file = await one<any>(c.env.DB, `SELECT * FROM files WHERE id = ?`, c.req.param('id'))
  if (!file) return c.json({ error: 'Berkas tidak ditemukan.' }, 404)
  if (user.role !== 'MA' && file.entity_id && file.entity_id !== user.entity_id) {
    throw new HttpError(403, 'Berkas milik entitas lain.')
  }
  if (file.project_id && file.visibility === 'team' && user.role === 'PA') {
    const member = await one<any>(
      c.env.DB,
      `SELECT id FROM project_members WHERE project_id = ? AND user_id = ?`,
      file.project_id, user.id,
    )
    if (!member) throw new HttpError(403, 'Berkas khusus tim proyek.')
  }
  const object = await c.env.FILES.get(file.object_key)
  if (!object) return c.json({ error: 'Objek berkas tidak tersedia.' }, 404)
  const headers = new Headers()
  headers.set('content-type', file.mime)
  headers.set('cache-control', 'private, max-age=3600')
  headers.set('etag', object.httpEtag ?? '')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(object.body, { headers })
})

fileRoutes.delete('/files/:id', async (c) => {
  const user = c.get('user')
  const file = await one<any>(c.env.DB, `SELECT * FROM files WHERE id = ?`, c.req.param('id'))
  if (!file) return c.json({ error: 'Berkas tidak ditemukan.' }, 404)
  const isOwner = file.uploaded_by === user.id
  const isAdmin = user.role === 'MA' || (user.role === 'SA' && file.entity_id === user.entity_id)
  if (!isOwner && !isAdmin) throw new HttpError(403, 'Tidak diizinkan menghapus berkas ini.')
  await c.env.FILES.delete(file.object_key)
  await run(c.env.DB, `DELETE FROM files WHERE id = ?`, file.id)
  return c.json({ ok: true })
})
