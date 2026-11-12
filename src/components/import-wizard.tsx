import { useMemo, useRef, useState, type ReactNode } from 'react'
import * as XLSX from 'xlsx'
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import { Field, Modal, Spinner, cn } from './ui'
import { useApp } from '../lib/app-context'

export type ImportField = { key: string; label: string; required?: boolean; hint?: string }

type ParsedSheet = { name: string; headers: string[]; rows: Record<string, string>[] }

export type ImportPayload = {
  rows: Record<string, string>[]
  mode: 'append' | 'update' | 'skip'
  dedupeField: string
  filename: string
  worksheet: string
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function ImportWizard({
  open, onClose, title, description, fields, onConfirm, modeEnabled = true,
  dedupeHint, confirmLabel = 'Impor sekarang', note,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  fields: ImportField[]
  onConfirm: (payload: ImportPayload) => Promise<string | void>
  modeEnabled?: boolean
  dedupeHint?: string
  confirmLabel?: string
  note?: ReactNode
}) {
  const { toast } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState(1)
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'append' | 'update' | 'skip'>('append')
  const [dedupeField, setDedupeField] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sheet = sheets[sheetIndex]

  function reset() {
    setStep(1)
    setSheets([])
    setSheetIndex(0)
    setMapping({})
    setMode('append')
    setDedupeField('')
    setFileName('')
    setError(null)
  }

  async function handleFile(file: File | null) {
    if (!file) return
    setError(null)
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const parsed: ParsedSheet[] = workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name]
        const matrix = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, raw: false, defval: '' })
        const headerRow = (matrix[0] ?? []).map((cell, index) => String(cell ?? '').trim() || `Kolom ${index + 1}`)
        const rows = matrix.slice(1)
          .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
          .map((row) => {
            const obj: Record<string, string> = {}
            headerRow.forEach((header, index) => { obj[header] = String(row[index] ?? '').trim() })
            return obj
          })
        return { name, headers: headerRow, rows }
      }).filter((s) => s.headers.length > 0)
      if (!parsed.length) {
        setError('Berkas tidak memiliki data yang dapat dibaca.')
        return
      }
      setSheets(parsed)
      setFileName(file.name)
      const firstHeaders = parsed[0].headers
      const autoMap: Record<string, string> = {}
      for (const field of fields) {
        const match = firstHeaders.find((h) => normalize(h) === normalize(field.label) || normalize(h) === normalize(field.key))
        if (match) autoMap[field.key] = match
      }
      setMapping(autoMap)
      setSheetIndex(0)
      setStep(2)
    } catch (err: any) {
      setError('Gagal membaca berkas. Pastikan format CSV, XLS, atau XLSX yang valid.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function changeSheet(index: number) {
    setSheetIndex(index)
    const headers = sheets[index]?.headers ?? []
    const autoMap: Record<string, string> = {}
    for (const field of fields) {
      const match = headers.find((h) => normalize(h) === normalize(field.label) || normalize(h) === normalize(field.key))
      if (match) autoMap[field.key] = match
    }
    setMapping(autoMap)
  }

  const mappedRows = useMemo(() => {
    if (!sheet) return []
    return sheet.rows.map((row) => {
      const obj: Record<string, string> = {}
      for (const field of fields) {
        const source = mapping[field.key]
        obj[field.key] = source ? (row[source] ?? '') : ''
      }
      return obj
    })
  }, [sheet, mapping, fields])

  const rowErrors = useMemo(() => {
    return mappedRows.map((row) => {
      const problems: string[] = []
      for (const field of fields) {
        if (field.required && !String(row[field.key] ?? '').trim()) problems.push(`${field.label} kosong`)
      }
      if (row.email && row.email.length && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) problems.push('Email tidak valid')
      if ((row.lat && Number.isNaN(Number(row.lat))) || (row.lng && Number.isNaN(Number(row.lng)))) problems.push('Koordinat bukan angka')
      if (row.lat && (Number(row.lat) < -90 || Number(row.lat) > 90)) problems.push('Latitude di luar rentang')
      if (row.lng && (Number(row.lng) < -180 || Number(row.lng) > 180)) problems.push('Longitude di luar rentang')
      return problems
    })
  }, [mappedRows, fields])

  const invalidCount = rowErrors.filter((problems) => problems.length > 0).length
  const dedupeCandidates = fields.filter((f) => ['email', 'name', 'nis', 'kode', 'sekolah', 'item', 'id'].includes(f.key))

  const mappedCount = fields.filter((f) => mapping[f.key]).length

  async function confirm() {
    if (!sheet) return
    const validRows = mappedRows.filter((_, index) => rowErrors[index].length === 0)
    if (!validRows.length) {
      setError('Tidak ada baris valid untuk diimpor.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const message = await onConfirm({
        rows: validRows,
        mode,
        dedupeField: dedupeField || (dedupeCandidates[0]?.key ?? ''),
        filename: fileName,
        worksheet: sheet.name,
      })
      toast(message ?? 'Impor berhasil.')
      reset()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? 'Impor gagal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) { reset(); onClose() } }}
      size="xl"
      title={title}
      description={description}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={cn('grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold', step >= n ? 'bg-forest text-white' : 'bg-canvas text-muted')}>{n}</span>
            ))}
            <span className="ml-1.5">Langkah {step} dari 4</span>
          </div>
          <div className="flex gap-2">
            {step > 1 && (
              <button className="btn-secondary" onClick={() => setStep(step - 1)} disabled={busy}>
                <ArrowLeft className="h-4 w-4" /> Kembali
              </button>
            )}
            {step === 1 && <button className="btn-secondary" onClick={onClose}>Batal</button>}
            {step === 2 && (
              <button className="btn-primary" onClick={() => setStep(3)} disabled={mappedCount === 0 || !mapping[fields[0]?.key]}>
                Lanjut <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === 3 && (
              <button className="btn-primary" onClick={() => setStep(4)} disabled={!sheet}>
                Lanjut <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === 4 && (
              <button className="btn-primary" onClick={confirm} disabled={busy || invalidCount === mappedRows.length}>
                {busy ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} {confirmLabel}
              </button>
            )}
          </div>
        </div>
      }
    >
      {step === 1 && (
        <div>
          <button
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-canvas/50 px-6 py-14 transition-colors hover:border-forest/40 hover:bg-forest-50/40"
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-forest shadow-sm">
              <Upload className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium text-ink">Pilih atau tarik berkas CSV / XLS / XLSX</span>
            <span className="text-xs text-muted">Data diproses di perangkat Anda sebelum disimpan.</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          {note && <div className="mt-4">{note}</div>}
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
        </div>
      )}

      {step === 2 && sheet && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas/60 px-3 py-2.5">
            <span className="flex items-center gap-2 text-xs text-ink">
              <FileSpreadsheet className="h-4 w-4 text-forest" /> {fileName} · {sheet.rows.length} baris
            </span>
            {sheets.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-muted">
                Worksheet
                <select className="rounded-lg border border-line bg-white px-2 py-1 text-xs" value={sheetIndex} onChange={(e) => changeSheet(Number(e.target.value))}>
                  {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length})</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <Field key={field.key} label={field.label} required={field.required} hint={field.hint}>
                <select
                  className="input"
                  value={mapping[field.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                >
                  <option value="">— tidak dipetakan —</option>
                  {sheet.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </Field>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-canvas/70">
                <tr>
                  {fields.map((f) => <th key={f.key} className="px-3 py-2 text-left font-semibold text-muted">{f.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {mappedRows.slice(0, 4).map((row, index) => (
                  <tr key={index} className="border-t border-line">
                    {fields.map((f) => <td key={f.key} className="max-w-[200px] truncate px-3 py-1.5 text-ink">{row[f.key] || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">{mappedCount} dari {fields.length} kolom target terpetakan.</p>
        </div>
      )}

      {step === 3 && sheet && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="chip">{mappedRows.length} baris</span>
            <span className="chip chip-active">{mappedRows.length - invalidCount} valid</span>
            {invalidCount > 0 && <span className="chip border-red-200 bg-red-50 text-red-700">{invalidCount} bermasalah</span>}
          </div>
          <div className="max-h-[320px] overflow-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-canvas/90 backdrop-blur">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold text-muted">#</th>
                  {fields.map((f) => <th key={f.key} className="px-3 py-2 text-left font-semibold text-muted">{f.label}</th>)}
                  <th className="px-3 py-2 text-left font-semibold text-muted">Validasi</th>
                </tr>
              </thead>
              <tbody>
                {mappedRows.map((row, index) => {
                  const problems = rowErrors[index]
                  return (
                    <tr key={index} className={cn('border-t border-line', problems.length > 0 && 'bg-red-50/50')}>
                      <td className="px-2 py-1.5 text-muted">{index + 2}</td>
                      {fields.map((f) => <td key={f.key} className="max-w-[180px] truncate px-3 py-1.5 text-ink">{row[f.key] || '—'}</td>)}
                      <td className="px-3 py-1.5">
                        {problems.length === 0 ? (
                          <span className="text-emerald-700">Siap</span>
                        ) : (
                          <span className="text-red-700">{problems.join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">Baris bermasalah tidak akan diimpor. Perbaiki berkas lalu unggah ulang bila perlu.</p>
        </div>
      )}

      {step === 4 && sheet && (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-canvas/50 p-4 text-sm">
            <p className="font-medium text-ink">Ringkasan impor</p>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              <li>Berkas: {fileName} — worksheet {sheet.name}</li>
              <li>Baris valid: {mappedRows.length - invalidCount} dari {mappedRows.length}</li>
              <li>Duplikat terdeteksi berdasarkan: {dedupeField || dedupeCandidates[0]?.key || '—'}</li>
            </ul>
          </div>
          {modeEnabled && (
            <>
              <Field label="Mode impor" hint={dedupeHint}>
                <select className="input" value={mode} onChange={(e) => setMode(e.target.value as any)}>
                  <option value="append">Tambah semua baris (Append)</option>
                  <option value="update">Perbarui baris duplikat (Update)</option>
                  <option value="skip">Lewati baris duplikat (Skip)</option>
                </select>
              </Field>
              <Field label="Kolom kunci duplikat">
                <select className="input" value={dedupeField} onChange={(e) => setDedupeField(e.target.value)}>
                  <option value="">— tanpa deteksi duplikat —</option>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </Field>
            </>
          )}
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
