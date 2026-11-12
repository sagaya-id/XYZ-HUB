import { q, run, uid, nowIso, one, parseJson } from './db'
import type { SessionUser } from './auth'

export type NotifyInput = {
  userIds: string[]
  type: string
  title: string
  body?: string | null
  link?: string | null
  entityId?: string | null
  projectId?: string | null
  dedupeKey?: string | null
}

/** Persistent, deduplicated, preference-aware in-app notification fan-out. */
export async function notify(env: any, input: NotifyInput) {
  const targets = [...new Set(input.userIds.filter(Boolean))]
  for (const userId of targets) {
    const pref = await one<any>(
      env.DB,
      `SELECT enabled FROM notification_prefs WHERE user_id = ? AND type = ?`,
      userId, input.type,
    )
    if (pref && pref.enabled === 0) continue
    const dedupe = input.dedupeKey ?? null
    try {
      await run(
        env.DB,
        `INSERT INTO notifications (id, user_id, type, title, body, link, entity_id, project_id, dedupe_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uid('ntf_'), userId, input.type, input.title, input.body ?? null, input.link ?? null,
        input.entityId ?? null, input.projectId ?? null, dedupe, nowIso(),
      )
    } catch {
      /* duplicate dedupe key — ignore */
    }
  }
}

export async function projectMemberIds(env: any, projectId: string, onlyAdmins = false): Promise<string[]> {
  const rows = await q<any>(
    env.DB,
    `SELECT user_id FROM project_members WHERE project_id = ?${onlyAdmins ? ` AND access = 'admin'` : ''}`,
    projectId,
  )
  return rows.map((r) => r.user_id)
}

export async function audit(
  env: any,
  user: SessionUser | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  summary: string,
  entityId?: string | null,
  meta?: any,
) {
  await run(
    env.DB,
    `INSERT INTO audit_log (id, actor_id, actor_name, entity_id, action, target_type, target_id, summary, meta, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    uid('aud_'), user?.id ?? null, user?.name ?? 'Sistem', entityId ?? user?.entity_id ?? null,
    action, targetType, targetId, summary, meta ? JSON.stringify(meta) : null, nowIso(),
  )
}

export type BrandingGlobal = {
  siteName: string
  eyebrow: string
  landingHeadline: string
  landingSubtitle: string
  footerText: string
  primaryColor: string
  logoFileId: string | null
  loginHeroFileId: string | null
  loginHeroUrl: string
  mapTileUrl: string
  mapAttribution: string
}

export type BrandingEntity = {
  key: string
  name: string
  headline: string
  slogan: string
  description: string
  cardPhotoFileId: string | null
  cardPhotoUrl: string
  bannerFileId: string | null
  logoFileId: string | null
  primaryColor: string
  footerText: string
}

export const DEFAULT_GLOBAL: BrandingGlobal = {
  siteName: 'XYZ Project Hub',
  eyebrow: 'Multi-entity project monitoring',
  landingHeadline: 'Satu hub untuk seluruh proyek kebaikan.',
  landingSubtitle:
    'Pantau proyek, lokasi, tim, dan anggaran Yayasan XYZ dan XYZ Store dalam satu platform yang tenang, rapi, dan aman.',
  footerText: '© 2026 XYZ Project Hub. Dipercaya untuk mengelola program lintas entitas.',
  primaryColor: '#245A46',
  logoFileId: null,
  loginHeroFileId: null,
  loginHeroUrl:
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1600&q=80',
  mapTileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

export const DEFAULT_ENTITY: Record<string, BrandingEntity> = {
  yayasan: {
    key: 'yayasan',
    name: 'Yayasan XYZ',
    headline: 'Menumbuhkan dampak sosial yang berkelanjutan.',
    slogan: 'Pendidikan, lingkungan, dan pemberdayaan masyarakat.',
    description:
      'Portal program yayasan: pemantauan sekolah binaan, konservasi, dan pemberdayaan komunitas di seluruh wilayah kerja.',
    cardPhotoFileId: null,
    cardPhotoUrl:
      'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=1400&q=80',
    bannerFileId: null,
    logoFileId: null,
    primaryColor: '#245A46',
    footerText: 'Yayasan XYZ — tumbuh bersama masyarakat.',
  },
  store: {
    key: 'store',
    name: 'XYZ Store',
    headline: 'Ritel yang menggerakkan komunitas.',
    slogan: 'Produk lokal, operasional yang rapi.',
    description:
      'Portal unit usaha: pemantauan cabang, gudang, dan program loyalitas pelanggan dengan data operasional yang akurat.',
    cardPhotoFileId: null,
    cardPhotoUrl:
      'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1400&q=80',
    bannerFileId: null,
    logoFileId: null,
    primaryColor: '#1F4E5F',
    footerText: 'XYZ Store — melayani dengan konsisten.',
  },
}

export async function getConfig<T>(env: any, key: string, fallback: T): Promise<T> {
  const row = await one<any>(env.DB, `SELECT value FROM app_config WHERE key = ?`, key)
  if (!row) return fallback
  return { ...fallback, ...parseJson<Partial<T>>(row.value, {}) } as T
}

export async function setConfig(env: any, key: string, value: any, userId?: string) {
  await run(
    env.DB,
    `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    key, JSON.stringify(value), nowIso(), userId ?? null,
  )
}

export function fileUrl(id: string | null | undefined): string | null {
  return id ? `/api/files/${id}` : null
}

export function money(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)
}
