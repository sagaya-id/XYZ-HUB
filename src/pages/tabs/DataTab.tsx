import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownUp, Check, CheckSquare, ChevronDown, Columns3, Download, ExternalLink, FilePen, FileSpreadsheet, Filter,
  History, Link2, MoreVertical, Pencil, Plus, RefreshCw, Table2, Trash2, Upload, X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { useApp, useAsync } from '../../lib/app-context'
import type { DataField, DataImport, DataRecord, ProjectDetail, SheetLink } from '../../lib/types'
import {
  ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, SearchInput, Spinner, VisibilityBadge, cn,
} from '../../components/ui'
import { ImportWizard } from '../../components/import-wizard'
import { DataImportModal } from '../../components/data-import'
import { formatDateTime, relativeTime } from '../../lib/format'

type DataResponse = {
  fields: DataField[]
  records: DataRecord[]
  imports: DataImport[]
  sheet: SheetLink | null
  can_contribute: boolean
}

type ColumnFilter = { text: string; values: string[]; min: string; max: string; from: string; to: string }
type FilterKind = 'text' | 'select' | 'number' | 'date'
type ColumnMeta = { kind: FilterKind; options: string[] }

const EMPTY_FILTER: ColumnFilter = { text: '', values: [], min: '', max: '', from: '', to: '' }

function toNumber(value: string): number | null {
  const stripped = value.trim().replace(/^rp\.?\s*/i, '')
  if (!/^-?[\d.,]+$/.test(stripped)) return null
  const cleaned = stripped.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

/** Chooses the most useful filter control for a column from its values. */
function buildMeta(field: DataField, records: DataRecord[]): ColumnMeta {
  const values = records
    .map((record) => record.data[field.key])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .map((value) => String(value).trim())
  const unique = Array.from(new Set(values))
  const type = String(field.type ?? 'text').toLowerCase()
  const ratio = (test: (value: string) => boolean) =>
    values.length > 0 && values.filter(test).length / values.length >= 0.8
  if (type === 'date' || ratio((value) => /^\d{4}-\d{2}-\d{2}/.test(value))) {
    return { kind: 'date', options: unique }
  }
  if (type === 'number' || type === 'currency' || ratio((value) => toNumber(value) !== null)) {
    return { kind: 'number', options: unique }
  }
  // Low-cardinality columns get a dropdown; a column of mostly-unique free text keeps a text input.
  const categorical = unique.length <= 15 && unique.length <= Math.max(4, Math.ceil(records.length * 0.5))
  if (categorical) {
    return { kind: 'select', options: unique.sort((a, b) => a.localeCompare(b, 'id')) }
  }
  return { kind: 'text', options: [] }
}

function isFilterActive(filter: ColumnFilter, kind: FilterKind): boolean {
  if (filter.text.trim()) return true
  if (kind === 'select') return filter.values.length > 0
  if (kind === 'number') return filter.min !== '' || filter.max !== ''
  if (kind === 'date') return filter.from !== '' || filter.to !== ''
  return false
}

function matchesFilter(record: DataRecord, field: DataField, filter: ColumnFilter, meta: ColumnMeta): boolean {
  const text = String(record.data[field.key] ?? '')
  if (filter.text.trim() && !text.toLowerCase().includes(filter.text.trim().toLowerCase())) return false
  if (meta.kind === 'select' && filter.values.length > 0 && !filter.values.includes(text)) return false
  if (meta.kind === 'number') {
    const num = toNumber(text)
    const min = filter.min === '' ? null : toNumber(filter.min)
    const max = filter.max === '' ? null : toNumber(filter.max)
    if (min !== null && (num === null || num < min)) return false
    if (max !== null && (num === null || num > max)) return false
  }
  if (meta.kind === 'date') {
    const day = text.slice(0, 10)
    if (filter.from && (!day || day < filter.from)) return false
    if (filter.to && (!day || day > filter.to)) return false
  }
  return true
}

export function DataTab({ project }: { project: ProjectDetail['project']; entityKey: string }) {
  const { toast } = useApp()
  const { data, loading, reload } = useAsync<DataResponse>(
    () => api.get(`/api/projects/${project.id}/data`),
    [project.id],
  )
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({})
  const [exportOpen, setExportOpen] = useState(false)
  const [sortKey, setSortKey] = useState<string>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [rowModal, setRowModal] = useState<{ record: DataRecord | null } | null>(null)
  const [fieldModal, setFieldModal] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [advancedImportOpen, setAdvancedImportOpen] = useState(false)
  const [columnMenu, setColumnMenu] = useState<string | null>(null)
  const [manageColumnsOpen, setManageColumnsOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DataField | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<DataField | null>(null)
  const [fieldBusy, setFieldBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DataRecord | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const fields = data?.fields ?? []
  const records = data?.records ?? []
  const canContribute = data?.can_contribute ?? false
  // Column schema changes mirror the server guard: Master/Super Admin and the
  // project's admin (Project Admin) only — plain contributors cannot rename or drop columns.
  const canManageColumns = project.can_manage

  async function renameField(field: DataField, label: string) {
    const next = label.trim()
    if (!next) {
      toast('Nama kolom wajib diisi.', 'error')
      return false
    }
    if (next === field.label) return true
    setFieldBusy(true)
    try {
      await api.patch(`/api/data/fields/${field.id}`, { label: next })
      toast('Nama kolom diperbarui. Nilai sel tetap utuh.')
      setRenameTarget(null)
      reload()
      return true
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengubah nama kolom', 'error')
      return false
    } finally {
      setFieldBusy(false)
    }
  }

  async function removeField(field: DataField) {
    setFieldBusy(true)
    try {
      await api.del(`/api/data/fields/${field.id}`)
      toast(`Kolom “${field.label}” dihapus beserta seluruh nilainya.`)
      setDeleteFieldTarget(null)
      setManageColumnsOpen(false)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus kolom', 'error')
    } finally {
      setFieldBusy(false)
    }
  }

  const meta = useMemo(() => {
    const map: Record<string, ColumnMeta> = {}
    for (const field of fields) map[field.key] = buildMeta(field, records)
    return map
  }, [fields, records])

  const activeFilters = useMemo(
    () => fields.filter((field) => isFilterActive(filters[field.key] ?? EMPTY_FILTER, meta[field.key]?.kind ?? 'text')),
    [fields, filters, meta],
  )
  const hasAnyFilter = activeFilters.length > 0 || !!search.trim()

  function setFilter(key: string, patch: Partial<ColumnFilter>) {
    setFilters((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_FILTER), ...patch } }))
  }

  function resetFilters() {
    setFilters({})
    setSearch('')
  }

  const filtered = useMemo(() => {
    let rows = records
    if (search) {
      const term = search.toLowerCase()
      rows = rows.filter((record) => Object.values(record.data).some((value) => String(value).toLowerCase().includes(term)))
    }
    // Every active column filter is ANDed together, on top of the global search.
    for (const field of fields) {
      const filter = filters[field.key]
      if (!filter) continue
      const columnMeta = meta[field.key] ?? { kind: 'text' as FilterKind, options: [] }
      if (!isFilterActive(filter, columnMeta.kind)) continue
      rows = rows.filter((record) => matchesFilter(record, field, filter, columnMeta))
    }
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const left = String(a.data[sortKey] ?? '')
        const right = String(b.data[sortKey] ?? '')
        return sortDir === 'asc' ? left.localeCompare(right, 'id', { numeric: true }) : right.localeCompare(left, 'id', { numeric: true })
      })
    }
    return rows
  }, [records, filters, meta, search, sortKey, sortDir, fields])

  // Selection only covers rows currently visible after search / filters.
  const visibleIds = filtered.map((record) => record.id)
  const selectedVisible = selectedIds.filter((id) => visibleIds.includes(id))
  const allSelected = filtered.length > 0 && selectedVisible.length === filtered.length
  const someSelected = selectedVisible.length > 0 && !allSelected

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => records.some((record) => record.id === id)))
  }, [records])

  function toggleAll() {
    setSelectedIds(allSelected ? [] : visibleIds)
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }

  async function deleteSelected() {
    setBulkBusy(true)
    try {
      const res = await api.post<{ deleted: number; denied: string[] }>('/api/data/records/bulk-delete', {
        ids: selectedVisible,
      })
      toast(`${res.deleted} baris dihapus.${res.denied.length ? ` ${res.denied.length} ditolak karena hak akses.` : ''}`)
      setSelectedIds([])
      setBulkConfirm(false)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus baris', 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  function exportCsv(rows: DataRecord[], label: string) {
    const header = fields.map((f) => f.label)
    const lines = [header.join(',')]
    for (const record of rows) {
      lines.push(fields.map((f) => `"${String(record.data[f.key] ?? '').replace(/"/g, '""')}"`).join(','))
    }
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.code}-data-${label}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setExportOpen(false)
    toast(`Ekspor CSV (${rows.length} baris) siap diunduh.`)
  }

  if (loading) return <LoadingBlock label="Memuat tabel data…" />

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title">Tabel data proyek</h2>
            <p className="muted mt-0.5">Kolom kustom, impor Excel/CSV, dan sinkronisasi Google Sheets.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <button className="btn-secondary btn-sm" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen}>
                <Download className="h-3.5 w-3.5" /> Ekspor <ChevronDown className="h-3 w-3" />
              </button>
              {exportOpen && (
                <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-line bg-white p-1 shadow-[0_18px_40px_-20px_rgba(31,41,51,0.4)]">
                  <button
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-ink hover:bg-canvas"
                    onClick={() => exportCsv(records, 'semua')}
                  >
                    Ekspor semua baris <span className="text-muted">{records.length}</span>
                  </button>
                  <button
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-ink hover:bg-canvas disabled:opacity-40"
                    onClick={() => exportCsv(filtered, 'terfilter')}
                    disabled={!hasAnyFilter || filtered.length === 0}
                  >
                    Ekspor hasil filter <span className="text-muted">{filtered.length}</span>
                  </button>
                </div>
              )}
            </div>
            <button className="btn-secondary btn-sm" onClick={() => setHistoryOpen(true)}><History className="h-3.5 w-3.5" /> Riwayat</button>
            <button className="btn-secondary btn-sm" onClick={() => setSheetOpen(true)}><Link2 className="h-3.5 w-3.5" /> Google Sheets</button>
            {canManageColumns && (
              <button className="btn-secondary btn-sm" onClick={() => setManageColumnsOpen(true)} disabled={fields.length === 0}>
                <Columns3 className="h-3.5 w-3.5" /> Kelola Kolom
              </button>
            )}
            {canContribute && (
              <>
                <button className="btn-secondary btn-sm" onClick={() => setFieldModal(true)}><Table2 className="h-3.5 w-3.5" /> Tambah kolom</button>
                <button className="btn-secondary btn-sm" onClick={() => setImportOpen(true)}><Upload className="h-3.5 w-3.5" /> Impor</button>
                <button className="btn-primary btn-sm" onClick={() => setRowModal({ record: null })} disabled={fields.length === 0}><Plus className="h-3.5 w-3.5" /> Baris</button>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari di semua kolom…" className="w-full sm:w-72" />
          <span className="chip">{filtered.length} baris</span>
          <span className="chip">{fields.length} kolom</span>
          {activeFilters.length > 0 && (
            <span className="chip chip-active"><Filter className="h-3 w-3" /> {activeFilters.length} filter kolom</span>
          )}
          {data?.sheet && (
            <span className={cn('chip', data.sheet.last_sync_at ? 'chip-active' : '')}>
              <Link2 className="h-3 w-3" /> {data.sheet.last_sync_at ? `Sinkron ${relativeTime(data.sheet.last_sync_at)}` : 'Sheet terhubung'}
            </span>
          )}
        </div>
      </div>

      {fields.length === 0 ? (
        <EmptyState
          icon={Table2}
          title="Belum ada kolom data"
          description="Tambahkan kolom terlebih dahulu, lalu isi baris secara manual atau impor dari CSV/Excel."
          action={canContribute ? <button className="btn-primary" onClick={() => setFieldModal(true)}>Tambah kolom</button> : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          {hasAnyFilter && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-forest-50/50 px-3 py-2">
              <p className="text-xs text-ink">
                Menampilkan <span className="font-semibold text-forest">{filtered.length}</span> dari {records.length} baris
              </p>
              <button className="btn-secondary btn-sm" onClick={resetFilters}>
                <X className="h-3.5 w-3.5" /> Reset Semua Filter
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-3 py-2">
            <span className="text-[11px] font-medium text-ink">Tabel data</span>
            {selectedVisible.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1.5 rounded-full bg-forest-50 px-2.5 py-1 text-[11px] font-semibold text-forest">
                  <CheckSquare className="h-3.5 w-3.5" /> {selectedVisible.length} item dipilih
                </span>
                <button className="btn-ghost btn-sm" onClick={() => setSelectedIds([])}>
                  <X className="h-3.5 w-3.5" /> Batal
                </button>
                <button className="btn-danger btn-sm" onClick={() => setBulkConfirm(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Hapus Terpilih
                </button>
              </div>
            ) : (
              <span className="text-[10px] text-muted">Pilih baris untuk tindakan massal</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-canvas/70">
                <tr>
                  <th className="w-8 px-2 pt-2.5 pb-1 align-bottom">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={filtered.length === 0}
                      aria-label="Pilih semua baris"
                    />
                  </th>
                  {fields.map((field) => (
                    <th key={field.id} className="relative px-3 pt-2.5 pb-1 text-left align-bottom">
                      <div className="flex items-center gap-1">
                        <button
                          className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-muted uppercase hover:text-ink"
                          onClick={() => {
                            if (sortKey === field.key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                            else { setSortKey(field.key); setSortDir('asc') }
                          }}
                        >
                          {field.label}
                          <ArrowDownUp className={cn('h-3 w-3', sortKey === field.key ? 'text-forest' : 'text-line')} />
                        </button>
                        {canManageColumns && (
                          <button
                            className="rounded-md p-0.5 text-muted hover:bg-canvas hover:text-ink"
                            onClick={() => setColumnMenu(columnMenu === field.id ? null : field.id)}
                            aria-label={`Aksi kolom ${field.label}`}
                            aria-expanded={columnMenu === field.id}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {columnMenu === field.id && (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => setColumnMenu(null)} />
                          <div className="absolute left-2 z-30 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-[0_18px_40px_-20px_rgba(31,41,51,0.4)]">
                            <button
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-canvas"
                              onClick={() => {
                                setRenameTarget(field)
                                setRenameDraft(field.label)
                                setColumnMenu(null)
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted" /> Ubah nama kolom
                            </button>
                            <button
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => { setDeleteFieldTarget(field); setColumnMenu(null) }}
                              disabled={fields.length <= 1}
                              title={fields.length <= 1 ? 'Tabel harus memiliki minimal satu kolom' : undefined}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Hapus kolom
                            </button>
                          </div>
                        </>
                      )}
                    </th>
                  ))}
                  <th className="px-3 pt-2.5 pb-1 text-right align-bottom text-[11px] font-semibold tracking-wide text-muted uppercase">Aksi</th>
                </tr>
                <tr className="border-t border-line/70">
                  <th className="px-2 pb-2" />
                  {fields.map((field) => {
                    const columnMeta = meta[field.key] ?? { kind: 'text' as FilterKind, options: [] }
                    const filter = filters[field.key] ?? EMPTY_FILTER
                    const active = isFilterActive(filter, columnMeta.kind)
                    const controlClass = cn(
                      'w-full rounded-md border bg-white px-1.5 py-1 text-[11px] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-forest',
                      active ? 'border-forest bg-forest-50/70 font-medium text-forest' : 'border-line',
                    )
                    return (
                      <th key={`filter-${field.id}`} className="px-2 pb-2 font-normal">
                        <div className="flex items-center gap-1">
                          {columnMeta.kind === 'select' ? (
                            <select
                              className={controlClass}
                              value={filter.values[0] ?? ''}
                              onChange={(e) => setFilter(field.key, { values: e.target.value ? [e.target.value] : [] })}
                              aria-label={`Filter ${field.label}`}
                            >
                              <option value="">Semua</option>
                              {columnMeta.options.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : columnMeta.kind === 'number' ? (
                            <div className="flex w-full items-center gap-1">
                              <input
                                className={controlClass}
                                inputMode="decimal"
                                value={filter.min}
                                onChange={(e) => setFilter(field.key, { min: e.target.value })}
                                placeholder="Min"
                                aria-label={`Nilai minimum ${field.label}`}
                              />
                              <input
                                className={controlClass}
                                inputMode="decimal"
                                value={filter.max}
                                onChange={(e) => setFilter(field.key, { max: e.target.value })}
                                placeholder="Maks"
                                aria-label={`Nilai maksimum ${field.label}`}
                              />
                            </div>
                          ) : columnMeta.kind === 'date' ? (
                            <div className="flex w-full items-center gap-1">
                              <input
                                type="date"
                                className={controlClass}
                                value={filter.from}
                                onChange={(e) => setFilter(field.key, { from: e.target.value })}
                                aria-label={`Tanggal awal ${field.label}`}
                              />
                              <input
                                type="date"
                                className={controlClass}
                                value={filter.to}
                                onChange={(e) => setFilter(field.key, { to: e.target.value })}
                                aria-label={`Tanggal akhir ${field.label}`}
                              />
                            </div>
                          ) : (
                            <input
                              className={controlClass}
                              value={filter.text}
                              onChange={(e) => setFilter(field.key, { text: e.target.value })}
                              placeholder="Filter…"
                              aria-label={`Filter ${field.label}`}
                            />
                          )}
                          {active && (
                            <button
                              className="shrink-0 rounded p-0.5 text-forest hover:bg-forest-50"
                              onClick={() => setFilter(field.key, EMPTY_FILTER)}
                              aria-label={`Hapus filter ${field.label}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </th>
                    )
                  })}
                  <th className="px-2 pb-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr
                    key={record.id}
                    className={cn('border-t border-line hover:bg-canvas/50', selectedVisible.includes(record.id) && 'bg-forest-50/40')}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selectedVisible.includes(record.id)}
                        onChange={() => toggleOne(record.id)}
                        aria-label="Pilih baris data"
                      />
                    </td>
                    {fields.map((field) => (
                      <td key={field.id} className="max-w-[240px] truncate px-3 py-2 text-ink">
                        <CellValue value={record.data[field.key]} />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <VisibilityBadge visibility={record.visibility} />
                        {canContribute && (
                          <>
                            <button className="btn-ghost btn-sm" onClick={() => setRowModal({ record })}>Ubah</button>
                            <button
                              className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                              onClick={() => setDeleteTarget(record)}
                              aria-label="Hapus baris"
                              title="Hapus"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={fields.length + 2} className="px-3 py-4">
                      <EmptyState
                        icon={Filter}
                        title="Tidak ada baris yang cocok"
                        description={
                          hasAnyFilter
                            ? 'Tidak ada baris yang memenuhi kombinasi filter dan pencarian saat ini.'
                            : 'Tabel ini belum memiliki baris data.'
                        }
                        action={
                          hasAnyFilter ? (
                            <button className="btn-primary" onClick={resetFilters}>
                              <X className="h-4 w-4" /> Hapus Filter
                            </button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11px] text-muted">
            <span>Menampilkan {filtered.length} dari {records.length} baris</span>
            {activeFilters.length > 0 && (
              <button className="font-medium text-forest hover:underline" onClick={resetFilters}>Reset Semua Filter</button>
            )}
          </div>
        </div>
      )}

      {rowModal && (
        <RowModal
          projectId={project.id}
          fields={fields}
          record={rowModal.record}
          onClose={() => setRowModal(null)}
          onSaved={() => { setRowModal(null); reload() }}
        />
      )}

      {fieldModal && (
        <AddFieldModal
          projectId={project.id}
          onClose={() => setFieldModal(false)}
          onSaved={() => { setFieldModal(false); reload() }}
        />
      )}

      <DataImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={project.id}
        projectTitle={project.title}
        canReplace={canManageColumns}
        existingFields={fields.map((f) => ({ key: f.key, label: f.label }))}
        onImported={() => reload()}
        onAdvanced={() => setAdvancedImportOpen(true)}
      />

      <ImportWizard
        open={advancedImportOpen}
        onClose={() => setAdvancedImportOpen(false)}
        title={`Impor lanjutan — ${project.title}`}
        description="Petakan kolom secara manual, validasi baris, lalu pilih mode Append/Update/Skip."
        fields={fields.map((f) => ({ key: f.key, label: f.label }))}
        dedupeHint="Update akan menggabungkan nilai baru tanpa menghapus kolom lain pada baris yang sama."
        onConfirm={async (payload) => {
          const res = await api.post<{ inserted: number; updated: number; skipped: number }>(
            `/api/projects/${project.id}/data/import`,
            {
              rows: payload.rows,
              mode: payload.mode,
              dedupeField: payload.dedupeField,
              filename: payload.filename,
              worksheet: payload.worksheet,
              source: 'file',
              fields: fields.map((f) => ({ key: f.key, label: f.label })),
            },
          )
          reload()
          return `Impor selesai: ${res.inserted} baru, ${res.updated} diperbarui, ${res.skipped} dilewati.`
        }}
      />

      {manageColumnsOpen && (
        <ManageColumnsModal
          projectId={project.id}
          fields={fields}
          busy={fieldBusy}
          onClose={() => setManageColumnsOpen(false)}
          onRename={(field, label) => renameField(field, label)}
          onDelete={(field) => setDeleteFieldTarget(field)}
          onChanged={() => { reload(); setDeleteFieldTarget(null) }}
        />
      )}

      {renameTarget && (
        <Modal
          open
          onClose={() => setRenameTarget(null)}
          size="sm"
          title="Ubah nama kolom"
          description={`Kunci kolom ${renameTarget.key} tidak berubah, sehingga seluruh nilai sel tetap tersimpan.`}
          footer={
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setRenameTarget(null)}>Batal</button>
              <button
                className="btn-primary"
                onClick={() => renameField(renameTarget, renameDraft)}
                disabled={fieldBusy || !renameDraft.trim()}
              >
                {fieldBusy && <Spinner />} Simpan nama
              </button>
            </div>
          }
        >
          <Field label="Nama kolom" required>
            <input
              className="input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              autoFocus
              placeholder={renameTarget.label}
            />
          </Field>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteFieldTarget}
        title={`Hapus kolom '${deleteFieldTarget?.label ?? ''}'?`}
        description="Seluruh data pada kolom ini akan dihapus secara permanen."
        danger
        confirmLabel="Hapus kolom"
        busy={fieldBusy}
        onCancel={() => setDeleteFieldTarget(null)}
        onConfirm={() => deleteFieldTarget && removeField(deleteFieldTarget)}
      />

      {sheetOpen && (
        <SheetModal
          project={project}
          sheet={data?.sheet ?? null}
          fields={fields}
          canManage={project.can_manage}
          onClose={() => setSheetOpen(false)}
          onChanged={reload}
        />
      )}

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} size="lg" title="Riwayat impor" description="Jejak setiap impor data pada proyek ini.">
        {(data?.imports ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Belum ada riwayat impor.</p>
        ) : (
          <div className="space-y-2">
            {(data?.imports ?? []).map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
                <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-forest-50 text-forest">
                  {entry.source === 'sheets' ? <Link2 className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{entry.filename ?? 'Impor data'} · mode {entry.mode}</p>
                  <p className="text-[11px] text-muted">
                    +{entry.inserted} baru · ~{entry.updated} diperbarui · {entry.skipped} dilewati
                  </p>
                  <p className="text-[10px] text-muted">{entry.user_name ?? '—'} · {formatDateTime(entry.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={bulkConfirm}
        title={`Hapus ${selectedVisible.length} baris terpilih?`}
        description="Baris yang dipilih dihapus dari tabel data proyek. Baris tanpa hak kontribusi akan dilewati."
        danger
        confirmLabel={`Hapus ${selectedVisible.length} baris`}
        busy={bulkBusy}
        onCancel={() => setBulkConfirm(false)}
        onConfirm={deleteSelected}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus baris data?"
        description="Tindakan ini menghapus baris dari tabel proyek."
        danger
        confirmLabel="Hapus baris"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return
          await api.del(`/api/data/records/${deleteTarget.id}`).catch((e) => toast(e.message, 'error'))
          toast('Baris dihapus.')
          setDeleteTarget(null)
          reload()
        }}
      />
    </div>
  )
}

function RowModal({
  projectId, fields, record, onClose, onSaved,
}: { projectId: string; fields: DataField[]; record: DataRecord | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((field) => [field.key, String(record?.data?.[field.key] ?? '')])),
  )
  const [visibility, setVisibility] = useState(record?.visibility ?? 'team')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      if (record) await api.patch(`/api/data/records/${record.id}`, { data: values, visibility, replace: true })
      else await api.post(`/api/projects/${projectId}/data/records`, { data: values, visibility })
      toast(record ? 'Baris diperbarui.' : 'Baris ditambahkan.')
      onSaved()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan baris', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={record ? 'Ubah baris data' : 'Baris data baru'}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy && <Spinner />} Simpan
          </button>
        </div>
      }
    >
      <div className="field-grid">
        {fields.map((field) => (
          <Field key={field.id} label={field.label}>
            <input className="input" value={values[field.key] ?? ''} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Field label="Visibilitas baris" className="mt-4">
        <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
          <option value="team">Khusus tim proyek</option>
          <option value="entity">Seluruh entitas</option>
        </select>
      </Field>
    </Modal>
  )
}

/** Renders URL cells (e.g. the extracted "📍 MAP" href) as safe external links. */
function CellValue({ value }: { value: unknown }) {
  const text = String(value ?? '').trim()
  if (!text) return <span className="text-muted">—</span>
  if (!/^https?:\/\//i.test(text)) return <>{text}</>
  const isMaps = /(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)/i.test(text)
  return (
    <a
      href={text}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md bg-forest-50 px-1.5 py-0.5 text-[11px] font-medium text-forest hover:underline"
      title={text}
    >
      <ExternalLink className="h-3 w-3 shrink-0" /> {isMaps ? 'Buka Maps' : 'Buka tautan'}
    </a>
  )
}

function ManageColumnsModal({
  projectId, fields, busy, onClose, onRename, onDelete, onChanged,
}: {
  projectId: string
  fields: DataField[]
  busy: boolean
  onClose: () => void
  onRename: (field: DataField, label: string) => Promise<boolean> | void
  onDelete: (field: DataField) => void
  onChanged: () => void
}) {
  const { toast } = useApp()
  const [selected, setSelected] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const allRef = useRef<HTMLInputElement>(null)
  const allSelected = fields.length > 0 && selected.length === fields.length
  const someSelected = selected.length > 0 && !allSelected

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected
  }, [someSelected])

  function toggleAll() {
    setSelected(allSelected ? [] : fields.map((field) => field.id))
  }

  function toggleOne(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  async function bulkDelete() {
    setDeleting(true)
    try {
      const res = await api.post<{ deleted: number; records: number; kept: string | null }>(
        `/api/projects/${projectId}/data/fields/bulk-delete`,
        { ids: selected },
      )
      toast(
        res.kept
          ? `${res.deleted} kolom dihapus; kolom “${res.kept}” dipertahankan agar tabel tetap memiliki header.`
          : `${res.deleted} kolom dihapus beserta seluruh nilainya.`,
      )
      setSelected([])
      setConfirmOpen(false)
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus kolom terpilih', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Kelola kolom"
      description="Ubah nama kolom, hapus satu kolom, atau pilih beberapa kolom untuk dihapus sekaligus. Kunci kolom tidak berubah saat diganti namanya."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            className="btn-danger"
            onClick={() => setConfirmOpen(true)}
            disabled={selected.length === 0 || fields.length <= 1 || deleting}
          >
            <Trash2 className="h-4 w-4" /> Hapus {Math.min(selected.length, Math.max(fields.length - 1, 0)) || ''} Kolom Terpilih
          </button>
          <button className="btn-secondary" onClick={onClose}>Tutup</button>
        </div>
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas/60 px-3 py-2">
        <label className="flex items-center gap-2 text-xs font-medium text-ink">
          <input
            ref={allRef}
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Pilih semua kolom"
          />
          Pilih Semua
        </label>
        <span className="text-[11px] text-muted">{selected.length} dari {fields.length} kolom dipilih</span>
      </div>
      <div className="space-y-2">
        {fields.map((field) => (
          <ColumnRow
            key={field.id}
            field={field}
            selected={selected.includes(field.id)}
            canDelete={fields.length > 1}
            busy={busy || deleting}
            onToggle={() => toggleOne(field.id)}
            onRename={(label) => onRename(field, label)}
            onDelete={() => onDelete(field)}
          />
        ))}
      </div>
      {selected.length > 0 && (
        <p className={cn(
          'mt-3 rounded-xl px-3 py-2 text-[11px]',
          selected.length >= fields.length ? 'bg-amber-50 text-amber-800' : 'bg-canvas text-muted',
        )}>
          {selected.length >= fields.length
            ? 'Semua kolom dipilih. Kolom pertama otomatis dipertahankan agar tabel tidak kehilangan header.'
            : `${selected.length} kolom akan dihapus beserta seluruh nilainya di setiap baris.`}
        </p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={`Hapus ${Math.min(selected.length, fields.length - 1)} kolom terpilih?`}
        description="Seluruh data pada kolom-kolom ini akan dihapus secara permanen."
        danger
        confirmLabel={`Hapus ${Math.min(selected.length, fields.length - 1)} kolom`}
        busy={deleting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={bulkDelete}
      />
    </Modal>
  )
}

function ColumnRow({
  field, selected, canDelete, busy, onToggle, onRename, onDelete,
}: {
  field: DataField
  selected: boolean
  canDelete: boolean
  busy: boolean
  onToggle: () => void
  onRename: (label: string) => Promise<boolean> | void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(field.label)
  const dirty = label.trim() !== field.label && label.trim().length > 0

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2',
      selected ? 'border-forest/40 bg-forest-50/40' : 'border-line',
    )}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Pilih kolom ${field.label}`}
        className="shrink-0"
      />
      <FilePen className="h-3.5 w-3.5 shrink-0 text-muted" />
      <input
        className="input min-w-0 flex-1 !py-1.5 text-xs"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        aria-label={`Nama kolom ${field.label}`}
      />
      <span className="hidden shrink-0 font-mono text-[10px] text-muted sm:block">{field.key}</span>
      <button className="btn-secondary btn-sm shrink-0" onClick={() => onRename(label)} disabled={!dirty || busy}>
        <Check className="h-3 w-3" /> Simpan
      </button>
      <button
        className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onDelete}
        disabled={!canDelete || busy}
        aria-label={`Hapus kolom ${field.label}`}
        title={canDelete ? 'Hapus kolom' : 'Tabel harus memiliki minimal satu kolom'}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function AddFieldModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const [form, setForm] = useState({ label: '', key: '' })
  const [busy, setBusy] = useState(false)

  const key = form.key || form.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

  async function save() {
    setBusy(true)
    try {
      await api.post(`/api/projects/${projectId}/data/fields`, { key, label: form.label || key })
      toast('Kolom ditambahkan.')
      onSaved()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menambah kolom', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Kolom baru"
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy || !form.label.trim()}>
            {busy && <Spinner />} Simpan kolom
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Nama kolom" required>
          <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} autoFocus placeholder="Contoh: Jumlah Siswa" />
        </Field>
        <Field label="Kunci kolom" hint="Digunakan untuk pemetaan impor dan ekspor.">
          <input className="input font-mono text-xs" value={key} readOnly />
        </Field>
      </div>
    </Modal>
  )
}

function SheetModal({
  project, sheet, fields, canManage, onClose, onChanged,
}: {
  project: ProjectDetail['project']
  sheet: SheetLink | null
  fields: DataField[]
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { toast } = useApp()
  const [url, setUrl] = useState(sheet?.url ?? '')
  const [worksheet, setWorksheet] = useState(sheet?.worksheet ?? '')
  const [tabs, setTabs] = useState<{ gid: string; name: string }[]>([])
  const [tabNotice, setTabNotice] = useState<string | null>(null)
  const [tabsBusy, setTabsBusy] = useState(false)
  const [manualTab, setManualTab] = useState('')
  const [syncMode, setSyncMode] = useState<'merge' | 'reset'>('merge')
  const [dedupeField, setDedupeField] = useState(fields[0]?.key ?? '')
  const [conflictPolicy, setConflictPolicy] = useState<'remote' | 'local'>('remote')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  /** Reads every tab of the pasted URL; the gid in the link is pre-selected. */
  async function loadTabs(target = url, preselectGid = true) {
    if (!target.trim()) return
    setTabsBusy(true)
    setTabNotice(null)
    setError(null)
    try {
      const res = await api.post<{ sheets: { gid: string; name: string }[]; selectedGid: string | null; restricted: boolean; message: string | null }>(
        `/api/projects/${project.id}/sheets/tabs`,
        { url: target },
      )
      setTabs(res.sheets)
      setTabNotice(res.message ?? null)
      // Auto-loading on open must not override the tab saved in the project; an
      // explicit "Muat Daftar Sheet" click still pre-selects the gid in the URL.
      if (preselectGid && res.selectedGid) setWorksheet(res.selectedGid)
      else if (!worksheet && res.sheets[0]) setWorksheet(res.sheets[0].gid || res.sheets[0].name)
    } catch (err: any) {
      setTabs([])
      setTabNotice(err?.message ?? 'Daftar tab tidak dapat dibaca otomatis. Ketik nama tab secara manual.')
    } finally {
      setTabsBusy(false)
    }
  }

  useEffect(() => {
    if (sheet?.url) void loadTabs(sheet.url, !sheet.worksheet)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function useManualTab() {
    const name = manualTab.trim()
    if (!name) return
    setWorksheet(name)
    setTabs((prev) => (prev.some((tab) => tab.name === name) ? prev : [...prev, { gid: name, name }]))
    setPreview(null)
  }

  async function linkSheet() {
    setBusy(true)
    setError(null)
    try {
      await api.put(`/api/projects/${project.id}/sheets`, { url, worksheet: worksheet || null })
      // No parent reload here: it would unmount this modal mid-flow. The saved
      // tab is read back from the API on the next workspace refresh.
      toast('Google Sheets terhubung dengan tab terpilih.')
    } catch (err: any) {
      setError(err?.message ?? 'Gagal menghubungkan sheet.')
    } finally {
      setBusy(false)
    }
  }

  async function runPreview() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post(`/api/projects/${project.id}/sheets/preview`, {
        dedupeField, url, worksheet,
      })
      setPreview(res)
    } catch (err: any) {
      setError(err?.message ?? 'Pratinjau gagal.')
    } finally {
      setBusy(false)
    }
  }

  async function runSync() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{
        inserted: number; updated: number; skipped: number; reset?: boolean
        removedColumns?: number; removedRows?: number
      }>(`/api/projects/${project.id}/sheets/sync`, {
        dedupeField, conflictPolicy, worksheet, mode: syncMode,
      })
      toast(
        res.reset
          ? `Reset selesai: ${res.removedColumns ?? 0} kolom & ${res.removedRows ?? 0} baris lama dibersihkan, ${res.inserted} baris dimuat ulang.`
          : `Sinkronisasi selesai: +${res.inserted} / ~${res.updated}`,
      )
      setPreview(null)
      onChanged()
    } catch (err: any) {
      setError(err?.message ?? 'Sinkronisasi gagal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Google Sheets"
      description="Impor sheet publik atau sinkronkan manual dengan pratinjau konflik."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Tutup</button>
          {preview && (
            <button className="btn-primary" onClick={runSync} disabled={busy}>
              {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Sinkronkan sekarang
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <Field
          label="Tautan Google Sheets"
          hint='Sheet harus dibagikan "Anyone with the link" agar dapat dibaca. Untuk sheet privat, diperlukan OAuth Google yang belum dikonfigurasi pada demo ini.'
        >
          <div className="flex gap-2">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" disabled={!canManage} />
            <button className="btn-secondary" onClick={linkSheet} disabled={busy || !url || !canManage}>Simpan</button>
          </div>
        </Field>

        <div className="space-y-3 rounded-2xl border border-line bg-canvas/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="label">Pilih tab sheet</p>
              <p className="mt-0.5 text-[11px] text-muted">Impor hanya dari tab yang dipilih, bukan tab pertama spreadsheet.</p>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => loadTabs()} disabled={tabsBusy || !url.trim()}>
              {tabsBusy ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} Muat Daftar Sheet
            </button>
          </div>
          {tabs.length > 0 ? (
            <Field label="Pilih sheet" hint={tabNotice ?? `${tabs.length} tab terdeteksi. Gid pada tautan otomatis terpilih.`}>
              <select className="input" value={worksheet} onChange={(e) => { setWorksheet(e.target.value); setPreview(null) }} disabled={!canManage}>
                <option value="">— pilih tab —</option>
                {tabs.map((tab) => (
                  <option key={tab.gid || tab.name} value={tab.gid || tab.name}>{tab.name}</option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="rounded-xl bg-white px-3 py-2 text-[11px] text-muted">
              {tabNotice ?? 'Klik “Muat Daftar Sheet” untuk membaca daftar tab dari spreadsheet.'}
            </p>
          )}
          <Field label="Atau ketik nama tab sheet secara manual" hint="Berguna bila daftar tab dibatasi pengaturan berbagi Google.">
            <div className="flex gap-2">
              <input
                className="input"
                value={manualTab}
                onChange={(e) => setManualTab(e.target.value)}
                placeholder="Mis. ALL BIBIT"
                disabled={!canManage}
              />
              <button className="btn-secondary shrink-0" onClick={useManualTab} disabled={!manualTab.trim() || !canManage}>Gunakan</button>
            </div>
          </Field>
          {worksheet && (
            <p className="text-[11px]">
              <span className="chip chip-active">Tab aktif: {tabs.find((tab) => (tab.gid || tab.name) === worksheet)?.name ?? worksheet}</span>
            </p>
          )}
        </div>

        {sheet && (
          <div className="rounded-xl border border-line bg-canvas/50 px-3 py-2.5 text-xs">
            <p className="text-ink">Status: {sheet.status ?? 'terhubung'}</p>
            <p className="text-muted">Sinkron terakhir: {sheet.last_sync_at ? formatDateTime(sheet.last_sync_at) : 'belum pernah'}</p>
          </div>
        )}

        <div>
          <p className="label mb-1.5">Mode sinkronisasi</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className={cn('rounded-xl border p-3 text-left', syncMode === 'merge' ? 'border-forest/40 bg-forest-50/40' : 'border-line bg-white')}
              onClick={() => setSyncMode('merge')}
              disabled={!canManage}
            >
              <span className="block text-xs font-medium text-ink">Perbarui &amp; Tambah Baris (Merge)</span>
              <span className="mt-0.5 block text-[10px] text-muted">Memperbarui baris yang cocok lewat kolom kunci, lalu menambah baris baru.</span>
            </button>
            <button
              className={cn('rounded-xl border p-3 text-left', syncMode === 'reset' ? 'border-red-300 bg-red-50/60' : 'border-line bg-white')}
              onClick={() => setSyncMode('reset')}
              disabled={!canManage}
            >
              <span className="block text-xs font-medium text-ink">Ganti Semua Kolom &amp; Data (Reset Bersih)</span>
              <span className="mt-0.5 block text-[10px] text-muted">Menghapus kolom dan baris lama, lalu membangun ulang dari tab terpilih.</span>
            </button>
          </div>
        </div>

        {syncMode === 'merge' ? (
          <div className="field-grid">
            <Field label="Kolom kunci duplikat">
              <select className="input" value={dedupeField} onChange={(e) => setDedupeField(e.target.value)}>
                <option value="">— tanpa kunci —</option>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Jika terjadi konflik" hint="Data lokal tidak akan ditimpa tanpa persetujuan.">
              <select className="input" value={conflictPolicy} onChange={(e) => setConflictPolicy(e.target.value as any)}>
                <option value="remote">Gunakan nilai dari sheet (remote)</option>
                <option value="local">Pertahankan nilai lokal</option>
              </select>
            </Field>
          </div>
        ) : (
          <p className="rounded-xl border border-red-200 bg-red-50/60 px-3 py-2 text-[11px] text-red-800">
            Mode reset akan menghapus seluruh kolom &amp; baris tabel ini sebelum memuat ulang tab terpilih. Tindakan ini tidak dapat dibatalkan.
          </p>
        )}

        <button className="btn-secondary w-full" onClick={runPreview} disabled={busy || !url.trim()}>
          {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Pratinjau perubahan
        </button>

        {preview && (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="chip">{preview.totalRemote} baris sheet</span>
              <span className="chip chip-active">{preview.counts.added} baru</span>
              <span className="chip border-amber-200 bg-amber-50 text-amber-800">{preview.counts.changed} berubah</span>
              <span className="chip">{preview.counts.unchanged} sama</span>
            </div>
            {preview.changed?.length > 0 && (
              <div className="max-h-32 overflow-auto text-[11px]">
                {preview.changed.slice(0, 8).map((change: any, index: number) => (
                  <p key={index} className="truncate text-muted">Baris dengan kolom berubah: {change.diffs?.join(', ')}</p>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted">
              Sinkronisasi menghormati pilihan konflik di atas dan tidak menghapus baris lokal.
            </p>
          </div>
        )}

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
