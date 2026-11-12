import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, BarChart3, CalendarRange, ClipboardList, Coins, Database, KanbanSquare, MapPinned,
  NotebookPen, Settings,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/app-context'
import type { ProjectDetail } from '../lib/types'
import { EmptyState, LoadingBlock, ProgressBar, Tabs, VisibilityBadge, cn } from '../components/ui'
import { KanbanBoard } from '../components/kanban'
import { ProjectMap } from '../components/map'
import { OverviewTab } from './tabs/Overview'
import { MapTab } from './tabs/MapTab'
import { DataTab } from './tabs/DataTab'
import { NotesTab } from './tabs/NotesTab'
import { LogbookTab } from './tabs/LogbookTab'
import { BudgetTab } from './tabs/BudgetTab'
import { SettingsTab } from './tabs/SettingsTab'
import { compactRupiah, formatDate, statusTone } from '../lib/format'
import { useApp } from '../lib/app-context'

type TabKey = 'overview' | 'kanban' | 'map' | 'data' | 'notes' | 'logbook' | 'budget' | 'settings'

const TABS: { value: TabKey; label: string; icon: any }[] = [
  { value: 'overview', label: 'Dashboard', icon: BarChart3 },
  { value: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { value: 'map', label: 'Peta', icon: MapPinned },
  { value: 'data', label: 'Tabel Data', icon: Database },
  { value: 'notes', label: 'Catatan', icon: NotebookPen },
  { value: 'logbook', label: 'Logbook', icon: ClipboardList },
  { value: 'budget', label: 'Anggaran', icon: Coins },
  { value: 'settings', label: 'Pengaturan', icon: Settings },
]

export function WorkspacePage() {
  const { entity, projectId } = useParams<{ entity: string; projectId: string }>()
  const [params, setParams] = useSearchParams()
  const { me, toast } = useApp()
  const tab = (params.get('tab') as TabKey) || 'overview'
  const { data, loading, error, reload } = useAsync<ProjectDetail>(
    () => api.get(`/api/projects/${projectId}`),
    [projectId],
  )
  const [tick, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)

  if (loading || !data) {
    if (error) return <EmptyState icon={ArrowLeft} title="Proyek tidak dapat diakses" description={error} action={<Link to={`/app/${entity}/projects`} className="btn-secondary">Kembali ke katalog</Link>} />
    return <LoadingBlock label="Memuat ruang kerja proyek…" />
  }

  const { project, members, kpis, budget, counts } = data
  const tone = statusTone(project.status)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link to={`/app/${entity}/projects`} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Katalog proyek
        </Link>
        <span className="hidden text-[11px] text-muted sm:block">Diperbarui {formatDate(project.created_at)}</span>
      </div>

      <div className="card overflow-hidden">
        <div className="relative h-36 w-full overflow-hidden bg-canvas sm:h-44">
          {project.cover_url ? (
            <img src={project.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-xs text-muted">Tanpa sampul</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-ink">{project.code}</span>
                <span className={cn('badge', tone.bg, tone.text)}>{project.status}</span>
                <VisibilityBadge visibility={project.visibility} />
              </div>
              <h1 className="mt-1.5 truncate text-xl font-semibold text-white sm:text-2xl">{project.title}</h1>
              <p className="mt-0.5 truncate text-[11px] text-white/80">
                {project.category} · {project.location_text ?? 'Tanpa lokasi'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/95 px-3 py-2 text-center">
                <p className="text-[9px] tracking-wide text-muted uppercase">Progres</p>
                <p className="text-sm font-semibold text-ink">{project.progress}%</p>
              </div>
              <div className="rounded-xl bg-white/95 px-3 py-2 text-center">
                <p className="text-[9px] tracking-wide text-muted uppercase">Anggaran</p>
                <p className="text-sm font-semibold text-ink">
                  {budget && project.can_see_budget ? compactRupiah(budget.amount) : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-[11px] text-muted sm:px-5">
          <span>{counts.tasks} tugas</span>
          <span>{counts.locations} lokasi</span>
          <span>{counts.logbooks} logbook</span>
          <span>{counts.notes} catatan</span>
          <span>{counts.records} baris data</span>
          <span className="ml-auto hidden items-center gap-1.5 sm:flex">
            Tim: {members.map((m) => m.name.split(' ')[0]).slice(0, 4).join(', ')}{members.length > 4 ? ` +${members.length - 4}` : ''}
          </span>
        </div>
      </div>

      <Tabs
        tabs={TABS.map((t) => ({ ...t, count: t.value === 'kanban' ? counts.tasks : t.value === 'logbook' ? counts.logbooks : undefined }))}
        value={tab}
        onChange={(value) => setParams(value === 'overview' ? {} : { tab: value })}
      />

      <div key={`${tab}-${tick}`}>
        {tab === 'overview' && <OverviewTab project={project} members={members} kpis={kpis} budget={budget} entity={entity!} reload={reload} />}
        {tab === 'kanban' && (
          <KanbanBoard projectId={project.id} currentUserId={me?.user.id ?? ''} canEdit={project.can_contribute} />
        )}
        {tab === 'map' && <MapTab project={project} entityKey={entity!} />}
        {tab === 'data' && <DataTab project={project} entityKey={entity!} />}
        {tab === 'notes' && <NotesTab project={project} />}
        {tab === 'logbook' && <LogbookTab project={project} members={members} onChanged={bump} />}
        {tab === 'budget' && <BudgetTab project={project} reload={reload} />}
        {tab === 'settings' && <SettingsTab detail={data} reload={reload} entityKey={entity!} />}
      </div>
    </div>
  )
}
