import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { HttpError, canSeeVisibility, isAdminOf, loadProject } from '../scope'
import { audit } from '../lib'

export const noteRoutes = new Hono<AppEnv>()

noteRoutes.get('/projects/:id/notes', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  const rows = await q<any>(
    c.env.DB,
    `SELECT n.*, u.name AS author_name, u.avatar_id AS author_avatar_id FROM notes n
     LEFT JOIN users u ON u.id = n.created_by WHERE n.project_id = ? ORDER BY n.updated_at DESC`,
    project.id,
  )
  return c.json({
    notes: rows
      .filter((n) => canSeeVisibility(user, n.visibility, project, member))
      .map((n) => ({ ...n, author_avatar_url: n.author_avatar_id ? `/api/files/${n.author_avatar_id}` : null })),
    can_contribute: !!member || isAdminOf(user, project, member),
  })
})

noteRoutes.post('/projects/:id/notes', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Anda tidak dapat menulis catatan proyek ini.')
  const body = await c.req.json().catch(() => ({}))
  const title = String(body.title ?? '').trim()
  if (!title) return c.json({ error: 'Judul catatan wajib diisi.' }, 400)
  const id = uid('not_')
  await run(
    c.env.DB,
    `INSERT INTO notes (id, project_id, title, body, visibility, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    id, project.id, title, body.body ?? '', body.visibility === 'entity' ? 'entity' : 'team', user.id, nowIso(), nowIso(),
  )
  await audit(c.env, user, 'note.created', 'note', id, `Menulis catatan "${title}"`, project.entity_id)
  return c.json({ id })
})

noteRoutes.patch('/notes/:id', async (c) => {
  const user = c.get('user')
  const note = await one<any>(c.env.DB, `SELECT * FROM notes WHERE id = ?`, c.req.param('id'))
  if (!note) return c.json({ error: 'Catatan tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, note.project_id)
  if (note.created_by !== user.id && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  await run(
    c.env.DB,
    `UPDATE notes SET title = ?, body = ?, visibility = ?, updated_at = ? WHERE id = ?`,
    body.title ?? note.title, body.body !== undefined ? body.body : note.body,
    body.visibility ?? note.visibility, nowIso(), note.id,
  )
  await audit(c.env, user, 'note.updated', 'note', note.id, `Memperbarui catatan "${body.title ?? note.title}"`, project.entity_id)
  return c.json({ ok: true })
})

noteRoutes.delete('/notes/:id', async (c) => {
  const user = c.get('user')
  const note = await one<any>(c.env.DB, `SELECT * FROM notes WHERE id = ?`, c.req.param('id'))
  if (!note) return c.json({ error: 'Catatan tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, note.project_id)
  if (note.created_by !== user.id && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  await run(c.env.DB, `DELETE FROM notes WHERE id = ?`, note.id)
  await audit(c.env, user, 'note.deleted', 'note', note.id, `Menghapus catatan "${note.title}"`, project.entity_id)
  return c.json({ ok: true })
})
