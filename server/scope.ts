import { q, one } from './db'
import type { SessionUser } from './auth'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Resolve the entity for a request, allowing MA to switch, SA pinned to own entity. */
export async function resolveEntity(env: any, c: any, user: SessionUser) {
  const requested = (c.req.query('entity') || c.req.header('x-entity') || '').toLowerCase()
  if (user.role === 'SA' || user.role === 'PA') {
    const entity = await one<any>(env.DB, `SELECT * FROM entities WHERE id = ?`, user.entity_id)
    if (!entity) throw new HttpError(403, 'Entitas pengguna tidak ditemukan.')
    if (requested && requested !== entity.key) {
      throw new HttpError(403, 'Anda tidak memiliki akses ke entitas lain.')
    }
    return entity
  }
  if (requested) {
    const entity = await one<any>(env.DB, `SELECT * FROM entities WHERE key = ?`, requested)
    if (!entity) throw new HttpError(404, 'Entitas tidak ditemukan.')
    return entity
  }
  const entity = await one<any>(env.DB, `SELECT * FROM entities ORDER BY sort_order LIMIT 1`)
  if (!entity) throw new HttpError(500, 'Belum ada entitas.')
  return entity
}

export function assertRole(user: SessionUser, roles: string[]) {
  if (!roles.includes(user.role)) throw new HttpError(403, 'Anda tidak memiliki izin untuk tindakan ini.')
}

export async function assertEntityAccess(env: any, user: SessionUser, entityId: string) {
  if (user.role === 'MA') return
  if (user.entity_id !== entityId) throw new HttpError(403, 'Akses lintas entitas ditolak.')
}

export async function memberRow(env: any, userId: string, projectId: string) {
  return one<any>(env.DB, `SELECT * FROM project_members WHERE project_id = ? AND user_id = ?`, projectId, userId)
}

export async function loadProject(env: any, user: SessionUser, projectId: string) {
  const project = await one<any>(env.DB, `SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL`, projectId)
  if (!project) throw new HttpError(404, 'Proyek tidak ditemukan.')
  if (user.role === 'MA') return { project, member: null }
  if (user.entity_id !== project.entity_id) throw new HttpError(403, 'Proyek milik entitas lain.')
  if (user.role === 'SA') return { project, member: await memberRow(env, user.id, projectId) }
  const member = await memberRow(env, user.id, projectId)
  if (!member) throw new HttpError(403, 'Anda tidak terdaftar pada proyek ini.')
  return { project, member }
}

export function isAdminOf(user: SessionUser, project: any, member: any) {
  if (user.role === 'MA') return true
  if (user.role === 'SA' && user.entity_id === project.entity_id) return true
  return !!(member && member.access === 'admin' && member.user_id === user.id)
}

export async function requireProjectAdmin(env: any, user: SessionUser, projectId: string) {
  const { project, member } = await loadProject(env, user, projectId)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat melakukan tindakan ini.')
  return { project, member }
}

/** Visibility gate for team-only material (notes, logbooks, data records, map pins). */
export function canSeeVisibility(
  user: SessionUser,
  visibility: string | null | undefined,
  project: any,
  member: any,
) {
  if (!visibility || visibility === 'entity') {
    if (user.role === 'MA') return true
    return user.entity_id === project.entity_id
  }
  if (user.role === 'MA') return true
  if (user.role === 'SA' && user.entity_id === project.entity_id) return true
  return !!member
}

export async function projectSummaries(env: any, user: SessionUser, entityId: string, projectIds: string[]) {
  if (!projectIds.length) return []
  const placeholders = projectIds.map(() => '?').join(',')
  const rows = await q<any>(
    env.DB,
    `SELECT p.*,
      (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count,
      (SELECT u.name FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = p.id AND m.is_primary_pic = 1 LIMIT 1) AS pic_name,
      (SELECT u.avatar_id FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = p.id AND m.is_primary_pic = 1 LIMIT 1) AS pic_avatar_id,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_total,
      (SELECT COUNT(*) FROM tasks t JOIN boards b ON b.id = t.board_id
        WHERE t.project_id = p.id AND b.is_done = 1) AS task_done,
      (SELECT COUNT(*) FROM locations l WHERE l.project_id = p.id) AS location_count,
      (SELECT COUNT(*) FROM logbooks lb WHERE lb.project_id = p.id) AS logbook_count,
      bud.amount AS budget_amount, bud.is_confirmed AS budget_confirmed, bud.visibility AS budget_visibility
     FROM projects p
     LEFT JOIN budgets bud ON bud.project_id = p.id
     WHERE p.entity_id = ? AND p.id IN (${placeholders})
     ORDER BY p.created_at DESC`,
    entityId, ...projectIds,
  )
  return rows.map((r) => {
    const member = projectIds.includes(r.id)
    const taskProgress = r.task_total ? Math.round((r.task_done / r.task_total) * 100) : null
    const includeBudget =
      (user.role === 'MA' || (user.role === 'SA' && user.entity_id === r.entity_id)) ||
      (r.budget_visibility === 'entity' && user.entity_id === r.entity_id) ||
      member
    return {
      ...r,
      cover_url: r.cover_id ? `/api/files/${r.cover_id}` : null,
      pic_avatar_url: r.pic_avatar_id ? `/api/files/${r.pic_avatar_id}` : null,
      progress: taskProgress ?? r.progress ?? 0,
      task_progress: taskProgress,
      budget_amount: includeBudget && r.budget_confirmed ? r.budget_amount : null,
      budget_confirmed: !!r.budget_confirmed,
      is_member: member,
    }
  })
}
