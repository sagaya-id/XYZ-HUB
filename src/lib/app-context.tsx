import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { api, ApiError } from './api'
import type { Boot, Entity, Notification, User } from './types'

export type MeResponse = {
  user: User
  entity: Entity | null
  memberships: { id: string; title: string; access: string; is_primary_pic: number }[]
  unreadCount: number
  isMaster: boolean
}

type Toast = { id: number; message: string; kind: 'success' | 'error' | 'info' }

type AppContextValue = {
  boot: Boot | null
  me: MeResponse | null
  loading: boolean
  refreshMe: () => Promise<void>
  refreshBoot: () => Promise<void>
  notifications: Notification[]
  unreadCount: number
  refreshNotifications: () => Promise<void>
  toast: (message: string, kind?: Toast['kind']) => void
  logout: () => Promise<void>
  setMe: (me: MeResponse | null) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot | null>(null)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const toast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, message, kind }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4800)
  }, [])

  const refreshBoot = useCallback(async () => {
    try {
      const data = await api.get<Boot>('/api/boot')
      setBoot(data)
    } catch {
      /* keep last known branding */
    }
  }, [])

  const refreshMe = useCallback(async () => {
    try {
      const data = await api.get<MeResponse>('/api/auth/me')
      setMe(data)
      setUnreadCount(data.unreadCount)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null)
    }
  }, [])

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await api.get<{ notifications: Notification[]; unreadCount: number }>('/api/notifications')
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
    } catch {
      /* ignore when signed out */
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => null)
    setMe(null)
    setNotifications([])
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refreshBoot()
      try {
        const data = await api.get<MeResponse>('/api/auth/me')
        if (!cancelled) {
          setMe(data)
          setUnreadCount(data.unreadCount)
        }
      } catch {
        if (!cancelled) setMe(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [refreshBoot])

  useEffect(() => {
    if (!me) return
    refreshNotifications()
    const timer = setInterval(refreshNotifications, 90_000)
    return () => clearInterval(timer)
  }, [me, refreshNotifications])

  const value = useMemo<AppContextValue>(
    () => ({
      boot, me, loading, refreshMe, refreshBoot, notifications, unreadCount,
      refreshNotifications, toast, logout, setMe,
    }),
    [boot, me, loading, refreshMe, refreshBoot, notifications, unreadCount, refreshNotifications, toast, logout],
  )

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm shadow-[0_18px_40px_-20px_rgba(31,41,51,0.5)] ${
              t.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : t.kind === 'info'
                  ? 'border-line bg-white text-ink'
                  : 'border-forest/20 bg-forest text-white'
            }`}
          >
            <span className="mt-0.5 text-base leading-none">{t.kind === 'error' ? '!' : t.kind === 'info' ? 'i' : '✓'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp harus dipakai di dalam AppProvider')
  return ctx
}

export function useEntityKey(): 'yayasan' | 'store' {
  const { me, boot } = useApp()
  const fromUrl = typeof window !== 'undefined' ? window.location.pathname.split('/')[2] : ''
  if (fromUrl === 'yayasan' || fromUrl === 'store') return fromUrl
  if (me?.entity?.key) return me.entity.key as 'yayasan' | 'store'
  const first = boot?.entities?.[0]?.key
  return (first as 'yayasan' | 'store') ?? 'yayasan'
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useAsync<T>(fn: () => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      setData(result)
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, deps)
  useEffect(() => { reload() }, [reload])
  return { data, loading, error, reload, setData }
}
