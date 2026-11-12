import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, MapPin, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/app-context'
import { compactRupiah, formatDate, number, rupiah } from '../../lib/format'
import { AreaChart, DonutChart, ProgressRing } from '../../components/charts'
import { Avatar, LoadingBlock, VisibilityBadge, cn } from '../../components/ui'
import type { Budget, Kpi, Member, ProjectDetail } from '../../lib/types'

export function OverviewTab({
  project, members, kpis, budget, entity,
}: {
  project: ProjectDetail['project']
  members: Member[]
  kpis: Kpi[]
  budget: Budget | null
  entity: string
  reload: () => void
}) {
  const { data: board } = useAsync<{ columns: { id: string; name: string; is_done: boolean; tasks: any[] }[] }>(
    () => api.get(`/api/projects/${project.id}/board`),
    [project.id],
  )
  const { data: logbookData } = useAsync<{ logbooks: any[] }>(
    () => api.get(`/api/projects/${project.id}/logbooks`),
    [project.id],
  )

  const logbooks = logbookData?.logbooks ?? []
  const pie = (board?.columns ?? []).map((column) => ({ label: column.name, value: column.tasks.length }))
  const totalTasks = pie.reduce((sum, item) => sum + item.value, 0)

  const months: { label: string; count: number }[] = []
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  for (let i = 5; i >= 0; i--) {
    const date = new Date()
    date.setMonth(date.getMonth() - i)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    months.push({
      label: labels[date.getMonth()],
      count: logbooks.filter((l) => String(l.visit_date).startsWith(key)).length,
    })
  }

  const pic = members.find((m) => m.is_primary_pic)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Indikator Kinerja (KPI)</h2>
              <p className="muted mt-0.5">Dapat disesuaikan per jenis proyek pada tab Pengaturan.</p>
            </div>
            <Link to={`/app/${entity}/projects/${project.id}?tab=settings`} className="btn-ghost btn-sm">Atur</Link>
          </div>
          {kpis.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Belum ada indikator. Tambahkan pada Pengaturan.</p>
          ) : (
            <div className="mt-4 space-y-3.5">
              {kpis.map((kpi) => {
                const ratio = kpi.target_value > 0 ? (kpi.current_value / kpi.target_value) * 100 : 0
                return (
                  <div key={kpi.id}>
                    <div className="mb-1 flex items-end justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{kpi.label}</span>
                      <span className="text-xs text-muted">
                        <span className="font-semibold text-ink">{number(kpi.current_value)}</span> / {number(kpi.target_value)} {kpi.unit ?? ''}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                      <div
                        className={cn('h-full rounded-full', ratio >= 100 ? 'bg-emerald-600' : 'bg-forest')}
                        style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-muted">{ratio >= 100 ? 'Target tercapai' : `${Math.round(ratio)}% dari target`}</p>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="section-title">Status tugas</h2>
          <p className="muted mt-0.5">{totalTasks} tugas aktif pada papan kanban.</p>
          <div className="mt-4">
            <DonutChart data={pie} centerLabel="tugas" centerValue={totalTasks} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-5">
          <h2 className="section-title">Ritme kunjungan lapangan</h2>
          <p className="muted mt-0.5">Logbook enam bulan terakhir.</p>
          <div className="mt-3">
            <AreaChart data={months} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-canvas/70 px-3 py-2">
              <p className="text-[10px] tracking-wide text-muted uppercase">Total</p>
              <p className="text-sm font-semibold text-ink">{logbooks.length}</p>
            </div>
            <div className="rounded-xl bg-canvas/70 px-3 py-2">
              <p className="text-[10px] tracking-wide text-muted uppercase">Bulan ini</p>
              <p className="text-sm font-semibold text-ink">{months[months.length - 1]?.count ?? 0}</p>
            </div>
            <div className="rounded-xl bg-canvas/70 px-3 py-2">
              <p className="text-[10px] tracking-wide text-muted uppercase">Lokasi</p>
              <p className="text-sm font-semibold text-ink">{project.location_count ?? 0}</p>
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="section-title">Anggaran</h2>
            {budget && project.can_see_budget ? (
              <div className="mt-3">
                <div className="flex items-end justify-between">
                  <p className="text-2xl font-semibold text-ink">{rupiah(budget.amount)}</p>
                  <VisibilityBadge visibility={budget.visibility} />
                </div>
                <p className={cn('mt-1 text-[11px]', budget.is_confirmed ? 'text-emerald-700' : 'text-amber-700')}>
                  {budget.is_confirmed
                    ? 'Anggaran sudah pasti — dihitung pada total resmi.'
                    : 'Anggaran belum pasti — tersimpan tetapi tidak dihitung pada total resmi.'}
                </p>
                <Link to={`/app/${entity}/projects/${project.id}?tab=budget`} className="btn-secondary btn-sm mt-3 w-full">
                  Kelola anggaran <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Anggaran proyek ini terbatas untuk tim proyek.</p>
            )}
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="section-title">Tim proyek</h2>
              <span className="chip"><Users className="h-3 w-3" /> {members.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {members.slice(0, 5).map((member) => (
                <div key={member.id} className="flex items-center gap-2.5">
                  <Avatar name={member.name} url={member.avatar_url} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">{member.name}</p>
                    <p className="truncate text-[10px] text-muted">{member.job_title ?? member.email}</p>
                  </div>
                  {member.is_primary_pic ? (
                    <span className="badge bg-forest-50 text-forest">PIC</span>
                  ) : member.access === 'admin' ? (
                    <span className="badge bg-sky-50 text-sky-700">PA</span>
                  ) : (
                    <span className="badge bg-canvas text-muted">Tim</span>
                  )}
                </div>
              ))}
            </div>
            {pic && (
              <Link to={`/app/${entity}/projects/${project.id}?tab=settings`} className="btn-ghost btn-sm mt-3 w-full">
                Kelola keanggotaan
              </Link>
            )}
          </section>
        </div>
      </div>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Logbook terbaru</h2>
          <Link to={`/app/${entity}/projects/${project.id}?tab=logbook`} className="btn-ghost btn-sm">Semua logbook</Link>
        </div>
        {logbooks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Belum ada logbook.</p>
        ) : (
          <div className="mt-3 divide-y divide-line">
            {logbooks.slice(0, 4).map((logbook: any) => (
              <div key={logbook.id} className="flex items-start gap-3 py-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest">
                  <CalendarClock className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{logbook.activity_type ?? 'Kunjungan lapangan'}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{logbook.observations}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-muted">
                    <span>{formatDate(logbook.visit_date)}</span>
                    {logbook.location_name && <span className="inline-flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" /> {logbook.location_name}</span>}
                    <span>· {logbook.staff_name ?? '—'}</span>
                  </p>
                </div>
                {logbook.photos?.length > 0 && (
                  <img src={logbook.photos[0].url} alt="" className="h-12 w-12 rounded-lg border border-line object-cover" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
