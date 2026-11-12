import { one, q, run, uid, nowIso } from './db'

export const SESSION_COOKIE = 'xyz_session'
const SESSION_DAYS = 14
const ITERATIONS = 120000

const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return toHex(bits)
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, ITERATIONS)
  return { hash, salt: toHex(salt.buffer as ArrayBuffer) }
}

export async function verifyPassword(password: string, hash: string, saltHex: string): Promise<boolean> {
  const computed = await pbkdf2(password, fromHex(saltHex), ITERATIONS)
  if (computed.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value))
  return toHex(digest)
}

export async function createSession(db: any, userId: string, userAgent: string | null) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer)
  const tokenHash = await sha256(token)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  await run(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, user_agent) VALUES (?,?,?,?,?,?)`,
    uid('ses_'), userId, tokenHash, expiresAt, nowIso(), userAgent,
  )
  await run(db, `DELETE FROM sessions WHERE expires_at < ?`, nowIso())
  return { token, expiresAt }
}

export type SessionUser = {
  id: string
  email: string
  name: string
  role: 'MA' | 'SA' | 'PA'
  entity_id: string | null
  job_title: string | null
  phone: string | null
  avatar_id: string | null
  is_active: number
}

export async function userFromRequest(db: any, cookieHeader: string | null): Promise<SessionUser | null> {
  if (!cookieHeader) return null
  const token = parseCookie(cookieHeader, SESSION_COOKIE)
  if (!token) return null
  const tokenHash = await sha256(token)
  const row = await one<any>(
    db,
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    tokenHash, nowIso(),
  )
  if (!row) return null
  return row as SessionUser
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_DAYS * 86400): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export async function revokeSession(db: any, cookieHeader: string | null) {
  const token = parseCookie(cookieHeader, SESSION_COOKIE)
  if (!token) return
  await run(db, `DELETE FROM sessions WHERE token_hash = ?`, await sha256(token))
}

export async function revokeAllUserSessions(db: any, userId: string, exceptCookie?: string | null) {
  if (exceptCookie) {
    await run(db, `DELETE FROM sessions WHERE user_id = ?`, userId)
    return
  }
  await run(db, `DELETE FROM sessions WHERE user_id = ?`, userId)
}

export async function entityOf(db: any, entityId: string | null) {
  if (!entityId) return null
  return one<any>(db, `SELECT * FROM entities WHERE id = ?`, entityId)
}

export async function membershipFor(db: any, userId: string, projectId: string) {
  return one<any>(db, `SELECT * FROM project_members WHERE project_id = ? AND user_id = ?`, projectId, userId)
}

export async function accessibleProject(db: any, user: SessionUser, projectId: string) {
  const project = await one<any>(db, `SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL`, projectId)
  if (!project) return null
  if (user.role === 'MA') return project
  if (user.role === 'SA') return project.entity_id === user.entity_id ? project : null
  const member = await membershipFor(db, user.id, projectId)
  return member ? project : null
}

export async function projectIdsForUser(db: any, user: SessionUser, entityId?: string | null): Promise<string[]> {
  if (user.role === 'MA') {
    const rows = entityId
      ? await q<any>(db, `SELECT id FROM projects WHERE entity_id = ? AND deleted_at IS NULL`, entityId)
      : await q<any>(db, `SELECT id FROM projects WHERE deleted_at IS NULL`)
    return rows.map((r) => r.id)
  }
  if (user.role === 'SA') {
    const rows = await q<any>(db, `SELECT id FROM projects WHERE entity_id = ? AND deleted_at IS NULL`, user.entity_id)
    return rows.map((r) => r.id)
  }
  const rows = await q<any>(
    db,
    `SELECT p.id FROM projects p JOIN project_members m ON m.project_id = p.id
     WHERE m.user_id = ? AND p.deleted_at IS NULL`,
    user.id,
  )
  return rows.map((r) => r.id)
}

export async function isProjectAdmin(db: any, user: SessionUser, projectId: string): Promise<boolean> {
  if (user.role === 'MA') return true
  if (user.role === 'SA') {
    const p = await one<any>(db, `SELECT entity_id FROM projects WHERE id = ?`, projectId)
    return !!p && p.entity_id === user.entity_id
  }
  const member = await membershipFor(db, user.id, projectId)
  return !!member && member.access === 'admin'
}

export async function canContribute(db: any, user: SessionUser, projectId: string): Promise<boolean> {
  if (user.role === 'MA') return true
  if (user.role === 'SA') {
    const p = await one<any>(db, `SELECT entity_id FROM projects WHERE id = ?`, projectId)
    return !!p && p.entity_id === user.entity_id
  }
  return !!(await membershipFor(db, user.id, projectId))
}

/** Members (and entity admins) allowed to see "team only" material. */
export async function canSeeTeamMaterial(db: any, user: SessionUser, projectId: string): Promise<boolean> {
  return canContribute(db, user, projectId)
}

export async function entityMembers(db: any, entityId: string) {
  return q<any>(db, `SELECT * FROM users WHERE is_active = 1 AND (entity_id = ? OR role = 'MA')`, entityId)
}
