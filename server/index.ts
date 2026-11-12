import { Hono } from 'hono'
import type { AppEnv } from './ctx'
import { run, one, nowIso, type Env } from './db'
import { SCHEMA } from './schema'
import { HttpError } from './scope'
import { userFromRequest, SESSION_COOKIE, type SessionUser } from './auth'
import { ensureSeed } from './seed'
import { authRoutes } from './routes/auth'
import { projectRoutes } from './routes/projects'
import { taskRoutes } from './routes/tasks'
import { eventRoutes } from './routes/events'
import { locationRoutes } from './routes/locations'
import { logbookRoutes } from './routes/logbooks'
import { budgetRoutes } from './routes/budget'
import { noteRoutes } from './routes/notes'
import { dataRoutes } from './routes/data'
import { fileRoutes } from './routes/files'
import { notificationRoutes } from './routes/notifications'
import { adminRoutes } from './routes/admin'
import { homeRoutes } from './routes/home'

const app = new Hono<AppEnv>()

let bootPromise: Promise<void> | null = null

async function boot(env: Env) {
  if (!bootPromise) {
    bootPromise = (async () => {
      for (const stmt of SCHEMA) {
        try {
          await run(env.DB, stmt)
        } catch (err) {
          // Table/index already present or statement needs no-op; surface real errors
          console.error('schema statement failed', err)
        }
      }
      await ensureSeed(env)
    })().catch((err) => {
      bootPromise = null
      throw err
    })
  }
  return bootPromise
}

app.use('/api/*', async (c, next) => {
  await boot(c.env)
  await next()
})

// Reject cross-site state-changing requests (CSRF hardening).
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin')
    const host = c.req.header('host')
    if (origin && host) {
      try {
        const originHost = new URL(origin).host
        if (originHost !== host && !originHost.endsWith('.style.dev')) {
          return c.json({ error: 'Permintaan lintas situs ditolak.' }, 403)
        }
      } catch {
        return c.json({ error: 'Origin tidak valid.' }, 403)
      }
    }
  }
  await next()
})

const PUBLIC_PATHS = new Set([
  '/api/boot',
  '/api/auth/login',
  '/api/auth/logout',
])

app.use('/api/*', async (c, next) => {
  const path = c.req.path
  if (PUBLIC_PATHS.has(path)) return next()
  const user = await userFromRequest(c.env.DB, c.req.header('cookie') ?? null)
  if (!user) return c.json({ error: 'Sesi tidak valid. Silakan masuk kembali.', code: 'UNAUTHENTICATED' }, 401)
  if (!user.is_active) return c.json({ error: 'Akun dinonaktifkan.' }, 403)
  c.set('user', user)
  await next()
})

app.route('/api', authRoutes)
app.route('/api', homeRoutes)
app.route('/api', projectRoutes)
app.route('/api', taskRoutes)
app.route('/api', eventRoutes)
app.route('/api', locationRoutes)
app.route('/api', logbookRoutes)
app.route('/api', budgetRoutes)
app.route('/api', noteRoutes)
app.route('/api', dataRoutes)
app.route('/api', fileRoutes)
app.route('/api', notificationRoutes)
app.route('/api', adminRoutes)

app.all('/api/*', (c) => c.json({ error: 'Endpoint tidak ditemukan.' }, 404))

app.all('*', async (c) => {
  const assets = (c.env as Env).ASSETS
  if (assets) {
    const res = await assets.fetch(c.req.raw)
    if (res.status !== 404) return res
    // SPA fallback for client-side routes
    const indexUrl = new URL(c.req.url)
    indexUrl.pathname = '/index.html'
    return assets.fetch(new Request(indexUrl.toString(), c.req.raw))
  }
  return c.text('Not found', 404)
})

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as any)
  }
  console.error('unhandled', err)
  return c.json({ error: 'Terjadi kesalahan pada server.', detail: String(err?.message ?? err) }, 500)
})

export default app
