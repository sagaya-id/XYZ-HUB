import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlarmClock, CalendarDays, CheckCircle2, ChevronRight, Flag, ListChecks, Plus, RefreshCw,
  Trash2, Undo2,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useAsync } from '../lib/app-context'
import type { ProjectSummary, ReminderItem } from '../lib/types'
import {
  ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, PageHeader, Spinner, cn,
} from '../components/ui'
import { formatDate, todayIso } from '../lib/format'

type RemindersResponse = {
  items: ReminderItem[]
  leadDays: number
  today: string
  counts: { total: number; event: number; task: number; project: number; manual: number; done: number }
}

const LEAD_OPTIONS = [0, 1, 2, 3, 7, 14, 30]

const SOURCE_META: Record<string, { label: string; className: string; icon: any }> = {
  event: { label: 'Agenda', className: 'bg-sky-50 text-sky-700', icon: CalendarDays },
  task: { label: 'Tenggat tugas', className: 'bg-amber-50 text-amber-800', icon: ListChecks },
  project: { label: 'Milestone proyek', className: 'bg-forest-50 text-forest', icon: Flag },
  manual: { label: 'Manual', className: 'bg-canvas text-muted', icon: AlarmClock },
}

function relativeDayLabel(date: string, today: string): string {
  const diff = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
  if (diff === 0) return 'Hari ini'
  if (diff === 1) return 'Besok'
  if (diff === -1) return 'Kemarin'
  if (diff > 1) return `${diff} hari lagi`
  return `${Math.abs(diff)} hari lalu`
}

export function RemindersPage() {
  const { entity } = useParams<{ entity: string }>()
  const { toast } = useApp()
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ReminderItem | null>(null)
  const { data, loading, reload } = useAsync<RemindersResponse>(
    () => api.get(`/api/reminders?entity=${entity}`),
    [entity],
  )
  const { data: projectsData } = useAsync<{ projects: ProjectSummary[] }>(
    () => api.get(`/api/projects?entity=${entity}`),
    [entity],
  )

  const today = data?.today ?? todayIso()
  const leadDays = data?.leadDays ?? 3
  const items = data?.items ?? []
  const active = useMemo(() => items.filter((item) => !item.done), [items])
  const done = useMemo(() => items.filter((item) => item.done), [items])

  async function changeLead(days: number) {
    setBusy(true)
    try {
      await api.put('/api/reminders/settings', { leadDays: days })
      toast(`Rentang pengingat otomatis: ${days === 0 ? 'hari ini saja' : `${days} hari ke depan`}.`)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan rentang pengingat', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleDone(item: ReminderItem) {
    try {
      await api.post(`/api/reminders/${item.id}/done`)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memperbarui pengingat', 'error')
    }
  }

  async function remove(item: ReminderItem) {
    try {
      await api.del(`/api/reminders/${item.id}`)
      toast('Pengingat manual dihapus.')
      setDeleteTarget(null)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus pengingat', 'error')
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Pengingat"
        title="Pengingat & tenggat"
        description="Agenda, tenggat tugas, dan milestone proyek masuk otomatis ke daftar ini. Anda juga dapat menambah pengingat manual."
        actions={
          <>
            <button className="btn-secondary" onClick={reload} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Muat ulang
            </button>
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Pengingat manual
            </button>
          </>
        }
      />

      <div className="mb-4 card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="section-title">Rentang pengingat otomatis</h2>
            <p className="muted mt-0.5">
              Data dibaca langsung dari agenda, kanban, dan tanggal selesai proyek setiap kali halaman dibuka — tidak perlu
              menyalin manual.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {LEAD_OPTIONS.map((days) => (
              <button
                key={days}
                className={cn('chip', leadDays === days && 'chip-active')}
                onClick={() => changeLead(days)}
                disabled={busy}
              >
                {days === 0 ? 'Hari ini' : `${days} hari`}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span className="chip">{data?.counts.event ?? 0} agenda</span>
          <span className="chip">{data?.counts.task ?? 0} tenggat tugas</span>
          <span className="chip">{data?.counts.project ?? 0} milestone proyek</span>
          <span className="chip">{data?.counts.manual ?? 0} manual</span>
          <span className="ml-auto">Zona waktu Asia/Jakarta</span>
        </div>
      </div>

      {loading ? (
        <LoadingBlock label="Memuat pengingat…" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">Akan datang</h3>
              <span className="chip">{active.length} pengingat</span>
            </div>
            {active.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={AlarmClock}
                  title="Belum ada pengingat"
                  description="Tambahkan agenda, tenggat tugas, atau tanggal selesai proyek — pengingat akan muncul di sini secara otomatis."
                />
              </div>
            ) : (
              <div className="divide-y divide-line">
                {active.map((item) => {
                  const meta = SOURCE_META[item.source] ?? SOURCE_META.manual
                  const Icon = meta.icon
                  return (
                    <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', meta.className)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('badge', meta.className)}>{meta.label}</span>
                          {item.urgent && <span className="badge bg-red-50 text-red-700">Perlu perhatian</span>}
                        </div>
                        <p className="mt-1 text-sm font-medium text-ink">{item.title}</p>
                        {item.body && <p className="text-[11px] text-muted">{item.body}</p>}
                        <p className="mt-0.5 text-[10px] text-muted">
                          {formatDate(item.date, 'long')}
                          {item.time ? ` · ${item.time} WIB` : ''} · {relativeDayLabel(item.date, today)}
                        </p>
                        {item.link && (
                          <Link
                            to={item.link.replace('/app/', `/app/${entity}/`)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-forest hover:underline"
                          >
                            Buka data terkait <ChevronRight className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      {item.source === 'manual' && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            className="rounded-lg p-1.5 text-muted hover:bg-forest-50 hover:text-forest"
                            onClick={() => toggleDone(item)}
                            title="Tandai selesai"
                            aria-label="Tandai selesai"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                            onClick={() => setDeleteTarget(item)}
                            title="Hapus"
                            aria-label="Hapus pengingat"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <div className="space-y-4">
            <section className="card p-4">
              <h3 className="text-sm font-semibold text-ink">Pengingat manual selesai</h3>
              <p className="muted mt-0.5">Pengingat manual tetap tersimpan sampai Anda menghapusnya.</p>
              <div className="mt-3 space-y-1.5">
                {done.length === 0 && <p className="text-xs text-muted">Belum ada yang ditandai selesai.</p>}
                {done.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink">{item.title}</span>
                      <span className="block text-[10px] text-muted">{formatDate(item.date)}</span>
                    </span>
                    <button
                      className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink"
                      onClick={() => toggleDone(item)}
                      title="Buka kembali"
                      aria-label="Buka kembali pengingat"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="card p-4">
              <h3 className="text-sm font-semibold text-ink">Cara kerja pengingat</h3>
              <ol className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted">
                <li><strong className="text-ink">1. Agenda kalender</strong> — setiap agenda terlihat yang jatuh tempo dalam rentang di atas masuk otomatis.</li>
                <li><strong className="text-ink">2. Tenggat tugas kanban</strong> — tugas dengan tanggal tenggat dan belum selesai ikut muncul.</li>
                <li><strong className="text-ink">3. Milestone proyek</strong> — tanggal selesai proyek yang belum berstatus Selesai.</li>
                <li><strong className="text-ink">4. Manual</strong> — tambahkan pengingat sendiri kapan saja, lengkap dengan catatan dan proyek terkait.</li>
              </ol>
              <p className="mt-3 rounded-xl bg-canvas/70 px-3 py-2 text-[10px] text-muted">
                Pengingat dihitung ulang saat aplikasi dibuka (tidak ada cron latar belakang), dan notifikasi lonceng
                memakai rentang yang sama.
              </p>
            </section>
          </div>
        </div>
      )}

      {addOpen && (
        <ManualReminderModal
          projects={projectsData?.projects ?? []}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); reload() }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus pengingat manual?"
        description={`${deleteTarget?.title ?? ''} akan dihapus dari daftar pengingat Anda.`}
        danger
        confirmLabel="Hapus pengingat"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove(deleteTarget)}
      />
    </div>
  )
}

function ManualReminderModal({
  projects, onClose, onSaved,
}: { projects: ProjectSummary[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const [form, setForm] = useState({
    title: '',
    body: '',
    projectId: '',
    remindAt: `${todayIso()}T09:00`,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/reminders', {
        title: form.title,
        body: form.body,
        projectId: form.projectId || null,
        remindAt: form.remindAt,
      })
      toast('Pengingat manual ditambahkan.')
      onSaved()
    } catch (err: any) {
      setError(err?.message ?? 'Gagal menyimpan pengingat.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Pengingat manual"
      description="Pengingat pribadi yang hanya terlihat oleh Anda."
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy || !form.title.trim()}>
            {busy && <Spinner />} Simpan pengingat
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Judul" required>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Contoh: Konfirmasi laporan bulanan" autoFocus />
        </Field>
        <Field label="Tanggal & waktu" required>
          <input type="datetime-local" className="input" value={form.remindAt} onChange={(e) => setForm({ ...form, remindAt: e.target.value })} />
        </Field>
        <Field label="Proyek terkait (opsional)">
          <select className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
            <option value="">Tanpa proyek</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.code} — {project.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Catatan">
          <textarea className="input min-h-[70px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
