import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Layers, MapPinned, Search, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useAsync } from '../lib/app-context'
import type { GeoLocation, ProjectSummary } from '../lib/types'
import { ProjectMap } from '../components/map'
import { GeoImportModal } from '../components/geo-import'
import { EmptyState, LoadingBlock, PageHeader, SearchInput, VisibilityBadge, cn } from '../components/ui'
import { LocationDetail } from './tabs/MapTab'

export function LocationsPage() {
  const { entity } = useParams<{ entity: string }>()
  const { boot } = useApp()
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [type, setType] = useState<'all' | 'point' | 'line' | 'polygon'>('all')
  const [selected, setSelected] = useState<GeoLocation | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const { data: projectsData } = useAsync<{ projects: ProjectSummary[] }>(
    () => api.get(`/api/projects?entity=${entity}`),
    [entity],
  )
  const { data, loading, reload } = useAsync<{ locations: GeoLocation[] }>(
    () => api.get(`/api/locations?entity=${entity}`),
    [entity],
  )

  const all = data?.locations ?? []
  const filtered = useMemo(() => {
    return all.filter((loc) => {
      if (projectFilter && loc.project_id !== projectFilter) return false
      if (type !== 'all' && loc.type !== type) return false
      if (search) {
        const haystack = `${loc.name} ${loc.description ?? ''} ${loc.project_title ?? ''}`.toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [all, projectFilter, type, search])

  const projects = projectsData?.projects ?? []

  return (
    <div>
      <PageHeader
        eyebrow="Peta entitas"
        title="Lokasi"
        description="Semua lokasi geografis yang boleh Anda lihat pada entitas ini. Lokasi berlabel khusus tim hanya muncul untuk anggota proyeknya."
        actions={
          <button className="btn-primary" onClick={() => setImportOpen(true)} disabled={projects.length === 0}>
            <Upload className="h-4 w-4" /> Impor lokasi
          </button>
        }
      />

      <div className="mb-4 card p-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nama lokasi atau proyek…" className="w-full sm:max-w-xs" />
          <select className="input sm:w-64" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">Semua proyek</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.code} — {project.title}</option>)}
          </select>
          <div className="flex gap-1.5">
            {(['all', 'point', 'line', 'polygon'] as const).map((value) => (
              <button key={value} className={cn('chip', type === value && 'chip-active')} onClick={() => setType(value)}>
                {value === 'all' ? 'Semua' : value === 'point' ? 'Titik' : value === 'line' ? 'Garis' : 'Area'}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[11px] text-muted">{filtered.length} lokasi</span>
        </div>
      </div>

      {loading ? (
        <LoadingBlock label="Memuat peta entitas…" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
          <div className="space-y-3">
            <ProjectMap
              locations={filtered}
              height={540}
              tileUrl={boot?.global?.mapTileUrl}
              attribution={boot?.global?.mapAttribution}
              activeId={selected?.id ?? null}
              onSelect={(loc) => setSelected(loc)}
            />
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 text-[10px] text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-forest" /> Titik lokasi</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-forest" /> Jalur</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-forest/30 ring-1 ring-forest" /> Area</span>
              <span className="ml-auto">Basemap: OpenStreetMap (dapat diubah pada pengaturan branding)</span>
            </div>
          </div>

          <div className="space-y-2 xl:max-h-[580px] xl:overflow-y-auto">
            {filtered.map((location) => (
              <button
                key={location.id}
                onClick={() => setSelected(location)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border border-line bg-white p-3 text-left transition-colors hover:border-forest/30',
                  selected?.id === location.id && 'border-forest/40 bg-forest-50/40',
                )}
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-forest-50 text-forest">
                  {location.type === 'point' ? <MapPinned className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{location.name}</span>
                  <span className="block truncate text-[11px] text-muted">{location.project_title ?? '—'} · {location.project_code ?? ''}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <VisibilityBadge visibility={location.visibility} />
                    {(location.logbook_count ?? 0) > 0 && <span className="chip !py-0.5 !text-[9px]">{location.logbook_count} logbook</span>}
                  </span>
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <EmptyState icon={Search} title="Belum ada lokasi" description="Impor KML, GeoJSON, atau data koordinat untuk mulai memetakan proyek." />
            )}
          </div>
        </div>
      )}

      {selected && <LocationDetail location={selected} onClose={() => setSelected(null)} onChanged={reload} />}

      <GeoImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projects={projects.map((p) => ({ id: p.id, title: p.title, code: p.code }))}
        onImported={() => reload()}
      />
    </div>
  )
}
