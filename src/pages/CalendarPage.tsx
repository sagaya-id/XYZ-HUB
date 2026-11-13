import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Tag, Trash2, Users,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useAsync } from '../lib/app-context'
import type { EventCategory, EventItem, ProjectSummary } from '../lib/types'
import {
  ConfirmDialog, Field, LoadingBlock, Modal, PageHeader, Segmented, Spinner, cn,
} from '../components/ui'
import { CalendarView } from '../components/calendar'
import { addDaysIso, formatDate, monthName, todayIso } from '../lib/format'

type ViewMode = 'day' | 'week' | 'month' | 'year'

function rangeFor(view: ViewMode, anchor: string) {
  const [year, month] = anchor.split('-').map(Number)
  if (view === 'day') return { from: anchor, to: anchor }
  if (view === 'week') {
    const date = new Date(year, month - 1, Number(anchor.slice(8, 10)))
    const weekday = (date.getDay() + 6) % 7
    const start = addDaysIso(anchor, -weekday)
    return { from: start, to: addDaysIso(start, 6) }
  }
  if (view === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` }
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const firstDate = new Date(year, month - 1, 1)
  const weekday = (firstDate.getDay() + 6) % 7
  const last = new Date(year, month, 0).getDate()
  return { from: addDaysIso(first, -weekday), to: addDaysIso(`${year}-${String(month).padStart(2, '0')}-${last}`, 7 - ((last + weekday) % 7 || 7)) }
}

function shift(anchor: string, view: ViewMode, direction: number): string {
  const [year, month, day] = anchor.split('-').map(Number)
  if (view === 'day') return addDaysIso(anchor, direction)
  if (view === 'week') return addDaysIso(anchor, direction * 7)
  if (view === 'year') return `${year + direction}-${String(month).padStart(2, '0')}-01`
  const date = new Date(year, month - 1 + direction, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

export function CalendarPage() {
  const { entity } = useParams<{ entity: string }>()
  const { me, toast } = useApp()
  const [view, setView] = useState<ViewMode>('month')
  const [anchor, setAnchor] = useState(todayIso())
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [selectedDay, setSelectedDay] = useState<string | null>(todayIso())
  const [eventModal, setEventModal] = useState<{ event?: EventItem } | null>(null)
  const [detail, setDetail] = useState<EventItem | null>(null)
  const [categoriesOpen, setCategoriesOpen] = useState(false)

  // Day view steps exactly one calendar day in both directions — no weekend
  // skipping — and keeps the selected-day panel on the same date.
  function go(direction: number) {
    const next = shift(anchor, view, direction)
    setAnchor(next)
    if (view === 'day') setSelectedDay(next)
  }

  function goToday() {
    const today = todayIso()
    setAnchor(today)
    setSelectedDay(today)
  }

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor])
  const { data, loading, reload } = useAsync<{ events: EventItem[]; categories: EventCategory[] }>(
    () => api.get(`/api/events?entity=${entity}&from=${range.from}T00:00&to=${range.to}T23:59${projectIds.length ? `&projectIds=${projectIds.join(',')}` : ''}`),
    [entity, range.from, range.to, projectIds.join(',')],
  )
  const { data: projectsData } = useAsync<{ projects: ProjectSummary[] }>(
    () => api.get(`/api/projects?entity=${entity}`),
    [entity],
  )
  const { data: holidayData } = useAsync<{ holidays: { date: string; name: string }[] }>(
    () => api.get(`/api/holidays?year=${anchor.slice(0, 4)}`),
    [anchor.slice(0, 4)],
  )

  const events = data?.events ?? []
  const projects = projectsData?.projects ?? []
  const holidays = useMemo(
    () => Object.fromEntries((holidayData?.holidays ?? []).map((h) => [h.date, h.name])),
    [holidayData],
  )
  const canCreate = true

  const periodLabel = view === 'day'
    ? formatDate(anchor, 'long')
    : view === 'week'
      ? `${formatDate(range.from)} – ${formatDate(range.to)}`
      : view === 'year'
        ? `Tahun ${anchor.slice(0, 4)}`
        : `${monthName(Number(anchor.slice(5, 7)) - 1)} ${anchor.slice(0, 4)}`

  const dayEvents = events.filter((event) => (event.date || event.start_local.slice(0, 10)) === selectedDay)
  const upcoming = [...events]
    .filter((event) => (event.start_local ?? '') >= `${todayIso()}T00:00`)
    .sort((a, b) => a.start_local.localeCompare(b.start_local))
    .slice(0, 6)

  return (
    <div>
      <PageHeader
        eyebrow="Agenda entitas"
        title="Kalender"
        description="Kalender independen per entitas. Judul dan waktu agenda tampil langsung di dalam tanggal pada tampilan bulan."
        actions={
          <>
            {(me?.user.role === 'MA' || me?.user.role === 'SA') && (
              <button className="btn-secondary" onClick={() => setCategoriesOpen(true)}>
                <Tag className="h-4 w-4" /> Kategori
              </button>
            )}
            {canCreate && (
              <button className="btn-primary" onClick={() => setEventModal({})}>
                <Plus className="h-4 w-4" /> Agenda baru
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 card p-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <button className="rounded-full border border-line p-2 text-muted hover:bg-canvas" onClick={() => go(-1)} aria-label="Sebelumnya">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="btn-secondary btn-sm" onClick={goToday}>Hari ini</button>
            <button className="rounded-full border border-line p-2 text-muted hover:bg-canvas" onClick={() => go(1)} aria-label="Berikutnya">
              <ChevronRight className="h-4 w-4" />
            </button>
            <h2 className="ml-1 text-sm font-semibold text-ink sm:text-base">{periodLabel}</h2>
          </div>
          <Segmented
            value={view}
            onChange={(value) => {
              setView(value)
              if (value === 'day') setSelectedDay(anchor)
            }}
            options={[
              { value: 'day', label: 'Hari' },
              { value: 'week', label: 'Minggu' },
              { value: 'month', label: 'Bulan' },
              { value: 'year', label: 'Tahun' },
            ]}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">Filter proyek</span>
          <button className={cn('chip', projectIds.length === 0 && 'chip-active')} onClick={() => setProjectIds([])}>Semua</button>
          {projects.map((project) => (
            <button
              key={project.id}
              className={cn('chip', projectIds.includes(project.id) && 'chip-active')}
              onClick={() => setProjectIds((prev) => prev.includes(project.id) ? prev.filter((id) => id !== project.id) : [...prev, project.id])}
            >
              {project.code}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[1.75fr_1fr]">
        <div>
          {loading ? (
            <LoadingBlock label="Memuat agenda…" />
          ) : (
            <CalendarView
              view={view}
              anchor={anchor}
              events={events}
              holidays={holidays}
              onEventClick={(event) => setDetail(event)}
              onDayClick={(date, list) => {
                setSelectedDay(date)
                if (list.length === 0) setView('day')
                setAnchor(date)
              }}
              onMonthClick={(month) => {
                setAnchor(`${anchor.slice(0, 4)}-${String(month + 1).padStart(2, '0')}-01`)
                setView('month')
              }}
            />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted">
            {(data?.categories ?? []).map((category) => (
              <span key={category.id} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} /> {category.name}
              </span>
            ))}
            <span className="ml-auto">Zona waktu Asia/Jakarta</span>
          </div>
        </div>

        <div className="space-y-3">
          <section className="card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">
                {selectedDay ? formatDate(selectedDay, 'long') : 'Pilih tanggal'}
              </h3>
              <span className="chip">{dayEvents.length} agenda</span>
            </div>
            {selectedDay && holidays[selectedDay] && (
              <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">Libur nasional: {holidays[selectedDay]}</p>
            )}
            <div className="mt-3 space-y-1.5">
              {dayEvents.length === 0 && <p className="py-4 text-center text-xs text-muted">Tidak ada agenda pada tanggal ini.</p>}
              {dayEvents.map((event) => (
                <button key={event.id} onClick={() => setDetail(event)} className="flex w-full items-start gap-2.5 rounded-xl border border-line px-2.5 py-2 text-left hover:bg-canvas">
                  <span className="w-11 shrink-0 text-[11px] font-semibold text-forest">{event.all_day ? '—' : event.time_label}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">{event.title}</span>
                    <span className="block truncate text-[10px] text-muted">{event.project_title ?? 'Agenda entitas'}{event.location ? ` · ${event.location}` : ''}</span>
                  </span>
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: event.category_color ?? '#245A46' }} />
                </button>
              ))}
            </div>
          </section>

          <section className="card p-4">
            <h3 className="text-sm font-semibold text-ink">Agenda terdekat</h3>
            <div className="mt-2 space-y-1">
              {upcoming.length === 0 && <p className="py-4 text-center text-xs text-muted">Belum ada agenda mendatang.</p>}
              {upcoming.map((event) => (
                <button key={event.id} onClick={() => setDetail(event)} className="flex w-full items-start gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-canvas">
                  <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-ink">{event.title}</span>
                    <span className="block text-[10px] text-muted">
                      {formatDate(event.date, 'short')} · {event.all_day ? 'Sepanjang hari' : event.time_label}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {eventModal && (
        <EventModal
          projectId={projects[0]?.id}
          projects={projects}
          categories={data?.categories ?? []}
          event={eventModal.event}
          onClose={() => setEventModal(null)}
          onSaved={() => { setEventModal(null); reload() }}
        />
      )}

      {detail && (
        <EventDetail
          event={detail}
          onClose={() => setDetail(null)}
          onEdited={(event) => { setDetail(null); setEventModal({ event }) }}
          onDeleted={() => { setDetail(null); reload() }}
        />
      )}

      {categoriesOpen && (
        <CategoriesModal
          entity={entity!}
          categories={data?.categories ?? []}
          onClose={() => setCategoriesOpen(false)}
          onChanged={reload}
        />
      )}
    </div>
  )
}

function EventModal({
  projects, categories, event, onClose, onSaved,
}: {
  projectId?: string
  projects: ProjectSummary[]
  categories: EventCategory[]
  event?: EventItem
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useApp()
  const [form, setForm] = useState({
    title: event?.title ?? '',
    description: event?.description ?? '',
    projectId: event?.project_id ?? '',
    categoryId: event?.category_id ?? (categories[0]?.id ?? ''),
    startLocal: event?.start_local ?? `${todayIso()}T09:00`,
    endLocal: event?.end_local ?? `${todayIso()}T10:00`,
    allDay: event?.all_day ?? false,
    visibility: (event?.visibility ?? 'entity') as 'team' | 'entity',
    location: event?.location ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const payload = {
        ...form,
        projectId: form.projectId || null,
        endLocal: form.allDay ? form.startLocal.slice(0, 10) : form.endLocal,
        startLocal: form.allDay ? `${form.startLocal.slice(0, 10)}T00:00` : form.startLocal,
      }
      if (event) await api.patch(`/api/events/${event.id}`, payload)
      else await api.post('/api/events', payload)
      toast(event ? 'Agenda diperbarui.' : 'Agenda dibuat.')
      onSaved()
    } catch (err: any) {
      setError(err?.message ?? 'Gagal menyimpan agenda.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={event ? 'Ubah agenda' : 'Agenda baru'}
      description="Notifikasi akan dikirim ke anggota proyek terkait."
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy || !form.title.trim()}>
            {busy && <Spinner />} Simpan agenda
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Judul agenda" required>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Contoh: Monitoring Lapangan" />
        </Field>
        <div className="field-grid">
          <Field label="Proyek">
            <select className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">Agenda entitas (tanpa proyek)</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.code} — {project.title}</option>)}
            </select>
          </Field>
          <Field label="Kategori">
            <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Tanpa kategori</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </Field>
          <Field label="Mulai">
            <input
              type={form.allDay ? 'date' : 'datetime-local'}
              className="input"
              value={form.allDay ? form.startLocal.slice(0, 10) : form.startLocal}
              onChange={(e) => setForm({ ...form, startLocal: form.allDay ? `${e.target.value}T00:00` : e.target.value })}
            />
          </Field>
          <Field label="Selesai">
            <input
              type={form.allDay ? 'date' : 'datetime-local'}
              className="input"
              value={form.allDay ? (form.endLocal ?? '').slice(0, 10) : form.endLocal}
              onChange={(e) => setForm({ ...form, endLocal: form.allDay ? `${e.target.value}T23:59` : e.target.value })}
              disabled={form.allDay}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-line bg-canvas/50 px-3 py-2.5 text-sm">
          <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
          <span className="text-ink">Sepanjang hari</span>
          <span className="text-xs text-muted">(judul ditampilkan tanpa jam)</span>
        </label>
        <Field label="Lokasi">
          <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Tempat kegiatan" />
        </Field>
        <Field label="Deskripsi">
          <textarea className="input min-h-[70px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Visibilitas">
          <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as any })}>
            <option value="entity">Seluruh entitas</option>
            <option value="team">Khusus tim proyek</option>
          </select>
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}

function EventDetail({
  event, onClose, onEdited, onDeleted,
}: { event: EventItem; onClose: () => void; onEdited: (event: EventItem) => void; onDeleted: () => void }) {
  const { toast } = useApp()
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="md"
        title={event.title}
        description={formatDate(event.date, 'long')}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Hapus
            </button>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={onClose}>Tutup</button>
              <button className="btn-primary" onClick={() => onEdited(event)}>Ubah agenda</button>
            </div>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge" style={{ backgroundColor: `${event.category_color ?? '#245A46'}1A`, color: event.category_color ?? '#245A46' }}>
              {event.category_name ?? 'Tanpa kategori'}
            </span>
            <span className="badge bg-canvas text-muted">{event.all_day ? 'Sepanjang hari' : `${event.time_label} WIB`}</span>
            <span className={cn('badge', event.visibility === 'team' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800')}>
              {event.visibility === 'team' ? 'Khusus tim proyek' : 'Seluruh entitas'}
            </span>
          </div>
          <p className="flex items-center gap-2 text-muted"><Users className="h-3.5 w-3.5" /> {event.project_title ?? 'Agenda entitas'}</p>
          <p className="flex items-center gap-2 text-muted"><Clock className="h-3.5 w-3.5" /> {event.all_day ? 'Sepanjang hari' : `${event.time_label} WIB`} · {formatDate(event.date, 'long')}</p>
          {event.location && <p className="flex items-center gap-2 text-muted"><MapPin className="h-3.5 w-3.5" /> {event.location}</p>}
          {event.description && <p className="rounded-xl bg-canvas/60 px-3 py-2 leading-relaxed text-ink">{event.description}</p>}
          <p className="text-[10px] text-muted">Dibuat oleh {event.creator_name ?? '—'}</p>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Hapus agenda?"
        description="Peserta akan menerima notifikasi pembatalan."
        danger
        confirmLabel="Hapus agenda"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.del(`/api/events/${event.id}`).catch((e) => toast(e.message, 'error'))
          toast('Agenda dihapus.')
          setConfirmDelete(false)
          onDeleted()
        }}
      />
    </>
  )
}

function CategoriesModal({
  entity, categories, onClose, onChanged,
}: { entity: string; categories: EventCategory[]; onClose: () => void; onChanged: () => void }) {
  const { toast } = useApp()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#245A46')
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.post('/api/event-categories', { name, color })
      setName('')
      toast('Kategori ditambahkan.')
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menambah kategori', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Kategori agenda"
      description="Warna kategori membantu membedakan jenis kegiatan pada kalender."
      footer={<div className="flex justify-end"><button className="btn-secondary" onClick={onClose}>Tutup</button></div>}
    >
      <div className="space-y-2">
        {categories.map((category) => (
          <div key={category.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
            <input
              className="flex-1 border-0 bg-transparent text-sm text-ink focus:outline-none"
              defaultValue={category.name}
              onBlur={async (e) => {
                if (e.target.value === category.name) return
                await api.patch(`/api/event-categories/${category.id}`, { name: e.target.value, color: category.color }).catch((err) => toast(err.message, 'error'))
                onChanged()
              }}
            />
            <input type="color" value={category.color} onChange={async (e) => {
              await api.patch(`/api/event-categories/${category.id}`, { name: category.name, color: e.target.value }).catch((err) => toast(err.message, 'error'))
              onChanged()
            }} className="h-6 w-8 rounded border border-line" />
            <button
              className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
              onClick={async () => {
                await api.del(`/api/event-categories/${category.id}`).catch((err) => toast(err.message, 'error'))
                toast('Kategori dihapus.')
                onChanged()
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2 rounded-xl border border-line bg-canvas/50 p-3">
        <input className="input" placeholder="Nama kategori baru" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-12 rounded-lg border border-line" />
        <button className="btn-primary" onClick={add} disabled={busy || !name.trim()}>{busy ? <Spinner /> : <Plus className="h-4 w-4" />}</button>
      </div>
      <p className="mt-2 text-[10px] text-muted">Entitas: {entity} · kategori hanya berlaku pada entitas ini.</p>
    </Modal>
  )
}
