import { Link, useParams } from 'react-router-dom'
import {
  ArrowUpRight, CalendarDays, CheckSquare, ClipboardList, Coins, FolderOpen, MapPin, Users,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/app-context'
import { formatDate, compactRupiah, formatTime, number, relativeTime, rupiah, todayIso } from '../lib/format'
import { AreaChart, BarChart, DonutChart } from '../components/charts'
import { Avatar, LoadingBlock, PageHeader, ProgressBar, Stat, cn } from '../components/ui'
import type { ProjectSummary } from '../lib/types'

type HomeData = {
  entity: { name: string; key: string }
  today: string
  stats: {
    activeProjects: number; archivedProjects: number; teamMembers: number; locations: number
    logbooks: number; logbooksThisMonth: number; tasksDone: number; tasksOpen: number
    confirmedBudget: number; provisionalBudget: number; unread: number
  }
  agenda: any[]
  projects: { id: string; title: string; code: string; category: string; progress: number; status: string; cover_url: string | null; pic_name: string | null }[]
  charts: {
    progress: { label: string; value: number; title: string }[]
    status: { label: string; value: number }[]
    logbookTrend: { label: string; count: number }[]
    tasks: { label: string; value: number }[]
    budgetByCategory: { label: string; value: number }[]
  }
  recentActivity: { id: string; actor_name: string; summary: string; created_at: string; action: string }[]
}

export function HomePage() {
  const { entity } = useParams<{ entity: string }>()
  const { data, loading } = useAsync<HomeData>(() => api.get(`/api/home?entity=${entity}`), [entity])

  if (loading || !data) return <LoadingBlock label="Menyiapkan ringkasan proyek…" />

  const { stats, charts, agenda } = data
  const greeting = greetingForNow()

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${data.entity.name} · ${formatDate(todayIso(), 'long')}`}
        title={`${greeting} — ini ringkasan hari ini.`}
        description="Pantau proyek, agenda, dan tim dalam satu tampilan. Semua angka diambil dari catatan proyek yang tersimpan."
        actions={
          <>
            <Link to={`/app/${entity}/projects`} className="btn-secondary">Katalog proyek</Link>
            <Link to={`/app/${entity}/calendar`} className="btn-primary">
              <CalendarDays className="h-4 w-4" /> Kalender
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Proyek aktif" value={number(stats.activeProjects)} hint={`${stats.archivedProjects} diarsipkan`} icon={FolderOpen} tone="forest" />
        <Stat label="Anggota tim" value={number(stats.teamMembers)} hint="Terlibat di proyek" icon={Users} />
        <Stat label="Lokasi terpetakan" value={number(stats.locations)} hint="Titik, garis, area" icon={MapPin} />
        <Stat label="Logbook" value={number(stats.logbooks)} hint={`${stats.logbooksThisMonth} bulan ini`} icon={ClipboardList} />
        <Stat label="Tugas selesai" value={`${number(stats.tasksDone)}`} hint={`${stats.tasksOpen} masih berjalan`} icon={CheckSquare} />
        <Stat
          label="Anggaran pasti"
          value={compactRupiah(stats.confirmedBudget)}
          hint={stats.provisionalBudget > 0 ? `+${compactRupiah(stats.provisionalBudget)} belum pasti` : 'Hanya yang terkonfirmasi'}
          icon={Coins}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <section className="card p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Agenda Terdekat</h2>
              <p className="muted mt-0.5">Tujuh aktivitas berikutnya di entitas ini.</p>
            </div>
            <Link to={`/app/${entity}/calendar`} className="btn-ghost btn-sm shrink-0">Lihat semua <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          {agenda.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              Belum ada agenda dalam tujuh hari ke depan.
            </div>
          ) : (
            <div className="space-y-1">
              {agenda.map((event) => (
                <Link
                  key={event.id}
                  to={`/app/${entity}/calendar`}
                  className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-canvas"
                >
                  <span className="grid w-12 shrink-0 place-items-center rounded-xl border border-line bg-canvas/70 py-1.5">
                    <span className="text-[10px] font-medium tracking-wide text-muted uppercase">{formatDate(event.date, 'short').split(' ')[1]}</span>
                    <span className="text-base leading-none font-semibold text-ink">{Number(event.date.slice(8, 10))}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{event.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                      <span className="font-medium text-forest">{event.all_day ? 'Sepanjang hari' : event.time_label}</span>
                      {event.project_title && <span>· {event.project_title}</span>}
                      {(event.location || event.location_text) && <span>· {event.location ?? event.location_text}</span>}
                    </span>
                  </span>
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: event.category_color ?? '#245A46' }} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="section-title">Status tugas</h2>
          <p className="muted mt-0.5">Distribusi seluruh tugas pada proyek yang dapat Anda akses.</p>
          <div className="mt-4">
            <DonutChart
              data={charts.tasks}
              centerLabel="tugas"
              centerValue={number(stats.tasksDone + stats.tasksOpen)}
            />
          </div>
          <div className="mt-4 rounded-xl bg-canvas/70 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Penyelesaian</span>
              <span className="font-semibold text-ink">
                {stats.tasksDone + stats.tasksOpen === 0
                  ? '—'
                  : `${Math.round((stats.tasksDone / (stats.tasksDone + stats.tasksOpen)) * 100)}%`}
              </span>
            </div>
            <ProgressBar
              className="mt-2"
              value={stats.tasksDone + stats.tasksOpen === 0 ? 0 : (stats.tasksDone / (stats.tasksDone + stats.tasksOpen)) * 100}
            />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="section-title">Progres proyek</h2>
          <p className="muted mt-0.5">Persentase tugas selesai per proyek.</p>
          <div className="mt-4">
            <BarChart data={charts.progress} horizontal format={(v) => `${v}%`} />
          </div>
        </section>
        <section className="card p-5">
          <h2 className="section-title">Logbook lapangan</h2>
          <p className="muted mt-0.5">Enam bulan terakhir, berdasarkan tanggal kunjungan.</p>
          <div className="mt-3">
            <AreaChart data={charts.logbookTrend} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Proyek berjalan</h2>
            <Link to={`/app/${entity}/projects`} className="btn-ghost btn-sm">Semua proyek</Link>
          </div>
          <div className="divide-y divide-line">
            {data.projects.map((project) => (
              <Link key={project.id} to={`/app/${entity}/projects/${project.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-90">
                {project.cover_url ? (
                  <img src={project.cover_url} alt="" className="h-11 w-16 shrink-0 rounded-lg border border-line object-cover" />
                ) : (
                  <span className="h-11 w-16 shrink-0 rounded-lg bg-canvas" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{project.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{project.code} · {project.category}{project.pic_name ? ` · PIC ${project.pic_name}` : ''}</span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <ProgressBar value={project.progress} className="flex-1" />
                    <span className="w-8 text-right text-[10px] font-medium text-muted">{project.progress}%</span>
                  </span>
                </span>
              </Link>
            ))}
            {data.projects.length === 0 && <p className="py-8 text-center text-sm text-muted">Belum ada proyek yang dapat diakses.</p>}
          </div>
        </section>

        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="section-title">Anggaran per kategori</h2>
            <p className="muted mt-0.5">Hanya nominal yang sudah pasti.</p>
            <div className="mt-3">
              {charts.budgetByCategory.length ? (
                <BarChart data={charts.budgetByCategory} horizontal format={compactRupiah} height={150} />
              ) : (
                <p className="py-6 text-center text-xs text-muted">Belum ada anggaran terkonfirmasi.</p>
              )}
            </div>
            <div className="mt-3 rounded-xl border border-line bg-white px-3 py-2.5">
              <p className="text-[10px] tracking-wide text-muted uppercase">Total resmi</p>
              <p className="text-lg font-semibold text-ink">{rupiah(stats.confirmedBudget)}</p>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="section-title">Aktivitas terbaru</h2>
            <div className="mt-3 space-y-3">
              {data.recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2.5">
                  <Avatar name={entry.actor_name} size={26} />
                  <div className="min-w-0">
                    <p className="text-xs leading-relaxed text-ink">{entry.summary}</p>
                    <p className="text-[10px] text-muted">{entry.actor_name} · {relativeTime(entry.created_at)}</p>
                  </div>
                </div>
              ))}
              {data.recentActivity.length === 0 && <p className="py-4 text-center text-xs text-muted">Belum ada aktivitas.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function greetingForNow(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }).format(new Date()))
  if (hour < 11) return 'Selamat pagi'
  if (hour < 15) return 'Selamat siang'
  if (hour < 18) return 'Selamat sore'
  return 'Selamat malam'
}
