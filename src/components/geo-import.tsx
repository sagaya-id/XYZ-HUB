import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { CheckCircle2, FileUp, MapPin } from 'lucide-react'
import { api } from '../lib/api'
import { featuresFromRows, parseGeoJson, parseKml, type GeoFeature } from '../lib/geo'
import { Field, Modal, Spinner, cn } from './ui'
import { useApp } from '../lib/app-context'

export type ProjectOption = { id: string; title: string; code: string }

export function GeoImportModal({
  open, onClose, projects, defaultProjectId, onImported,
}: {
  open: boolean
  onClose: () => void
  projects: ProjectOption[]
  defaultProjectId?: string
  onImported: (count: number) => void
}) {
  const { toast } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [features, setFeatures] = useState<GeoFeature[]>([])
  const [fileName, setFileName] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '')
  const [visibility, setVisibility] = useState<'team' | 'entity'>('entity')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<number, boolean>>({})

  function reset() {
    setFeatures([])
    setFileName('')
    setSelected({})
    setError(null)
  }

  async function handleFile(file: File | null) {
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      let parsed: GeoFeature[] = []
      if (/\.kml$/i.test(file.name)) parsed = parseKml(text)
      else if (/\.(geojson|json)$/i.test(file.name)) parsed = parseGeoJson(text)
      else {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false })
        parsed = featuresFromRows(rows)
      }
      if (!parsed.length) {
        setError('Tidak ada fitur geografis yang ditemukan pada berkas ini.')
        return
      }
      setFeatures(parsed)
      setFileName(file.name)
      const initial: Record<number, boolean> = {}
      parsed.forEach((feature, index) => { if (feature.valid) initial[index] = true })
      setSelected(initial)
    } catch (err: any) {
      setError(err?.message ?? 'Berkas tidak dapat dibaca.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function submit() {
    if (!projectId) {
      setError('Pilih proyek tujuan terlebih dahulu.')
      return
    }
    const chosen = features.filter((f, index) => f.valid && selected[index])
    if (!chosen.length) {
      setError('Pilih minimal satu fitur valid.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ imported: number; skipped: string[] }>('/api/locations/import', {
        projectId,
        visibility,
        source: fileName,
        features: chosen.map((f) => ({ name: f.name, description: f.description, geometry: f.geometry })),
      })
      toast(`${res.imported} lokasi berhasil diimpor.`)
      onImported(res.imported)
      reset()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? 'Impor lokasi gagal.')
    } finally {
      setBusy(false)
    }
  }

  const validCount = features.filter((f, index) => f.valid && selected[index]).length
  const invalidCount = features.filter((f) => !f.valid).length

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) { reset(); onClose() } }}
      size="xl"
      title="Impor lokasi geografis"
      description="Unggah KML, GeoJSON, atau CSV/Excel berisi koordinat. Pratinjau dan validasi dilakukan sebelum penyimpanan."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            {features.length ? `${validCount} dipilih · ${invalidCount} tidak valid` : 'Belum ada berkas'}
          </p>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => { reset(); onClose() }} disabled={busy}>Batal</button>
            <button className="btn-primary" onClick={submit} disabled={busy || validCount === 0 || !projectId}>
              {busy ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} Impor {validCount || ''} lokasi
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <button
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-canvas/50 px-6 py-8 transition-colors hover:border-forest/40 hover:bg-forest-50/40"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-forest shadow-sm"><FileUp className="h-5 w-5" /></span>
          <span className="text-sm font-medium text-ink">{fileName || 'Pilih berkas KML / GeoJSON / CSV / XLSX'}</span>
          <span className="text-[11px] text-muted">Titik, garis, dan area didukung.</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".kml,.geojson,.json,.csv,.xls,.xlsx"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />

        {features.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Proyek tujuan" required>
                <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.title}</option>)}
                </select>
              </Field>
              <Field label="Visibilitas lokasi">
                <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
                  <option value="entity">Seluruh entitas</option>
                  <option value="team">Khusus tim proyek</option>
                </select>
              </Field>
            </div>
            <div className="max-h-64 overflow-auto rounded-xl border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-canvas/90 backdrop-blur">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-3 py-2 text-left font-semibold text-muted">Nama</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted">Tipe</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted">Validasi</th>
                  </tr>
                </thead>
                <tbody>
                  {features.map((feature, index) => (
                    <tr key={`${feature.name}-${index}`} className={cn('border-t border-line', !feature.valid && 'bg-red-50/50')}>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          disabled={!feature.valid}
                          checked={!!selected[index]}
                          onChange={(e) => setSelected({ ...selected, [index]: e.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5 text-ink"><MapPin className="h-3 w-3 text-forest" /> {feature.name}</span>
                      </td>
                      <td className="px-3 py-1.5 uppercase text-muted">{feature.type}</td>
                      <td className="px-3 py-1.5">
                        {feature.valid ? <span className="text-emerald-700">Siap</span> : <span className="text-red-700">{feature.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
