import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlarmClock, Bell, Building2, CalendarDays, CheckCheck, ChevronDown, Home, LayoutGrid, LogOut, MapPinned,
  MoreHorizontal, Settings, ShieldCheck, User as UserIcon, X,
} from 'lucide-react'
import { useApp } from '../lib/app-context'
import { api } from '../lib/api'
import { Avatar, EmptyState, Modal, cn, Spinner } from './ui'
import { relativeTime } from '../lib/format'

const ROLE_LABEL: Record<string, string> = {
  MA: 'Master Admin',
  SA: 'Super Admin',
  PA: 'Project Admin',
}

export function AppShell() {
  const { me, boot, loading, refreshNotifications, logout, toast } = useApp()
  const params = useParams<{ entity: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [bellOpen, setBellOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const entityKey = params.entity as string
  const entity = boot?.entities.find((e) => e.key === entityKey)
  const card = boot?.cards?.[entityKey]

  const isAdmin = me?.user.role === 'MA' || me?.user.role === 'SA'

  useEffect(() => {
    if (!me) return
    if (me.user.role !== 'MA' && me.entity?.key && me.entity.key !== entityKey) {
      navigate(`/app/${me.entity.key}${location.pathname.split('/').slice(3).join('/') ? `/${location.pathname.split('/').slice(3).join('/')}` : '/home'}`, { replace: true })
    }
  }, [me, entityKey, navigate, location.pathname])

  const title = useMemo(() => {
    const path = location.pathname
    if (path.includes('/projects/')) return 'Ruang Kerja Proyek'
    if (path.endsWith('/projects')) return 'Katalog Proyek'
    if (path.endsWith('/locations')) return 'Peta Lokasi'
    if (path.endsWith('/calendar')) return 'Kalender'
    if (path.endsWith('/reminders')) return 'Pengingat'
    if (path.endsWith('/admin')) return 'Administrasi'
    if (path.endsWith('/profile')) return 'Profil Saya'
    return 'Home'
  }, [location.pathname])

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas">
        <div className="flex items-center gap-3 text-sm text-muted"><Spinner className="h-5 w-5" /> Memuat XYZ Project Hub…</div>
      </div>
    )
  }
  if (!me) return <Navigate to="/login" replace />
  if (!entity) return <Navigate to={`/app/${me.entity?.key ?? 'yayasan'}/home`} replace />

  const nav = [
    { to: `/app/${entityKey}/home`, label: 'Home', icon: Home },
    { to: `/app/${entityKey}/projects`, label: 'Proyek', icon: LayoutGrid },
    { to: `/app/${entityKey}/locations`, label: 'Lokasi', icon: MapPinned },
    { to: `/app/${entityKey}/calendar`, label: 'Kalender', icon: CalendarDays },
    { to: `/app/${entityKey}/reminders`, label: 'Pengingat', icon: AlarmClock },
  ]
  if (isAdmin) nav.push({ to: `/app/${entityKey}/admin`, label: 'Administrasi', icon: ShieldCheck })

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto flex w-full max-w-[1500px]">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line bg-white/70 px-4 py-5 lg:flex">
          <Link to={`/app/${entityKey}/home`} className="flex items-center gap-2.5 px-2">
            {card?.logoFileId ? (
              <img src={`/api/files/${card.logoFileId}`} alt="" className="h-9 w-9 rounded-xl object-cover" />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-sm font-bold text-white">X</span>
            )}
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold text-ink">XYZ Hub</span>
              <span className="block text-[11px] text-muted">Project Monitoring</span>
            </span>
          </Link>

          {me.user.role === 'MA' ? (
            <div className="mt-4">
              <p className="label mb-1.5 px-2 text-[10px]">Entitas aktif</p>
              <div className="relative">
                <select
                  value={entityKey}
                  onChange={(e) => navigate(`/app/${e.target.value}/home`)}
                  className="w-full appearance-none rounded-xl border border-line bg-white px-3 py-2.5 pr-8 text-sm font-medium text-ink focus:border-forest/40 focus:outline-none"
                >
                  {boot?.entities.map((e) => <option key={e.key} value={e.key}>{e.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-muted" />
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-forest-50 px-3 py-2.5">
              <Building2 className="h-4 w-4 text-forest" />
              <span className="text-sm font-medium text-forest">{entity.name}</span>
            </div>
          )}

          <nav className="mt-6 flex-1 space-y-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn('nav-item', (isActive || (item.label === 'Proyek' && location.pathname.includes('/projects/'))) && 'nav-item-active')}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-4 rounded-2xl border border-line bg-canvas/70 p-3">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">Masuk sebagai</p>
            <div className="mt-2 flex items-center gap-2.5">
              <Avatar name={me.user.name} url={me.user.avatar_id ? `/api/files/${me.user.avatar_id}` : null} size={34} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{me.user.name}</p>
                <p className="text-[11px] text-muted">{ROLE_LABEL[me.user.role]}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-1.5">
              <Link to={`/app/${entityKey}/profile`} className="btn-secondary btn-sm flex-1">Profil</Link>
              <button
                className="btn-ghost btn-sm"
                title="Keluar"
                onClick={async () => { await logout(); navigate('/login') }}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Topbar */}
          <header className="sticky top-0 z-[500] border-b border-line glass">
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <Link to={`/app/${entityKey}/home`} className="lg:hidden">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-sm font-bold text-white">X</span>
                </Link>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium tracking-wide text-muted uppercase">{entity.name}</p>
                  <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
                </div>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Link to={`/app/${entityKey}/calendar`} className="hidden rounded-full p-2.5 text-muted hover:bg-sand hover:text-ink sm:block" title="Kalender">
                  <CalendarDays className="h-4 w-4" />
                </Link>
                <Link to={`/app/${entityKey}/reminders`} className="hidden rounded-full p-2.5 text-muted hover:bg-sand hover:text-ink sm:block" title="Pengingat">
                  <AlarmClock className="h-4 w-4" />
                </Link>
                <div className="relative" ref={bellRef}>
                  <button
                    onClick={() => { setBellOpen((v) => !v); if (!bellOpen) refreshNotifications() }}
                    className="relative rounded-full p-2.5 text-muted hover:bg-sand hover:text-ink"
                    aria-label="Notifikasi"
                  >
                    <Bell className="h-4 w-4" />
                    {me.unreadCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                        {me.unreadCount > 9 ? '9+' : me.unreadCount}
                      </span>
                    )}
                  </button>
                  {bellOpen && <NotificationPanel onClose={() => setBellOpen(false)} entityKey={entityKey} />}
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pr-2.5 pl-1 hover:border-forest/30"
                  >
                    <Avatar name={me.user.name} url={me.user.avatar_id ? `/api/files/${me.user.avatar_id}` : null} size={30} />
                    <span className="hidden text-left sm:block">
                      <span className="block max-w-[130px] truncate text-xs font-medium text-ink">{me.user.name}</span>
                      <span className="block text-[10px] text-muted">{ROLE_LABEL[me.user.role]}</span>
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted" />
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                      <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-white py-1.5 shadow-[0_24px_48px_-24px_rgba(31,41,51,0.4)]">
                        <div className="border-b border-line px-3.5 py-2.5">
                          <p className="truncate text-sm font-medium text-ink">{me.user.name}</p>
                          <p className="truncate text-xs text-muted">{me.user.email}</p>
                        </div>
                        <Link to={`/app/${entityKey}/profile`} onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-ink hover:bg-canvas">
                          <UserIcon className="h-4 w-4 text-muted" /> Profil & preferensi
                        </Link>
                        {isAdmin && (
                          <Link to={`/app/${entityKey}/admin`} onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-ink hover:bg-canvas">
                            <Settings className="h-4 w-4 text-muted" /> Administrasi
                          </Link>
                        )}
                        <button
                          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-600 hover:bg-red-50"
                          onClick={async () => { await logout(); navigate('/login') }}
                        >
                          <LogOut className="h-4 w-4" /> Keluar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </header>

          <main className="px-4 pt-5 pb-24 sm:px-6 sm:pt-6 lg:pb-10">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <div className="fixed inset-x-0 bottom-0 z-[600] border-t border-line glass pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="flex items-stretch">
          {nav.filter((item) => ['Home', 'Proyek', 'Kalender', 'Pengingat'].includes(item.label)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium',
                isActive || (item.label === 'Proyek' && location.pathname.includes('/projects/')) ? 'text-forest' : 'text-muted',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-muted">
            <MoreHorizontal className="h-5 w-5" />
            Lainnya
          </button>
        </div>
      </div>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu lainnya" placement="bottom">
        <div className="space-y-2">
          <Link to={`/app/${entityKey}/calendar`} onClick={() => setMoreOpen(false)} className="nav-item border border-line">
            <CalendarDays className="h-4 w-4" /> Kalender & agenda
          </Link>
          <Link to={`/app/${entityKey}/reminders`} onClick={() => setMoreOpen(false)} className="nav-item border border-line">
            <AlarmClock className="h-4 w-4" /> Pengingat & tenggat
          </Link>
          {isAdmin && (
            <Link to={`/app/${entityKey}/admin`} onClick={() => setMoreOpen(false)} className="nav-item border border-line">
              <ShieldCheck className="h-4 w-4" /> Administrasi & pengguna
            </Link>
          )}
          <Link to={`/app/${entityKey}/profile`} onClick={() => setMoreOpen(false)} className="nav-item border border-line">
            <UserIcon className="h-4 w-4" /> Profil saya
          </Link>
          {me.user.role === 'MA' && (
            <div className="rounded-xl border border-line p-3">
              <p className="label">Ganti entitas</p>
              <div className="flex gap-2">
                {boot?.entities.map((e) => (
                  <button
                    key={e.key}
                    onClick={() => { setMoreOpen(false); navigate(`/app/${e.key}/home`) }}
                    className={cn('chip', entityKey === e.key && 'chip-active')}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            className="flex w-full items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700"
            onClick={async () => { await logout(); navigate('/login') }}
          >
            <LogOut className="h-4 w-4" /> Keluar dari akun
          </button>
        </div>
      </Modal>
    </div>
  )
}

function NotificationPanel({ onClose, entityKey }: { onClose: () => void; entityKey: string }) {
  const { notifications, unreadCount, refreshNotifications } = useApp()
  const [busy, setBusy] = useState(false)

  async function markAll() {
    setBusy(true)
    try {
      await api.post('/api/notifications/read-all')
      await refreshNotifications()
    } finally {
      setBusy(false)
    }
  }

  async function openNotification(id: string, link: string | null) {
    await api.post(`/api/notifications/${id}/read`).catch(() => null)
    await refreshNotifications()
    onClose()
    if (link) window.location.href = link.includes('/app/') ? link.replace('/app/', `/app/${entityKey}/`).replace(/\/app\/[a-z]+\/app\//, '/app/') : link
  }

  return (
    <div className="absolute right-0 z-20 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_48px_-24px_rgba(31,41,51,0.4)]">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">Notifikasi</p>
          <p className="text-[11px] text-muted">{unreadCount} belum dibaca</p>
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button className="btn-ghost btn-sm" onClick={markAll} disabled={busy}>
              <CheckCheck className="h-3.5 w-3.5" /> Tandai
            </button>
          )}
          <button className="rounded-full p-1.5 text-muted hover:bg-sand" onClick={onClose}><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="max-h-[380px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-10">
            <EmptyState icon={Bell} title="Belum ada notifikasi" description="Aktivitas proyek, tugas, dan agenda akan muncul di sini." />
          </div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => openNotification(n.id, n.link)}
              className={cn('flex w-full gap-3 border-b border-line/70 px-4 py-3 text-left transition-colors last:border-0 hover:bg-canvas', !n.read_at && 'bg-forest-50/40')}
            >
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-line' : 'bg-forest')} />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{n.title}</span>
                {n.body && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{n.body}</span>}
                <span className="mt-1 block text-[10px] text-muted">{relativeTime(n.created_at)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
