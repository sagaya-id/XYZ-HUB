import { useRef, useState } from 'react'
import { ImagePlus, Layers, MapPin, Plus, Search, Trash2, Upload } from 'lucide-react'
import { api, uploadFile } from '../../lib/api'
import { useApp, useAsync } from '../../lib/app-context'
import type { GeoLocation, ProjectDetail } from '../../lib/types'
import { ProjectMap } from '../../components/map'
import { GeoImportModal } from '../../components/geo-import'
import {
  ConfirmDialog, EmptyState, Field, ImageUpload, LoadingBlock, Modal, SearchInput, Spinner,
  VisibilityBadge, cn,
} from '../../components/ui'
import { formatDate } from '../../lib/format'

export function MapTab({ project }: { project: ProjectDetail['project']; entityKey: string }) {
  const { toast, boot } = useApp()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<'all' | 'point' | 'line' | 'polygon'>('all')
  const [selected, setSelected] = useState<GeoLocation | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const { data, loading, reload } = useAsync<{ locations: GeoLocation[] }>(
    () => api.get(`/api/locations?project=${project.id}`),
    [project.id],
  )

  const locations = (data?.locations ?? []).filter((loc) => {
    if (type !== 'all' && loc.type !== type) return false
    if (search) {
      const haystack = `${loc.name} ${loc.description ?? ''}`.toLowerCase()
      if (!haystack.includes(search.toLowerCase())) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title">Peta proyek</h2>
            <p className="muted mt-0.5">Hanya lokasi milik proyek ini yang ditampilkan.</p>
          </div>
          {project.can_contribute && (
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Lokasi manual
              </button>
              <button className="btn-primary btn-sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" /> Impor KML/GeoJSON
              </button>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari lokasi…" className="w-full sm:w-64" />
          {(['all', 'point', 'line', 'polygon'] as const).map((value) => (
            <button key={value} className={cn('chip', type === value && 'chip-active')} onClick={() => setType(value)}>
              {value === 'all' ? 'Semua tipe' : value === 'point' ? 'Titik' : value === 'line' ? 'Garis' : 'Area'}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-muted">{locations.length} lokasi</span>
        </div>
      </div>

      {loading ? (
        <LoadingBlock label="Memuat peta…" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <ProjectMap
            locations={locations}
            height={480}
            tileUrl={boot?.global?.mapTileUrl}
            attribution={boot?.global?.mapAttribution}
            activeId={selected?.id ?? null}
            onSelect={(loc) => setSelected(loc)}
          />
          <div className="space-y-2 xl:max-h-[480px] xl:overflow-y-auto">
            {locations.map((loc) => (
              <button
                key={loc.id}
                onClick={() => setSelected(loc)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border border-line bg-white p-3 text-left transition-colors hover:border-forest/30',
                  selected?.id === loc.id && 'border-forest/40 bg-forest-50/40',
                )}
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-forest-50 text-forest">
                  {loc.type === 'point' ? <MapPin className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{loc.name}</span>
                  <span className="block truncate text-[11px] text-muted">{loc.description ?? `${loc.type} · ${loc.project_code ?? ''}`}</span>
                  <span className="mt-1 flex items-center gap-1.5">
                    <VisibilityBadge visibility={loc.visibility} />
                    {(loc.logbook_count ?? 0) > 0 && <span className="chip !py-0.5 !text-[9px]">{loc.logbook_count} logbook</span>}
                  </span>
                </span>
              </button>
            ))}
            {locations.length === 0 && (
              <EmptyState icon={Search} title="Belum ada lokasi" description="Impor KML/GeoJSON atau tambahkan lokasi manual untuk proyek ini." />
            )}
          </div>
        </div>
      )}

      {selected && <LocationDetail location={selected} onClose={() => setSelected(null)} onChanged={reload} />}

      <GeoImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projects={[{ id: project.id, title: project.title, code: project.code }]}
        defaultProjectId={project.id}
        onImported={() => reload()}
      />

      {addOpen && (
        <ManualLocationModal
          projectId={project.id}
          canManage={project.can_manage}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); reload(); toast('Lokasi ditambahkan.') }}
        />
      )}
    </div>
  )
}

function ManualLocationModal({
  projectId, canManage, onClose, onSaved,
}: { projectId: string; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const [form, setForm] = useState({ name: '', description: '', lat: '', lng: '', visibility: 'entity', geojson: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      let geometry: any
      if (form.geojson.trim()) {
        const parsed = JSON.parse(form.geojson)
        geometry = parsed.type === 'Feature' ? parsed.geometry : parsed
      } else {
        const lat = Number(form.lat)
        const lng = Number(form.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Koordinat tidak valid.')
        geometry = { type: 'Point', coordinates: [lng, lat] }
      }
      await api.post('/api/locations', {
        projectId,
        name: form.name,
        description: form.description,
        visibility: form.visibility,
        geometry,
        type: geometry.type === 'Point' ? 'point' : geometry.type === 'LineString' ? 'line' : 'polygon',
      })
      onSaved()
    } catch (err: any) {
      setError(err?.message ?? 'Gagal menyimpan lokasi.')
      toast(err?.message ?? 'Gagal menyimpan lokasi', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Lokasi manual"
      description="Masukkan koordinat titik, atau tempel geometri GeoJSON untuk garis/area."
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.name.trim()}>
            {busy && <Spinner />} Simpan lokasi
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Nama lokasi" required>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Contoh: SDN 01 Cibinong" />
        </Field>
        <Field label="Deskripsi">
          <textarea className="input min-h-[70px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="field-grid">
          <Field label="Latitude" hint="-6.5950">
            <input className="input" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Longitude" hint="106.8166">
            <input className="input" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} inputMode="decimal" />
          </Field>
        </div>
        <Field label="Geometri GeoJSON (opsional)" hint='Contoh: {"type":"LineString","coordinates":[[106.8,-6.5],[106.9,-6.6]]}'>
          <textarea className="input min-h-[70px] font-mono text-[11px]" value={form.geojson} onChange={(e) => setForm({ ...form, geojson: e.target.value })} />
        </Field>
        <Field label="Visibilitas">
          <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
            <option value="entity">Seluruh entitas</option>
            <option value="team">Khusus tim proyek</option>
          </select>
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
        <p className="text-[11px] text-muted">{canManage ? 'Anda dapat mengelola lokasi proyek ini.' : 'Lokasi akan tampil untuk tim proyek.'}</p>
      </div>
    </Modal>
  )
}

export function LocationDetail({
  location, onClose, onChanged,
}: { location: GeoLocation; onClose: () => void; onChanged: () => void }) {
  const { toast } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data, reload } = useAsync<{ location: GeoLocation; logbooks: any[] }>(
    () => api.get(`/api/locations/${location.id}`),
    [location.id],
  )
  const detail = data?.location ?? location

  async function uploadPhoto(file: File | null) {
    if (!file) return
    setBusy(true)
    try {
      const uploaded = await uploadFile(file, { projectId: location.project_id ?? undefined })
      await api.post(`/api/locations/${location.id}/photos`, { fileId: uploaded.id })
      toast('Foto ditambahkan.')
      reload()
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengunggah foto', 'error')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={detail.name}
        description={`${detail.project_title ?? ''} · ${detail.type === 'point' ? 'Titik' : detail.type === 'line' ? 'Garis' : 'Area'}`}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <VisibilityBadge visibility={detail.visibility} />
              {detail.lat && detail.lon && (
                <span className="text-[11px] text-muted">{Number(detail.lat).toFixed(5)}, {Number(detail.lon).toFixed(5)}</span>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? <Spinner /> : <ImagePlus className="h-3.5 w-3.5" />} Tambah foto
              </button>
              <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Hapus
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture={'environment' as any} className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0] ?? null)} />
          </div>
        }
      >
        <div className="space-y-4">
          {detail.description && <p className="text-sm leading-relaxed text-muted">{detail.description}</p>}
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Galeri lokasi</p>
            {(detail.photos ?? []).length === 0 ? (
              <p className="text-xs text-muted">Belum ada foto.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {(detail.photos ?? []).map((photo) => (
                  <img key={photo.id} src={photo.url} alt="" className="aspect-square w-full rounded-xl border border-line object-cover" />
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Riwayat monitoring</p>
            {data?.logbooks?.length ? (
              <div className="space-y-2">
                {data.logbooks.map((logbook) => (
                  <div key={logbook.id} className="rounded-xl border border-line px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-ink">{logbook.activity_type ?? 'Kunjungan'}</p>
                      <span className="text-[10px] text-muted">{formatDate(logbook.visit_date)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">{logbook.observations}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">Belum ada logbook pada lokasi ini.</p>
            )}
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Hapus lokasi?"
        description="Lokasi akan dihapus dari peta. Logbook tetap tersimpan tanpa keterkaitan lokasi."
        danger
        confirmLabel="Hapus lokasi"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.del(`/api/locations/${location.id}`).catch((e) => toast(e.message, 'error'))
          toast('Lokasi dihapus.')
          setConfirmDelete(false)
          onChanged()
          onClose()
        }}
      />
    </>
  )
}
