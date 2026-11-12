import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { hashPassword } from '../auth'
import { assertRole, HttpError, resolveEntity } from '../scope'
import { audit, getConfig, setConfig, DEFAULT_GLOBAL, DEFAULT_ENTITY, type BrandingGlobal, type BrandingEntity } from '../lib'
import { publicUser } from './auth'

export const adminRoutes = new Hono<AppEnv>()

function randomPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  for (const b of bytes) out += chars[b % chars.length]
  return `${out}#26`
}

adminRoutes.get('/admin/users', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const entity = await resolveEntity(c.env, c, user)
  const search = (c.req.query('q') ?? '').trim().toLowerCase()
  const roleFilter = c.req.query('role') ?? ''
  const params: any[] = []
  let sql = `SELECT u.*, e.key AS entity_key, e.name AS entity_name,
      (SELECT COUNT(*) FROM project_members m WHERE m.user_id = u.id) AS project_count
    FROM users u LEFT JOIN entities e ON e.id = u.entity_id WHERE 1=1`
  if (user.role === 'SA') { sql += ` AND u.entity_id = ?`; params.push(entity.id) }
  if (roleFilter) { sql += ` AND u.role = ?`; params.push(roleFilter) }
  sql += ` ORDER BY u.role, u.name`
  const rows = await q<any>(c.env.DB, sql, ...params)
  const filtered = search
    ? rows.filter((r) => `${r.name} ${r.email} ${r.job_title ?? ''}`.toLowerCase().includes(search))
    : rows
  const memberships = await q<any>(
    c.env.DB,
    `SELECT m.user_id, m.access, m.is_primary_pic, p.id AS project_id, p.title
     FROM project_members m JOIN projects p ON p.id = m.project_id WHERE p.deleted_at IS NULL`,
  )
  return c.json({
    users: filtered.map((u) => ({
      ...publicUser(u),
      projects: memberships.filter((m) => m.user_id === u.id),
      avatar_url: u.avatar_id ? `/api/files/${u.avatar_id}` : null,
    })),
    entity,
    canCreateRoles: user.role === 'MA' ? ['MA', 'SA', 'PA'] : ['SA', 'PA'],
  })
})

adminRoutes.post('/admin/users', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const body = await c.req.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const name = String(body.name ?? '').trim()
  const role = String(body.role ?? 'PA').toUpperCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'Format email tidak valid.' }, 400)
  if (name.length < 2) return c.json({ error: 'Nama minimal 2 karakter.' }, 400)
  if (!['MA', 'SA', 'PA'].includes(role)) return c.json({ error: 'Peran tidak valid.' }, 400)
  if (user.role === 'SA' && role === 'MA') return c.json({ error: 'Super Admin tidak dapat membuat Master Admin.' }, 403)
  let entityId = body.entityId ? String(body.entityId) : user.entity_id
  if (role === 'MA') entityId = null
  if (user.role === 'SA') entityId = user.entity_id
  if (entityId) {
    const entity = await one<any>(c.env.DB, `SELECT id FROM entities WHERE id = ?`, entityId)
    if (!entity) return c.json({ error: 'Entitas tidak ditemukan.' }, 400)
  }
  const dupe = await one<any>(c.env.DB, `SELECT id FROM users WHERE email = ?`, email)
  if (dupe) return c.json({ error: 'Email sudah terdaftar.' }, 409)
  const password = String(body.password ?? '') || randomPassword()
  if (password.length < 8) return c.json({ error: 'Kata sandi minimal 8 karakter.' }, 400)
  const { hash, salt } = await hashPassword(password)
  const id = uid('usr_')
  await run(
    c.env.DB,
    `INSERT INTO users (id, email, password_hash, password_salt, name, role, entity_id, job_title, phone, is_active, must_change_password, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,1,1,?)`,
    id, email, hash, salt, name, role, entityId, body.jobTitle ?? null, body.phone ?? null, nowIso(),
  )
  await audit(c.env, user, 'user.invited', 'user', id, `Mengundang ${name} (${email}) sebagai ${role}`, entityId)
  return c.json({
    user: publicUser(await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ?`, id)),
    temporaryPassword: body.password ? undefined : password,
  })
})

adminRoutes.patch('/admin/users/:id', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const target = await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ?`, c.req.param('id'))
  if (!target) return c.json({ error: 'Pengguna tidak ditemukan.' }, 404)
  if (user.role === 'SA') {
    if (target.role === 'MA') throw new HttpError(403, 'Super Admin tidak dapat mengubah Master Admin.')
    if (target.entity_id !== user.entity_id) throw new HttpError(403, 'Pengguna berada di entitas lain.')
  }
  const body = await c.req.json().catch(() => ({}))
  if (body.role && user.role === 'SA' && body.role === 'MA') throw new HttpError(403, 'Tidak diizinkan menaikkan peran ke Master Admin.')
  const role = body.role ? String(body.role).toUpperCase() : target.role
  let entityId = body.entityId !== undefined ? body.entityId : target.entity_id
  if (user.role === 'SA') entityId = user.entity_id
  if (role === 'MA') entityId = null
  await run(
    c.env.DB,
    `UPDATE users SET name = ?, role = ?, entity_id = ?, job_title = ?, phone = ?, is_active = ? WHERE id = ?`,
    body.name ?? target.name, role, entityId,
    body.jobTitle !== undefined ? body.jobTitle : target.job_title,
    body.phone !== undefined ? body.phone : target.phone,
    body.isActive !== undefined ? (body.isActive ? 1 : 0) : target.is_active,
    target.id,
  )
  if (body.password) {
    if (String(body.password).length < 8) return c.json({ error: 'Kata sandi minimal 8 karakter.' }, 400)
    const { hash, salt } = await hashPassword(String(body.password))
    await run(c.env.DB, `UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE id = ?`, hash, salt, target.id)
    await run(c.env.DB, `DELETE FROM sessions WHERE user_id = ?`, target.id)
  }
  if (body.isActive === false) await run(c.env.DB, `DELETE FROM sessions WHERE user_id = ?`, target.id)
  await audit(c.env, user, 'user.updated', 'user', target.id, `Memperbarui akun ${body.name ?? target.name}`, entityId)
  return c.json({ user: publicUser(await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ?`, target.id)) })
})

adminRoutes.delete('/admin/users/:id', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const target = await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ?`, c.req.param('id'))
  if (!target) return c.json({ error: 'Pengguna tidak ditemukan.' }, 404)
  if (target.id === user.id) return c.json({ error: 'Anda tidak dapat menonaktifkan akun sendiri.' }, 400)
  if (user.role === 'SA' && (target.role === 'MA' || target.entity_id !== user.entity_id)) {
    throw new HttpError(403, 'Tidak diizinkan.')
  }
  // Deactivation revokes access but keeps every historical record intact.
  await run(c.env.DB, `UPDATE users SET is_active = 0 WHERE id = ?`, target.id)
  await run(c.env.DB, `DELETE FROM sessions WHERE user_id = ?`, target.id)
  await audit(c.env, user, 'user.deactivated', 'user', target.id, `Menonaktifkan akun ${target.name}`, target.entity_id)
  return c.json({ ok: true })
})

adminRoutes.post('/admin/users/import', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const body = await c.req.json().catch(() => ({}))
  const rows: any[] = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) return c.json({ error: 'Tidak ada baris untuk diimpor.' }, 400)
  const entities = await q<any>(c.env.DB, `SELECT * FROM entities`)
  const defaultEntity = await resolveEntity(c.env, c, user)
  const results: any[] = []
  const existing = await q<any>(c.env.DB, `SELECT email FROM users`)
  const seen = new Set(existing.map((e: any) => e.email.toLowerCase()))
  for (const [index, row] of rows.entries()) {
    const email = String(row.email ?? '').trim().toLowerCase()
    const name = String(row.name ?? '').trim()
    const role = String(row.role ?? 'PA').toUpperCase()
    const entityKey = String(row.entity ?? row.entityKey ?? '').trim().toLowerCase()
    const problems: string[] = []
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('email tidak valid')
    if (name.length < 2) problems.push('nama kosong')
    if (!['MA', 'SA', 'PA'].includes(role)) problems.push('peran harus MA/SA/PA')
    if (seen.has(email)) problems.push('email sudah terdaftar')
    let entityId: string | null = null
    if (role !== 'MA') {
      const entity = entityKey
        ? entities.find((e: any) => e.key === entityKey)
        : defaultEntity
      if (!entity) problems.push('entitas tidak ditemukan')
      else entityId = entity.id
      if (user.role === 'SA' && entityId !== user.entity_id) problems.push('di luar entitas Anda')
      if (user.role === 'SA' && role === 'MA') problems.push('tidak boleh membuat Master Admin')
    }
    if (problems.length) {
      results.push({ row: index + 2, email, name, status: 'invalid', problems })
      continue
    }
    seen.add(email)
    const password = randomPassword()
    const { hash, salt } = await hashPassword(password)
    const id = uid('usr_')
    await run(
      c.env.DB,
      `INSERT INTO users (id, email, password_hash, password_salt, name, role, entity_id, job_title, phone, is_active, must_change_password, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,1,?)`,
      id, email, hash, salt, name, role, entityId, row.jobTitle ? String(row.jobTitle) : null,
      row.phone ? String(row.phone) : null, nowIso(),
    )
    results.push({ row: index + 2, email, name, role, status: 'created', temporaryPassword: password })
  }
  const created = results.filter((r) => r.status === 'created').length
  await audit(c.env, user, 'user.imported', 'user', null, `Impor pengguna: ${created} akun dibuat`, defaultEntity.id)
  return c.json({ results, created, invalid: results.length - created })
})

adminRoutes.get('/admin/audit', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const entity = await resolveEntity(c.env, c, user)
  const limit = Math.min(Number(c.req.query('limit') ?? 80), 200)
  const rows = await q<any>(
    c.env.DB,
    `SELECT a.*, e.name AS entity_name FROM audit_log a LEFT JOIN entities e ON e.id = a.entity_id
     WHERE a.entity_id = ? OR a.entity_id IS NULL ORDER BY a.created_at DESC LIMIT ?`,
    entity.id, limit,
  )
  return c.json({
    audit: rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })),
  })
})

adminRoutes.get('/admin/branding', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const entities = await q<any>(c.env.DB, `SELECT * FROM entities ORDER BY sort_order`)
  const global = await getConfig<BrandingGlobal>(c.env, 'branding:global', DEFAULT_GLOBAL)
  const cards: Record<string, BrandingEntity> = {}
  for (const e of entities) {
    cards[e.key] = await getConfig<BrandingEntity>(c.env, `branding:${e.key}`, DEFAULT_ENTITY[e.key])
    if (user.role === 'SA' && e.id !== user.entity_id) delete cards[e.key]
  }
  return c.json({
    global: user.role === 'MA' ? global : null,
    cards,
    entities: entities.filter((e) => user.role === 'MA' || e.id === user.entity_id),
    canEditGlobal: user.role === 'MA',
  })
})

adminRoutes.put('/admin/branding', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const body = await c.req.json().catch(() => ({}))
  const scope = String(body.scope ?? '')
  if (scope === 'global') {
    if (user.role !== 'MA') throw new HttpError(403, 'Hanya Master Admin yang dapat mengubah branding global.')
    const current = await getConfig<BrandingGlobal>(c.env, 'branding:global', DEFAULT_GLOBAL)
    const next = { ...current, ...(body.values ?? {}) }
    await setConfig(c.env, 'branding:global', next, user.id)
    await audit(c.env, user, 'branding.updated', 'config', 'global', 'Memperbarui branding global', null)
    return c.json({ global: next })
  }
  const entity = await one<any>(c.env.DB, `SELECT * FROM entities WHERE key = ?`, scope)
  if (!entity) return c.json({ error: 'Entitas tidak ditemukan.' }, 404)
  if (user.role === 'SA' && user.entity_id !== entity.id) throw new HttpError(403, 'Hanya untuk entitas Anda.')
  const current = await getConfig<BrandingEntity>(c.env, `branding:${entity.key}`, DEFAULT_ENTITY[entity.key])
  const next = { ...current, ...(body.values ?? {}), key: entity.key }
  await setConfig(c.env, `branding:${entity.key}`, next, user.id)
  await run(c.env.DB, `UPDATE entities SET name = ? WHERE id = ?`, next.name || entity.name, entity.id)
  await audit(c.env, user, 'branding.updated', 'entity', entity.id, `Memperbarui branding ${entity.name}`, entity.id)
  return c.json({ card: next })
})

adminRoutes.get('/admin/overview', async (c) => {
  const user = c.get('user')
  assertRole(user, ['MA', 'SA'])
  const entity = await resolveEntity(c.env, c, user)
  const stats = await one<any>(
    c.env.DB,
    `SELECT (SELECT COUNT(*) FROM users WHERE entity_id = ? AND is_active = 1) AS users,
      (SELECT COUNT(*) FROM projects WHERE entity_id = ? AND deleted_at IS NULL) AS projects,
      (SELECT COUNT(*) FROM events WHERE entity_id = ? AND cancelled_at IS NULL) AS events,
      (SELECT COUNT(*) FROM audit_log WHERE entity_id = ?) AS audit_entries`,
    entity.id, entity.id, entity.id, entity.id,
  )
  const entities = await q<any>(c.env.DB, `SELECT * FROM entities ORDER BY sort_order`)
  return c.json({ stats, entity, entities })
})
