import { useMemo, useState } from 'react'
import {
  Camera, ClipboardList, Crosshair, MapPin, Plus, Trash2, User,
} from 'lucide-react'
import { api, uploadFile } from '../../lib/api'
import { useApp, useAsync } from '../../lib/app-context'
import type { GeoLocation, Logbook, Member, ProjectDetail } from '../../lib/types'
import {
  Avatar, ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, SearchInput, Spinner, VisibilityBadge, cn,
} from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'

const ACTIVITY_TYPES = ['Monitoring', 'Kunjungan lapangan', 'Pelatihan', 'Rapat koordinasi', 'Serah terima', 'Inspeksi', 'Lainnya']

export function LogbookTab({
  project, members, onChanged,
}: { project: ProjectDetail['project']; members: Member[]; onChanged: () => void }) {
  const { toast } = useApp()
  const [search, setSearch] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [formOpen, setFormOpen] = useState<{ logbook: Logbook | null } | null>(null)
  const [deleting, setDeleting] = useState<Logbook | null>(null)

  const { data, loading, reload } = useAsync<{ logbooks: Logbook[]; can_contribute: boolean }>(
    () => api.get(`/api/projects/${project.id}/logbooks`),
    [project.id],
  )
  const { data: locationsData } = useAsync<{ locations: GeoLocation[] }>(
    () => api.get(`/api/locations?project=${project.id}`),
    [project.id],
  )
  const locations = locationsData?.locations ?? []

  const logbooks = (data?.logbooks ?? []).filter((logbook) => {
    if (locationFilter && logbook.location_id !== locationFilter) return false
    if (search) {
      const haystack = `${logbook.activity_type ?? ''} ${logbook.observations} ${logbook.staff_name ?? ''} ${logbook.location_name ?? ''}`.toLowerCase()
      if (!haystack.includes(search.toLowerCase())) return false
    }
    return true
  })

  function refresh() {
    reload()
    onChanged()
  }

  if (loading) return <LoadingBlock label="Memuat logbook lapangan…" />

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title">Logbook kunjungan</h2>
            <p className="muted mt-0.5">Catatan lapangan dengan foto, indikator, dan tindak lanjut.</p>
          </div>
          {data?.can_contribute && (
            <button className="btn-primary btn-sm" onClick={() => setFormOpen({ logbook: null })}>
              <Plus className="h-3.5 w-3.5" /> Catat kunjungan
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari aktivitas, staf, lokasi…" className="w-full sm:w-72" />
          <select className="input sm:w-56" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
            <option value="">Semua lokasi</option>
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
          <span className="ml-auto text-[11px] text-muted">{logbooks.length} catatan</span>
        </div>
      </div>

      {logbooks.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Belum ada logbook"
          description="Catat kunjungan lapangan pertama Anda. Foto dan GPS opsional dapat dilampirkan."
          action={data?.can_contribute ? <button className="btn-primary" onClick={() => setFormOpen({ logbook: null })}>Catat kunjungan</button> : undefined}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {logbooks.map((logbook) => (
            <article key={logbook.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="badge bg-forest-50 text-forest">{logbook.activity_type ?? 'Kunjungan'}</span>
                    <VisibilityBadge visibility={logbook.visibility} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted">
                    {formatDate(logbook.visit_date, 'long')} {logbook.visit_time ? `· ${logbook.visit_time}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {data?.can_contribute && (
                    <button className="btn-ghost btn-sm" onClick={() => setFormOpen({ logbook })}>Ubah</button>
                  )}
                  <button className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting(logbook)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-ink">{logbook.observations}</p>

              {Object.keys(logbook.indicators ?? {}).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(logbook.indicators).map(([key, value]) => (
                    <span key={key} className="chip !py-1 !text-[10px]">{key}: <strong className="text-ink">{value}</strong></span>
                  ))}
                </div>
              )}

              {logbook.follow_up && (
                <p className="mt-2 rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900">
                  Tindak lanjut: {logbook.follow_up}
                </p>
              )}

              {logbook.photos?.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {logbook.photos.slice(0, 4).map((photo) => (
                    <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="block">
                      <img src={photo.url} alt="" className="aspect-square w-full rounded-lg border border-line object-cover" />
                    </a>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[10px] text-muted">
                <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> {logbook.staff_name ?? '—'}</span>
                {logbook.location_name && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {logbook.location_name}</span>}
                {logbook.gps_lat && logbook.gps_lng && (
                  <span className="inline-flex items-center gap-1"><Crosshair className="h-3 w-3" /> {Number(logbook.gps_lat).toFixed(4)}, {Number(logbook.gps_lng).toFixed(4)}</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <LogbookForm
          projectId={project.id}
          members={members}
          locations={locations}
          logbook={formOpen.logbook}
          onClose={() => setFormOpen(null)}
          onSaved={() => { setFormOpen(null); refresh() }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Hapus logbook?"
        description="Catatan dan foto kunjungan ini akan dihapus permanen."
        danger
        confirmLabel="Hapus logbook"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await api.del(`/api/logbooks/${deleting.id}`).catch((e) => toast(e.message, 'error'))
          toast('Logbook dihapus.')
          setDeleting(null)
          refresh()
        }}
      />
    </div>
  )
}

function LogbookForm({
  projectId, members, locations, logbook, onClose, onSaved,
}: {
  projectId: string
  members: Member[]
  locations: GeoLocation[]
  logbook: Logbook | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useApp()
  const [form, setForm] = useState({
    visitDate: logbook?.visit_date ?? todayIso(),
    visitTime: logbook?.visit_time ?? '09:00',
    staffId: logbook?.staff_id ?? '',
    activityType: logbook?.activity_type ?? 'Monitoring',
    locationId: logbook?.location_id ?? '',
    observations: logbook?.observations ?? '',
    followUp: logbook?.follow_up ?? '',
    visibility: (logbook?.visibility ?? 'team') as 'team' | 'entity',
  })
  const [indicators, setIndicators] = useState<{ key: string; value: string }[]>(
    Object.entries(logbook?.indicators ?? {}).map(([key, value]) => ({ key, value: String(value) })),
  )
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>(
    (logbook?.photos ?? []).map((photo) => ({ id: photo.file_id, url: photo.url })),
  )
  const [gps, setGps] = useState<{ lat: number | null; lng: number | null }>({
    lat: logbook?.gps_lat ?? null,
    lng: logbook?.gps_lng ?? null,
  })
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const staffOptions = useMemo(() => members, [members])

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      const uploaded: { id: string; url: string }[] = []
      for (const file of Array.from(files).slice(0, 6)) {
        const result = await uploadFile(file, { projectId })
        uploaded.push({ id: result.id, url: result.url })
      }
      setPhotos((prev) => [...prev, ...uploaded])
      toast(`${uploaded.length} foto diunggah.`)
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengunggah foto', 'error')
    } finally {
      setUploading(false)
    }
  }

  function captureGps() {
    if (!navigator.geolocation) {
      toast('Perangkat tidak mendukung GPS.', 'error')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps({ lat: position.coords.latitude, lng: position.coords.longitude })
        toast('Koordinat GPS diambil.')
      },
      () => toast('Izin lokasi ditolak atau tidak tersedia.', 'error'),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const payload = {
        ...form,
        locationId: form.locationId || null,
        staffId: form.staffId || null,
        gpsLat: gps.lat,
        gpsLng: gps.lng,
        indicators: Object.fromEntries(indicators.filter((i) => i.key.trim()).map((i) => [i.key.trim(), i.value])),
        photoIds: photos.map((p) => p.id),
      }
      if (logbook) await api.patch(`/api/logbooks/${logbook.id}`, payload)
      else await api.post(`/api/projects/${projectId}/logbooks`, payload)
      toast(logbook ? 'Logbook diperbarui.' : 'Logbook tersimpan.')
      onSaved()
    } catch (err: any) {
      setError(err?.message ?? 'Gagal menyimpan logbook.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={logbook ? 'Ubah logbook' : 'Catat kunjungan lapangan'}
      description="Catatan akan tersimpan permanen, termasuk setelah keanggotaan berubah."
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.observations.trim()}>
            {busy && <Spinner />} Simpan logbook
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="field-grid">
          <Field label="Tanggal kunjungan" required>
            <input type="date" className="input" value={form.visitDate} onChange={(e) => setForm({ ...form, visitDate: e.target.value })} />
          </Field>
          <Field label="Waktu">
            <input type="time" className="input" value={form.visitTime} onChange={(e) => setForm({ ...form, visitTime: e.target.value })} />
          </Field>
          <Field label="Aktivitas">
            <select className="input" value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value })}>
              {ACTIVITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </Field>
          <Field label="Lokasi">
            <select className="input" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
              <option value="">Tidak spesifik</option>
              {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </Field>
          <Field label="Staf / PIC">
            <select className="input" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
              <option value="">Saya sendiri</option>
              {staffOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </Field>
          <Field label="Visibilitas">
            <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as any })}>
              <option value="team">Khusus tim proyek</option>
              <option value="entity">Seluruh entitas</option>
            </select>
          </Field>
        </div>

        <Field label="Observasi" required>
          <textarea className="input min-h-[100px]" value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} placeholder="Apa yang Anda temukan di lapangan?" />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label !mb-0">Indikator kustom</span>
            <button className="btn-ghost btn-sm" onClick={() => setIndicators([...indicators, { key: '', value: '' }])}>
              <Plus className="h-3.5 w-3.5" /> Indikator
            </button>
          </div>
          <div className="space-y-1.5">
            {indicators.map((indicator, index) => (
              <div key={index} className="flex gap-1.5">
                <input
                  className="input"
                  placeholder="Nama indikator (mis. Tinggi bibit)"
                  value={indicator.key}
                  onChange={(e) => setIndicators(indicators.map((item, i) => i === index ? { ...item, key: e.target.value } : item))}
                />
                <input
                  className="input max-w-[130px]"
                  placeholder="Nilai"
                  value={indicator.value}
                  onChange={(e) => setIndicators(indicators.map((item, i) => i === index ? { ...item, value: e.target.value } : item))}
                />
                <button className="rounded-lg px-2 text-muted hover:text-red-600" onClick={() => setIndicators(indicators.filter((_, i) => i !== index))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {indicators.length === 0 && <p className="text-[11px] text-muted">Belum ada indikator khusus.</p>}
          </div>
        </div>

        <Field label="Tindak lanjut">
          <input className="input" value={form.followUp} onChange={(e) => setForm({ ...form, followUp: e.target.value })} placeholder="Rencana setelah kunjungan ini" />
        </Field>

        <div>
          <span className="label">Foto lapangan</span>
          <div className="grid grid-cols-4 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="relative">
                <img src={photo.url} alt="" className="aspect-square w-full rounded-xl border border-line object-cover" />
                <button
                  className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-red-600"
                  onClick={() => setPhotos(photos.filter((p) => p.id !== photo.id))}
                >
                  ×
                </button>
              </div>
            ))}
            <label className={cn('flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-[10px] text-muted hover:border-forest/40 hover:bg-forest-50/40', uploading && 'opacity-60')}>
              {uploading ? <Spinner /> : <Camera className="h-4 w-4" />}
              Tambah
              <input type="file" accept="image/*" multiple capture={'environment' as any} className="hidden" onChange={(e) => addPhotos(e.target.files)} />
            </label>
          </div>
          <p className="mt-1 text-[10px] text-muted">Dapat memilih dari galeri atau kamera perangkat, maks. 6 foto per unggahan.</p>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-line bg-canvas/50 px-3 py-2.5">
          <div>
            <p className="text-xs font-medium text-ink">Koordinat GPS (opsional)</p>
            <p className="text-[11px] text-muted">
              {gps.lat && gps.lng ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'Belum ada koordinat'}
            </p>
          </div>
          <button className="btn-secondary btn-sm" onClick={captureGps}><Crosshair className="h-3.5 w-3.5" /> Ambil lokasi</button>
        </div>

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
