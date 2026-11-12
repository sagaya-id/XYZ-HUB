import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { loadProject, isAdminOf, HttpError } from '../scope'
import { audit, notify } from '../lib'

export const taskRoutes = new Hono<AppEnv>()

async function boardPayload(env: any, projectId: string) {
  const columns = await q<any>(env.DB, `SELECT * FROM boards WHERE project_id = ? ORDER BY position, id`, projectId)
  const tasks = await q<any>(
    env.DB,
    `SELECT t.*, u.name AS assignee_name, u.avatar_id AS assignee_avatar_id,
      (SELECT COUNT(*) FROM task_checklist c WHERE c.task_id = t.id) AS checklist_total,
      (SELECT COUNT(*) FROM task_checklist c WHERE c.task_id = t.id AND c.is_done = 1) AS checklist_done,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
      (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) AS attachment_count
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = ? ORDER BY t.position, t.created_at`,
    projectId,
  )
  return {
    columns: columns.map((col) => ({
      ...col,
      is_done: !!col.is_done,
      tasks: tasks
        .filter((t) => t.board_id === col.id)
        .map((t) => ({
          ...t,
          assignee_avatar_url: t.assignee_avatar_id ? `/api/files/${t.assignee_avatar_id}` : null,
        })),
    })),
    done_column_ids: columns.filter((col) => col.is_done).map((col) => col.id),
  }
}

taskRoutes.get('/projects/:id/board', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  const data = await boardPayload(c.env, project.id)
  return c.json({ ...data, can_edit: isAdminOf(user, project, member) || !!member })
})

taskRoutes.post('/projects/:id/columns', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat mengubah kolom.')
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name ?? '').trim()
  if (!name) return c.json({ error: 'Nama kolom wajib diisi.' }, 400)
  const max = await one<any>(c.env.DB, `SELECT COALESCE(MAX(position), -1) AS p FROM boards WHERE project_id = ?`, project.id)
  const id = uid('brd_')
  await run(
    c.env.DB,
    `INSERT INTO boards (id, project_id, name, position, is_done) VALUES (?,?,?,?,0)`,
    id, project.id, name, (max?.p ?? -1) + 1,
  )
  await audit(c.env, user, 'kanban.column_created', 'project', project.id, `Menambah kolom ${name}`, project.entity_id)
  return c.json({ column: await one<any>(c.env.DB, `SELECT * FROM boards WHERE id = ?`, id) })
})

taskRoutes.patch('/columns/:columnId', async (c) => {
  const user = c.get('user')
  const column = await one<any>(c.env.DB, `SELECT * FROM boards WHERE id = ?`, c.req.param('columnId'))
  if (!column) return c.json({ error: 'Kolom tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, column.project_id)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat mengubah kolom.')
  const body = await c.req.json().catch(() => ({}))
  await run(
    c.env.DB,
    `UPDATE boards SET name = ?, position = ?, is_done = ? WHERE id = ?`,
    body.name ?? column.name,
    body.position !== undefined ? Number(body.position) : column.position,
    body.isDone !== undefined ? (body.isDone ? 1 : 0) : column.is_done,
    column.id,
  )
  return c.json({ ok: true })
})

taskRoutes.delete('/columns/:columnId', async (c) => {
  const user = c.get('user')
  const column = await one<any>(c.env.DB, `SELECT * FROM boards WHERE id = ?`, c.req.param('columnId'))
  if (!column) return c.json({ error: 'Kolom tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, column.project_id)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat menghapus kolom.')
  const remaining = await one<any>(
    c.env.DB,
    `SELECT id FROM boards WHERE project_id = ? AND id != ? ORDER BY position LIMIT 1`,
    column.project_id, column.id,
  )
  if (!remaining) return c.json({ error: 'Proyek harus memiliki minimal satu kolom.' }, 400)
  await run(c.env.DB, `UPDATE tasks SET board_id = ?, updated_at = ? WHERE board_id = ?`, remaining.id, nowIso(), column.id)
  await run(c.env.DB, `DELETE FROM boards WHERE id = ?`, column.id)
  await audit(c.env, user, 'kanban.column_deleted', 'project', column.project_id, `Menghapus kolom ${column.name}`, project.entity_id)
  return c.json({ ok: true, moved_to: remaining.id })
})

taskRoutes.post('/projects/:id/tasks', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Anda tidak memiliki akses kontribusi.')
  const body = await c.req.json().catch(() => ({}))
  const title = String(body.title ?? '').trim()
  if (!title) return c.json({ error: 'Judul tugas wajib diisi.' }, 400)
  let boardId = body.boardId as string | undefined
  if (!boardId) {
    const first = await one<any>(c.env.DB, `SELECT id FROM boards WHERE project_id = ? ORDER BY position LIMIT 1`, project.id)
    boardId = first?.id
  }
  if (!boardId) return c.json({ error: 'Papan belum siap.' }, 400)
  const max = await one<any>(c.env.DB, `SELECT COALESCE(MAX(position), 0) AS p FROM tasks WHERE board_id = ?`, boardId)
  const id = uid('tsk_')
  await run(
    c.env.DB,
    `INSERT INTO tasks (id, project_id, board_id, title, description, priority, due_date, assignee_id, position,
      created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, project.id, boardId, title, body.description ?? null, body.priority ?? 'normal',
    body.dueDate ?? null, body.assigneeId ?? null, Number(max?.p ?? 0) + 1000, user.id, nowIso(), nowIso(),
  )
  if (body.assigneeId) {
    await notify(c.env, {
      userIds: [body.assigneeId], type: 'task.assigned', title: 'Tugas baru untuk Anda',
      body: `${title} — ${project.title}`, link: `/app/projects/${project.id}?tab=kanban`,
      entityId: project.entity_id, projectId: project.id, dedupeKey: `task-assign:${id}:${body.assigneeId}`,
    })
  }
  await audit(c.env, user, 'task.created', 'task', id, `Membuat tugas "${title}"`, project.entity_id)
  return c.json({ task: await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, id) })
})

taskRoutes.get('/tasks/:taskId', async (c) => {
  const user = c.get('user')
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, c.req.param('taskId'))
  if (!task) return c.json({ error: 'Tugas tidak ditemukan.' }, 404)
  const { project } = await loadProject(c.env, user, task.project_id)
  const [checklist, comments, attachments, members] = await Promise.all([
    q<any>(c.env.DB, `SELECT * FROM task_checklist WHERE task_id = ? ORDER BY position, id`, task.id),
    q<any>(
      c.env.DB,
      `SELECT c.*, u.name AS user_name, u.avatar_id FROM task_comments c JOIN users u ON u.id = c.user_id
       WHERE c.task_id = ? ORDER BY c.created_at DESC`,
      task.id,
    ),
    q<any>(
      c.env.DB,
      `SELECT a.*, f.name AS file_name, f.mime FROM task_attachments a JOIN files f ON f.id = a.file_id
       WHERE a.task_id = ? ORDER BY a.created_at`,
      task.id,
    ),
    q<any>(
      c.env.DB,
      `SELECT u.id, u.name, u.avatar_id FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? ORDER BY u.name`,
      project.id,
    ),
  ])
  return c.json({
    task,
    checklist: checklist.map((i) => ({ ...i, is_done: !!i.is_done })),
    comments: comments.map((cm) => ({ ...cm, avatar_url: cm.avatar_id ? `/api/files/${cm.avatar_id}` : null })),
    attachments,
    members: members.map((m) => ({ ...m, avatar_url: m.avatar_id ? `/api/files/${m.avatar_id}` : null })),
  })
})

taskRoutes.patch('/tasks/:taskId', async (c) => {
  const user = c.get('user')
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, c.req.param('taskId'))
  if (!task) return c.json({ error: 'Tugas tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const prevAssignee = task.assignee_id
  await run(
    c.env.DB,
    `UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ?, assignee_id = ?, updated_at = ? WHERE id = ?`,
    body.title ?? task.title,
    body.description !== undefined ? body.description : task.description,
    body.priority ?? task.priority,
    body.dueDate !== undefined ? body.dueDate : task.due_date,
    body.assigneeId !== undefined ? body.assigneeId : task.assignee_id,
    nowIso(), task.id,
  )
  if (body.assigneeId && body.assigneeId !== prevAssignee) {
    await notify(c.env, {
      userIds: [body.assigneeId], type: 'task.assigned', title: 'Penugasan tugas',
      body: `${body.title ?? task.title} — ${project.title}`, link: `/app/projects/${project.id}?tab=kanban`,
      entityId: project.entity_id, projectId: project.id, dedupeKey: `task-assign:${task.id}:${body.assigneeId}:${Date.now()}`,
    })
  }
  await audit(c.env, user, 'task.updated', 'task', task.id, `Memperbarui tugas "${body.title ?? task.title}"`, project.entity_id)
  return c.json({ ok: true })
})

/**
 * Move / reorder a task. `beforeTaskId` is the task it should be inserted before
 * (null = end of the target column). Column contents are re-indexed deterministically.
 */
taskRoutes.post('/tasks/:taskId/move', async (c) => {
  const user = c.get('user')
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, c.req.param('taskId'))
  if (!task) return c.json({ error: 'Tugas tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const targetColumn = String(body.boardId ?? task.board_id)
  const column = await one<any>(c.env.DB, `SELECT * FROM boards WHERE id = ? AND project_id = ?`, targetColumn, project.id)
  if (!column) return c.json({ error: 'Kolom tujuan tidak ditemukan.' }, 404)
  const beforeTaskId = body.beforeTaskId ? String(body.beforeTaskId) : null
  const siblings = await q<any>(
    c.env.DB,
    `SELECT id FROM tasks WHERE board_id = ? AND id != ? ORDER BY position, created_at`,
    targetColumn, task.id,
  )
  const ids = siblings.map((s) => s.id)
  let index = ids.length
  if (beforeTaskId) {
    const found = ids.indexOf(beforeTaskId)
    if (found >= 0) index = found
  }
  ids.splice(index, 0, task.id)
  const movedColumns = targetColumn !== task.board_id
  for (const [i, id] of ids.entries()) {
    await run(c.env.DB, `UPDATE tasks SET board_id = ?, position = ? WHERE id = ?`, targetColumn, i * 1000, id)
  }
  await run(
    c.env.DB,
    `UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?`,
    column.is_done ? nowIso() : null, nowIso(), task.id,
  )
  if (movedColumns) {
    await audit(
      c.env, user, 'task.moved', 'task', task.id,
      `Memindahkan tugas "${task.title}" ke kolom ${column.name}`, project.entity_id,
    )
  }
  return c.json({ ok: true, board: await boardPayload(c.env, project.id) })
})

taskRoutes.delete('/tasks/:taskId', async (c) => {
  const user = c.get('user')
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, c.req.param('taskId'))
  if (!task) return c.json({ error: 'Tugas tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  await run(c.env.DB, `DELETE FROM task_checklist WHERE task_id = ?`, task.id)
  await run(c.env.DB, `DELETE FROM task_comments WHERE task_id = ?`, task.id)
  await run(c.env.DB, `DELETE FROM task_attachments WHERE task_id = ?`, task.id)
  await run(c.env.DB, `DELETE FROM tasks WHERE id = ?`, task.id)
  await audit(c.env, user, 'task.deleted', 'task', task.id, `Menghapus tugas "${task.title}"`, project.entity_id)
  return c.json({ ok: true })
})

taskRoutes.post('/tasks/:taskId/checklist', async (c) => {
  const user = c.get('user')
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, c.req.param('taskId'))
  if (!task) return c.json({ error: 'Tugas tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const text = String(body.text ?? '').trim()
  if (!text) return c.json({ error: 'Teks checklist wajib diisi.' }, 400)
  const max = await one<any>(c.env.DB, `SELECT COALESCE(MAX(position), -1) AS p FROM task_checklist WHERE task_id = ?`, task.id)
  const id = uid('chk_')
  await run(
    c.env.DB,
    `INSERT INTO task_checklist (id, task_id, text, is_done, position) VALUES (?,?,?,0,?)`,
    id, task.id, text, (max?.p ?? -1) + 1,
  )
  return c.json({ item: await one<any>(c.env.DB, `SELECT * FROM task_checklist WHERE id = ?`, id) })
})

taskRoutes.patch('/checklist/:itemId', async (c) => {
  const user = c.get('user')
  const item = await one<any>(c.env.DB, `SELECT * FROM task_checklist WHERE id = ?`, c.req.param('itemId'))
  if (!item) return c.json({ error: 'Item tidak ditemukan.' }, 404)
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, item.task_id)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  // Checking a subtask never moves the parent card between columns.
  await run(
    c.env.DB,
    `UPDATE task_checklist SET text = ?, is_done = ? WHERE id = ?`,
    body.text ?? item.text,
    body.isDone !== undefined ? (body.isDone ? 1 : 0) : item.is_done,
    item.id,
  )
  return c.json({ ok: true })
})

taskRoutes.delete('/checklist/:itemId', async (c) => {
  const user = c.get('user')
  const item = await one<any>(c.env.DB, `SELECT * FROM task_checklist WHERE id = ?`, c.req.param('itemId'))
  if (!item) return c.json({ error: 'Item tidak ditemukan.' }, 404)
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, item.task_id)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  await run(c.env.DB, `DELETE FROM task_checklist WHERE id = ?`, item.id)
  return c.json({ ok: true })
})

taskRoutes.post('/tasks/:taskId/comments', async (c) => {
  const user = c.get('user')
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, c.req.param('taskId'))
  if (!task) return c.json({ error: 'Tugas tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const text = String(body.body ?? '').trim()
  if (!text) return c.json({ error: 'Komentar tidak boleh kosong.' }, 400)
  const id = uid('cmt_')
  await run(
    c.env.DB,
    `INSERT INTO task_comments (id, task_id, user_id, body, created_at) VALUES (?,?,?,?,?)`,
    id, task.id, user.id, text, nowIso(),
  )
  return c.json({ comment: await one<any>(c.env.DB, `SELECT * FROM task_comments WHERE id = ?`, id) })
})

taskRoutes.delete('/comments/:commentId', async (c) => {
  const user = c.get('user')
  const comment = await one<any>(c.env.DB, `SELECT * FROM task_comments WHERE id = ?`, c.req.param('commentId'))
  if (!comment) return c.json({ error: 'Komentar tidak ditemukan.' }, 404)
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, comment.task_id)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (comment.user_id !== user.id && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  await run(c.env.DB, `DELETE FROM task_comments WHERE id = ?`, comment.id)
  return c.json({ ok: true })
})

taskRoutes.post('/tasks/:taskId/attachments', async (c) => {
  const user = c.get('user')
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, c.req.param('taskId'))
  if (!task) return c.json({ error: 'Tugas tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, task.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const file = await one<any>(c.env.DB, `SELECT * FROM files WHERE id = ?`, body.fileId)
  if (!file) return c.json({ error: 'Berkas tidak ditemukan.' }, 404)
  const id = uid('att_')
  await run(
    c.env.DB,
    `INSERT INTO task_attachments (id, task_id, file_id, name, created_at) VALUES (?,?,?,?,?)`,
    id, task.id, file.id, file.name, nowIso(),
  )
  return c.json({ attachment: { id, file_id: file.id, name: file.name } })
})

taskRoutes.delete('/attachments/:attachmentId', async (c) => {
  const user = c.get('user')
  const att = await one<any>(c.env.DB, `SELECT * FROM task_attachments WHERE id = ?`, c.req.param('attachmentId'))
  if (!att) return c.json({ error: 'Lampiran tidak ditemukan.' }, 404)
  const task = await one<any>(c.env.DB, `SELECT * FROM tasks WHERE id = ?`, att.task_id)
  await loadProject(c.env, user, task.project_id)
  await run(c.env.DB, `DELETE FROM task_attachments WHERE id = ?`, att.id)
  return c.json({ ok: true })
})
