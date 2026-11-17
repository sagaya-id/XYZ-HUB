import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckSquare, ExternalLink, Layers, MapPinned, Search, Trash2, Upload, X } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useAsync } from '../lib/app-context'
import type { GeoLocation, ProjectSummary } from '../lib/types'
import { ProjectMap, googleMapsHref } from '../components/map'
import { GeoImportModal } from '../components/geo-import'
import {
  ConfirmDialog, EmptyState, LoadingBlock, PageHeader, SearchInput, VisibilityBadge, cn,
} from '../components/ui'
import { LocationDetail } from './tabs/MapTab'

export function LocationsPage() {
  const { entity } = useParams<{ entity: string }>()
  const { boot, toast } = useApp()
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [type, setType] = useState<'all' | 'point' | 'line' | 'polygon'>('all')
  const [selected, setSelected] = useState<GeoLocation | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<GeoLocation | null>(null)
  const [busy, setBusy] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

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

  // Selection is always limited to rows that pass the current filters.
  const visibleIds = filtered.map((loc) => loc.id)
  const selectedVisible = selectedIds.filter((id) => visibleIds.includes(id))
  const allSelected = filtered.length > 0 && selectedVisible.length === filtered.length
  const someSelected = selectedVisible.length > 0 && !allSelected

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  // Drop ids that no longer exist after a reload or filter change.
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => all.some((loc) => loc.id === id)))
  }, [all])

  function toggleOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : visibleIds)
  }

  async function deleteSelected() {
    setBusy(true)
    try {
      const res = await api.post<{ deleted: number; denied: string[] }>('/api/locations/bulk-delete', {
        ids: selectedVisible,
      })
      toast(`${res.deleted} lokasi dihapus.${res.denied.length ? ` ${res.denied.length} ditolak karena hak akses.` : ''}`)
      setSelectedIds([])
      setBulkConfirm(false)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus lokasi', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function deleteOne(location: GeoLocation) {
    setBusy(true)
    try {
      await api.del(`/api/locations/${location.id}`)
      toast('Lokasi dihapus.')
      setDeleteTarget(null)
      setSelectedIds((prev) => prev.filter((id) => id !== location.id))
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus lokasi', 'error')
    } finally {
      setBusy(false)
    }
  }

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

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-ink">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={filtered.length === 0}
                  aria-label="Pilih semua lokasi"
                />
                Pilih Semua
              </label>
              <span className="text-[10px] text-muted">{filtered.length} baris</span>
            </div>

            {selectedVisible.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-forest/25 bg-forest-50 px-3 py-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-forest">
                  <CheckSquare className="h-3.5 w-3.5" /> {selectedVisible.length} item dipilih
                </span>
                <div className="flex items-center gap-1.5">
                  <button className="btn-ghost btn-sm" onClick={() => setSelectedIds([])}>
                    <X className="h-3.5 w-3.5" /> Batal
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => setBulkConfirm(true)}>
                    <Trash2 className="h-3.5 w-3.5" /> Hapus Terpilih
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 xl:max-h-[580px] xl:overflow-y-auto">
              {filtered.map((location) => {
                const mapsHref = googleMapsHref(location)
                return (
                  <div
                    key={location.id}
                    className={cn(
                      'overflow-hidden rounded-xl border border-line bg-white transition-colors hover:border-forest/30',
                      selected?.id === location.id && 'border-forest/40 bg-forest-50/40',
                      selectedVisible.includes(location.id) && 'ring-1 ring-forest/30',
                    )}
                  >
                    <div className="flex items-start gap-2 p-3">
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={selectedVisible.includes(location.id)}
                        onChange={() => toggleOne(location.id)}
                        aria-label={`Pilih lokasi ${location.name}`}
                      />
                      <button onClick={() => setSelected(location)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
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
                      <button
                        className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeleteTarget(location)}
                        aria-label={`Hapus lokasi ${location.name}`}
                        title="Hapus"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {mapsHref && (
                      <a
                        href={mapsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 border-t border-line/70 px-3 py-1.5 text-[11px] font-medium text-forest hover:bg-forest-50/40"
                      >
                        <ExternalLink className="h-3 w-3" /> Buka di Google Maps
                      </a>
                    )}
                  </div>
                )
              })}
              {filtered.length === 0 && (
                <EmptyState icon={Search} title="Belum ada lokasi" description="Impor KML, GeoJSON, atau data koordinat untuk mulai memetakan proyek." />
              )}
            </div>
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

      <ConfirmDialog
        open={bulkConfirm}
        title={`Hapus ${selectedVisible.length} lokasi terpilih?`}
        description="Lokasi dihapus dari peta entitas. Logbook tetap tersimpan tanpa keterkaitan lokasi. Lokasi di luar hak kelola Anda akan dilewati."
        danger
        confirmLabel={`Hapus ${selectedVisible.length} lokasi`}
        busy={busy}
        onCancel={() => setBulkConfirm(false)}
        onConfirm={deleteSelected}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus lokasi?"
        description={`${deleteTarget?.name ?? ''} akan dihapus dari peta. Logbook tetap tersimpan tanpa keterkaitan lokasi.`}
        danger
        confirmLabel="Hapus lokasi"
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteOne(deleteTarget)}
      />
    </div>
  )
}
