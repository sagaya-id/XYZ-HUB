import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import {
  createSession, sessionCookie, clearSessionCookie, verifyPassword, hashPassword,
  revokeSession, userFromRequest,
} from '../auth'
import { audit, getConfig, DEFAULT_GLOBAL, DEFAULT_ENTITY, type BrandingGlobal, type BrandingEntity } from '../lib'

export const authRoutes = new Hono<AppEnv>()

const loginAttempts = new Map<string, { count: number; first: number }>()

function tooManyAttempts(key: string) {
  const rec = loginAttempts.get(key)
  if (!rec) return false
  if (Date.now() - rec.first > 10 * 60_000) {
    loginAttempts.delete(key)
    return false
  }
  return rec.count >= 10
}

function recordFailure(key: string) {
  const rec = loginAttempts.get(key)
  if (!rec) loginAttempts.set(key, { count: 1, first: Date.now() })
  else rec.count += 1
}

authRoutes.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!email || !password) return c.json({ error: 'Email dan kata sandi wajib diisi.' }, 400)
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local'
  const attemptKey = `${ip}:${email}`
  if (tooManyAttempts(attemptKey)) {
    return c.json({ error: 'Terlalu banyak percobaan masuk. Coba lagi dalam 10 menit.' }, 429)
  }
  const user = await one<any>(c.env.DB, `SELECT * FROM users WHERE email = ?`, email)
  if (!user || !user.is_active) {
    recordFailure(attemptKey)
    return c.json({ error: 'Email atau kata sandi tidak sesuai.' }, 401)
  }
  const ok = await verifyPassword(password, user.password_hash, user.password_salt)
  if (!ok) {
    recordFailure(attemptKey)
    return c.json({ error: 'Email atau kata sandi tidak sesuai.' }, 401)
  }
  loginAttempts.delete(attemptKey)
  const { token } = await createSession(c.env.DB, user.id, c.req.header('user-agent') ?? null)
  await run(c.env.DB, `UPDATE users SET last_login_at = ? WHERE id = ?`, nowIso(), user.id)
  await audit(c.env, user, 'auth.login', 'user', user.id, `${user.name} masuk ke aplikasi`, user.entity_id)
  c.header('Set-Cookie', sessionCookie(token))
  return c.json({
    user: publicUser(user),
    mustChangePassword: user.must_change_password === 1,
  })
})

authRoutes.post('/auth/logout', async (c) => {
  const user = await userFromRequest(c.env.DB, c.req.header('cookie') ?? null)
  await revokeSession(c.env.DB, c.req.header('cookie') ?? null)
  if (user) await audit(c.env, user, 'auth.logout', 'user', user.id, `${user.name} keluar`, user.entity_id)
  c.header('Set-Cookie', clearSessionCookie())
  return c.json({ ok: true })
})

authRoutes.get('/auth/me', async (c) => {
  const user = c.get('user')
  const entity = user.entity_id
    ? await one<any>(c.env.DB, `SELECT * FROM entities WHERE id = ?`, user.entity_id)
    : null
  const memberships = await q<any>(
    c.env.DB,
    `SELECT p.id, p.title, m.access, m.is_primary_pic FROM project_members m
     JOIN projects p ON p.id = m.project_id
     WHERE m.user_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL`,
    user.id,
  )
  const unread = await one<any>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    user.id,
  )
  return c.json({
    user: publicUser(user),
    entity,
    memberships,
    unreadCount: unread?.n ?? 0,
    isMaster: user.role === 'MA',
  })
})

authRoutes.get('/boot', async (c) => {
  const entities = await q<any>(c.env.DB, `SELECT * FROM entities ORDER BY sort_order`)
  const global = await getConfig<BrandingGlobal>(c.env, 'branding:global', DEFAULT_GLOBAL)
  const cards: Record<string, BrandingEntity> = {}
  for (const e of entities) {
    cards[e.key] = await getConfig<BrandingEntity>(c.env, `branding:${e.key}`, DEFAULT_ENTITY[e.key])
  }
  return c.json({ entities, global, cards, appEnv: c.env.APP_ENV ?? 'production' })
})

authRoutes.post('/auth/password', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const current = String(body.current ?? '')
  const next = String(body.next ?? '')
  if (next.length < 8) return c.json({ error: 'Kata sandi baru minimal 8 karakter.' }, 400)
  const row = await one<any>(c.env.DB, `SELECT password_hash, password_salt FROM users WHERE id = ?`, user.id)
  if (!row || !(await verifyPassword(current, row.password_hash, row.password_salt))) {
    return c.json({ error: 'Kata sandi saat ini tidak sesuai.' }, 400)
  }
  const { hash, salt } = await hashPassword(next)
  await run(
    c.env.DB,
    `UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?`,
    hash, salt, user.id,
  )
  await audit(c.env, user, 'auth.password_changed', 'user', user.id, `${user.name} mengubah kata sandi`, user.entity_id)
  return c.json({ ok: true })
})

authRoutes.patch('/auth/profile', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name ?? '').trim()
  if (name.length < 2) return c.json({ error: 'Nama minimal 2 karakter.' }, 400)
  let avatarId = body.avatarId === undefined ? user.avatar_id : (body.avatarId || null)
  if (avatarId) {
    const file = await one<any>(c.env.DB, `SELECT id, uploaded_by FROM files WHERE id = ?`, avatarId)
    if (!file) return c.json({ error: 'Berkas avatar tidak ditemukan.' }, 400)
  }
  await run(
    c.env.DB,
    `UPDATE users SET name = ?, phone = ?, job_title = ?, avatar_id = ? WHERE id = ?`,
    name, body.phone ? String(body.phone) : null, body.jobTitle ? String(body.jobTitle) : null, avatarId, user.id,
  )
  const updated = await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ?`, user.id)
  await audit(c.env, user, 'user.profile_updated', 'user', user.id, `${name} memperbarui profil`, user.entity_id)
  return c.json({ user: publicUser(updated) })
})

export function publicUser(u: any) {
  if (!u) return null
  const { password_hash, password_salt, ...rest } = u
  return rest
}
