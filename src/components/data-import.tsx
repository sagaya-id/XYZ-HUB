import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Link2, Loader2, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/app-context'
import { workbookSheets, type SheetRows } from '../lib/sheet-rows'
import { Field, Modal, Spinner, cn } from './ui'

type SheetTab = { gid: string; name: string }
type Preview = { headers: string[]; rows: Record<string, string>[]; total: number }
type ParsedSheet = SheetRows

const SOURCE_CARDS = [
  {
    key: 'sheets' as const,
    title: 'Tautan Google Sheets',
    description: 'Tempel tautan sheet publik, pilih tab, lalu impor.',
    icon: Link2,
  },
  {
    key: 'file' as const,
    title: 'Unggah Excel / CSV',
    description: 'Berkas .xlsx/.xls dengan banyak sheet didukung.',
    icon: FileSpreadsheet,
  },
]

function toKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'kolom'
}

export function DataImportModal({
  open, onClose, projectId, projectTitle, canReplace, existingFields, onImported, onAdvanced,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  projectTitle: string
  canReplace: boolean
  existingFields: { key: string; label: string }[]
  onImported: (message: string) => void
  onAdvanced?: () => void
}) {
  const { toast } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [source, setSource] = useState<'sheets' | 'file'>('sheets')
  const [url, setUrl] = useState('')
  const [tabs, setTabs] = useState<SheetTab[]>([])
  const [tabNotice, setTabNotice] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState('')
  const [manualTab, setManualTab] = useState('')
  const [fileSheets, setFileSheets] = useState<ParsedSheet[]>([])
  const [fileName, setFileName] = useState('')
  const [fileSheetName, setFileSheetName] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [busy, setBusy] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep(1)
    setSource('sheets')
    setUrl('')
    setTabs([])
    setTabNotice(null)
    setSelectedTab('')
    setManualTab('')
    setFileSheets([])
    setFileName('')
    setFileSheetName('')
    setPreview(null)
    setMode('append')
    setError(null)
    setBusy(false)
    setLoadingPreview(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function close() {
    reset()
    onClose()
  }

  async function loadTabs() {
    setError(null)
    setTabNotice(null)
    setTabs([])
    setSelectedTab('')
    setPreview(null)
    setBusy(true)
    try {
      const res = await api.post<{
        sheets: SheetTab[]
        selectedGid: string | null
        restricted: boolean
        message: string | null
      }>(`/api/projects/${projectId}/sheets/tabs`, { url })
      setTabs(res.sheets)
      setTabNotice(res.message ?? null)
      const preferred = res.selectedGid ?? res.sheets[0]?.gid ?? ''
      setSelectedTab(preferred)
      setStep(2)
      if (preferred) await loadPreview(preferred)
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat daftar sheet.')
    } finally {
      setBusy(false)
    }
  }

  async function loadPreview(worksheet: string) {
    setLoadingPreview(true)
    setError(null)
    try {
      const res = await api.post<{ headers: string[]; sample: Record<string, string>[]; totalRemote: number }>(
        `/api/projects/${projectId}/sheets/preview`,
        { url, worksheet },
      )
      setPreview({ headers: res.headers, rows: res.sample ?? [], total: res.totalRemote })
    } catch (err: any) {
      setPreview(null)
      setError(err?.message ?? 'Gagal memuat pratinjau sheet.')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function changeTab(worksheet: string) {
    setSelectedTab(worksheet)
    if (worksheet) await loadPreview(worksheet)
  }

  function useManualTab() {
    const name = manualTab.trim()
    if (!name) return
    setSelectedTab(name)
    setTabs((prev) => (prev.some((tab) => tab.name === name) ? prev : [...prev, { gid: '', name }]))
    loadPreview(name)
  }

  async function handleFile(file: File | null) {
    if (!file) return
    setError(null)
    try {
      const parsed = workbookSheets(await file.arrayBuffer())
      if (!parsed.length) {
        setError('Berkas tidak memiliki data yang dapat dibaca.')
        return
      }
      setFileSheets(parsed)
      setFileName(file.name)
      setFileSheetName(parsed[0].name)
      const first = parsed[0]
      setPreview({ headers: first.headers, rows: first.rows.slice(0, 5), total: first.rows.length })
      setStep(2)
    } catch {
      setError('Gagal membaca berkas. Pastikan format CSV, XLS, atau XLSX yang valid.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function changeFileSheet(name: string) {
    setFileSheetName(name)
    const sheet = fileSheets.find((item) => item.name === name)
    if (!sheet) { setPreview(null); return }
    setPreview({ headers: sheet.headers, rows: sheet.rows.slice(0, 5), total: sheet.rows.length })
  }

  async function importSheet() {
    setError(null)
    setBusy(true)
    try {
      if (source === 'sheets') {
        if (!selectedTab) throw new Error('Pilih sheet yang ingin diimpor terlebih dahulu.')
        const res = await api.post<{ inserted: number; replaced: number; worksheet: string }>(
          `/api/projects/${projectId}/sheets/import`,
          { url, worksheet: selectedTab, mode },
        )
        const message = `${res.inserted} baris diimpor dari sheet "${res.worksheet}"${res.replaced ? `, ${res.replaced} baris lama diganti` : ''}.`
        toast(message)
        onImported(message)
      } else {
        const sheet = fileSheets.find((item) => item.name === fileSheetName)
        if (!sheet) throw new Error('Pilih sheet yang ingin diimpor terlebih dahulu.')
        // Map sheet headers onto existing column keys so imports never create
        // duplicate columns that already exist under a different key.
        const mapping: Record<string, string> = {}
        const fields: { key: string; label: string }[] = []
        for (const header of sheet.headers) {
          const existing = existingFields.find(
            (field) => field.label.toLowerCase() === header.toLowerCase() || field.key.toLowerCase() === header.toLowerCase(),
          )
          mapping[header] = existing?.key ?? toKey(header)
          fields.push({ key: mapping[header], label: existing?.label ?? header })
        }
        const rows = sheet.rows.map((row) => {
          const out: Record<string, string> = {}
          for (const header of sheet.headers) out[mapping[header]] = String(row[header] ?? '')
          return out
        })
        const res = await api.post<{ inserted: number; replaced: number }>(
          `/api/projects/${projectId}/data/import`,
          {
            rows, mode, filename: fileName, worksheet: sheet.name, source: 'file',
            fields, dedupeField: '',
          },
        )
        const message = `${res.inserted} baris diimpor dari sheet "${sheet.name}"${res.replaced ? `, ${res.replaced} baris lama diganti` : ''}.`
        toast(message)
        onImported(message)
      }
      close()
    } catch (err: any) {
      setError(err?.message ?? 'Impor gagal.')
    } finally {
      setBusy(false)
    }
  }

  const activeTabs: { value: string; label: string }[] = source === 'sheets'
    ? tabs.map((tab) => ({ value: tab.gid || tab.name, label: tab.gid ? `${tab.name}` : tab.name }))
    : fileSheets.map((sheet) => ({ value: sheet.name, label: `${sheet.name} (${sheet.rows.length} baris)` }))
  const activeValue = source === 'sheets' ? selectedTab : fileSheetName
  const canImport = !!preview && (source === 'sheets' ? !!selectedTab : !!fileSheetName) && preview.total > 0

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) close() }}
      size="xl"
      title="Impor data"
      description={`${projectTitle} · pilih sumber, pilih sheet, lalu pratinjau sebelum menyimpan.`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            {[1, 2].map((n) => (
              <span key={n} className={cn('grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold', step >= n ? 'bg-forest text-white' : 'bg-canvas text-muted')}>{n}</span>
            ))}
            <span className="ml-1.5">Langkah {step} dari 2</span>
          </div>
          <div className="flex gap-2">
            {step === 2 && (
              <button className="btn-secondary" onClick={() => setStep(1)} disabled={busy}>
                <ArrowLeft className="h-4 w-4" /> Kembali
              </button>
            )}
            <button className="btn-secondary" onClick={close} disabled={busy}>Batal</button>
            {step === 2 && (
              <button className="btn-primary" onClick={importSheet} disabled={busy || !canImport}>
                {busy ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} Impor sheet terpilih
              </button>
            )}
          </div>
        </div>
      }
    >
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {SOURCE_CARDS.map((card) => (
              <button
                key={card.key}
                onClick={() => { setSource(card.key); setError(null); if (card.key === 'file') fileRef.current?.click() }}
                className={cn(
                  'flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors',
                  source === card.key ? 'border-forest/40 bg-forest-50/40' : 'border-line bg-white hover:border-forest/30',
                )}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-forest shadow-sm">
                  <card.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">{card.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{card.description}</span>
                </span>
              </button>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />

          {source === 'sheets' ? (
            <div className="space-y-3 rounded-2xl border border-line bg-canvas/40 p-4">
              <Field label="Tautan Google Sheets" hint="Sheet harus dibagikan “Anyone with the link”. Gid pada tautan otomatis terpilih.">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
                  />
                  <button className="btn-primary shrink-0" onClick={loadTabs} disabled={busy || !url.trim()}>
                    {busy ? <Spinner /> : <ArrowRight className="h-4 w-4" />} Muat daftar sheet
                  </button>
                </div>
              </Field>
              <p className="text-[10px] text-muted">
                Setelah daftar terbaca, Anda dapat memilih tab dan melihat pratinjau baris sebelum mengimpor.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-canvas/40 p-6 text-center">
              <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> Pilih berkas Excel / CSV
              </button>
              <p className="mt-2 text-[11px] text-muted">
                Semua sheet pada berkas akan terdeteksi; pilih salah satunya pada langkah berikutnya.
              </p>
            </div>
          )}

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
          {onAdvanced && source === 'file' && (
            <button className="text-[11px] font-medium text-forest hover:underline" onClick={() => { close(); onAdvanced() }}>
              Butuh pemetaan kolom manual? Gunakan impor lanjutan.
            </button>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {source === 'sheets' ? (
            <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
              <Field label="Pilih sheet" hint={tabNotice ?? 'Daftar tab dibaca langsung dari spreadsheet.'}>
                {tabs.length > 0 ? (
                  <select className="input" value={selectedTab} onChange={(e) => changeTab(e.target.value)}>
                    {tabs.map((tab) => (
                      <option key={tab.gid || tab.name} value={tab.gid || tab.name}>{tab.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    value={selectedTab}
                    onChange={(e) => setSelectedTab(e.target.value)}
                    placeholder="Nama tab, mis. Data Lokasi"
                  />
                )}
              </Field>
              <Field label="Atau masukkan nama tab manual" hint="Berguna bila daftar tab dibatasi pengaturan berbagi.">
                <div className="flex gap-2">
                  <input
                    className="input"
                    value={manualTab}
                    onChange={(e) => setManualTab(e.target.value)}
                    placeholder="Nama tab"
                  />
                  <button className="btn-secondary shrink-0" onClick={useManualTab} disabled={!manualTab.trim() || loadingPreview}>
                    Gunakan
                  </button>
                </div>
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pilih sheet dari berkas" hint={fileName}>
                <select className="input" value={fileSheetName} onChange={(e) => changeFileSheet(e.target.value)}>
                  {fileSheets.map((sheet) => (
                    <option key={sheet.name} value={sheet.name}>{sheet.name} ({sheet.rows.length} baris)</option>
                  ))}
                </select>
              </Field>
              <Field label="Berkas">
                <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas/40 px-3 py-2.5 text-xs text-ink">
                  <FileSpreadsheet className="h-4 w-4 text-forest" />
                  <span className="truncate">{fileName}</span>
                  <button className="ml-auto btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>Ganti</button>
                </div>
              </Field>
            </div>
          )}

          {activeTabs.length > 1 && source === 'sheets' && (
            <div className="flex flex-wrap gap-1.5">
              {activeTabs.map((tab) => (
                <button
                  key={tab.value}
                  className={cn('chip', activeValue === tab.value && 'chip-active')}
                  onClick={() => changeTab(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/60 px-3 py-2 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-forest" />
                {preview ? `${preview.total} baris · ${preview.headers.length} kolom` : 'Belum ada pratinjau'}
              </span>
              {loadingPreview && <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat pratinjau…</span>}
            </div>
            {preview && preview.headers.length > 0 ? (
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white/95 backdrop-blur">
                    <tr>
                      {preview.headers.map((header) => (
                        <th key={header} className="max-w-[180px] truncate border-b border-line px-3 py-2 text-left font-semibold text-muted">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((row, index) => (
                      <tr key={index} className="border-b border-line/70 last:border-0">
                        {preview.headers.map((header) => (
                          <td key={header} className="max-w-[180px] truncate px-3 py-1.5 text-ink">{row[header] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-3 py-8 text-center text-xs text-muted">
                Pilih sheet untuk melihat pratinjau kolom dan baris.
              </p>
            )}
          </div>

          <div>
            <p className="label mb-1.5">Mode impor</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                className={cn('rounded-xl border p-3 text-left', mode === 'append' ? 'border-forest/40 bg-forest-50/40' : 'border-line bg-white')}
                onClick={() => setMode('append')}
              >
                <span className="block text-xs font-medium text-ink">Tambah ke data yang ada</span>
                <span className="mt-0.5 block text-[10px] text-muted">Baris baru ditambahkan tanpa menghapus baris lama (Append).</span>
              </button>
              <button
                className={cn(
                  'rounded-xl border p-3 text-left',
                  mode === 'replace' ? 'border-red-300 bg-red-50/60' : 'border-line bg-white',
                  !canReplace && 'cursor-not-allowed opacity-50',
                )}
                onClick={() => canReplace && setMode('replace')}
                disabled={!canReplace}
              >
                <span className="block text-xs font-medium text-ink">Ganti semua data</span>
                <span className="mt-0.5 block text-[10px] text-muted">
                  {canReplace
                    ? 'Seluruh baris lama dihapus lalu diganti isi sheet terpilih.'
                    : 'Hanya admin proyek yang dapat mengganti seluruh isi tabel.'}
                </span>
              </button>
            </div>
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
