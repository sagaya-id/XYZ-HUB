export type Env = {
  DB: any
  FILES: any
  ASSETS?: { fetch: (req: Request) => Promise<Response> }
  APP_ENV?: string
}

export const uid = (prefix = '') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
export const nowIso = () => new Date().toISOString()

export async function q<T = any>(db: any, sql: string, ...params: any[]): Promise<T[]> {
  const stmt = db.prepare(sql)
  const bound = params.length ? stmt.bind(...params) : stmt
  const res = await bound.all()
  return (res?.results ?? []) as T[]
}

export async function one<T = any>(db: any, sql: string, ...params: any[]): Promise<T | null> {
  const stmt = db.prepare(sql)
  const bound = params.length ? stmt.bind(...params) : stmt
  const row = await bound.first()
  return (row ?? null) as T | null
}

export async function run(db: any, sql: string, ...params: any[]): Promise<void> {
  const stmt = db.prepare(sql)
  await (params.length ? stmt.bind(...params) : stmt).run()
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
