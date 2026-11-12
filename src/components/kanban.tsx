import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  CalendarClock, CheckSquare, GripVertical, MessageSquare, Paperclip, Plus, Settings2,
  Trash2, X,
} from 'lucide-react'
import { api, uploadFile } from '../lib/api'
import type { Column, Task } from '../lib/types'
import { formatDate, priorityTone, relativeTime } from '../lib/format'
import {
  Avatar, ConfirmDialog, Field, LoadingBlock, Modal, Spinner, cn,
} from './ui'
import { useApp } from '../lib/app-context'

type BoardResponse = { columns: Column[]; can_edit: boolean; done_column_ids: string[] }

type DragState = { task: Task; fromColumn: string; x: number; y: number } | null

export function KanbanBoard({
  projectId, currentUserId, canEdit,
}: { projectId: string; currentUserId: string; canEdit: boolean }) {
  const { toast } = useApp()
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [drag, setDrag] = useState<DragState>(null)
  const dragRef = useRef<DragState>(null)
  const pendingRef = useRef<any>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [addTaskColumn, setAddTaskColumn] = useState<string | null>(null)
  const [columnModal, setColumnModal] = useState<{ mode: 'create' | 'edit'; column?: Column } | null>(null)
  const [deleteColumn, setDeleteColumn] = useState<Column | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get<BoardResponse>(`/api/projects/${projectId}/board`)
      setBoard(data)
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memuat papan', 'error')
    } finally {
      setLoading(false)
    }
  }, [projectId, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    dragRef.current = drag
  }, [drag])

  const columns = board?.columns ?? []
  const editable = canEdit && (board?.can_edit ?? false)

  const finishDrag = useCallback(async (x: number, y: number) => {
    const state = dragRef.current
    setDrag(null)
    dragRef.current = null
    if (!state) return
    const ghost = document.getElementById('kanban-ghost')
    if (ghost) ghost.style.display = 'none'
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const columnEl = el?.closest('[data-column-id]') as HTMLElement | null
    if (!columnEl) return
    const columnId = columnEl.dataset.columnId!
    let beforeTaskId: string | null = null
    if (el) {
      const cardEl = el.closest('[data-task-id]') as HTMLElement | null
      if (cardEl && cardEl.dataset.taskId !== state.task.id) {
        const cards = Array.from(columnEl.querySelectorAll('[data-task-id]')) as HTMLElement[]
        const rect = cardEl.getBoundingClientRect()
        const after = y > rect.top + rect.height / 2
        const index = cards.indexOf(cardEl)
        beforeTaskId = after ? cards[index + 1]?.dataset.taskId ?? null : cardEl.dataset.taskId ?? null
      }
    }
    try {
      const res = await api.post<{ board: BoardResponse }>(`/api/tasks/${state.task.id}/move`, {
        boardId: columnId,
        beforeTaskId,
      })
      setBoard(res.board)
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memindahkan tugas', 'error')
    }
  }, [toast])

  // Pointer-based drag & drop (works with mouse, pen and long-press touch).
  const startDrag = useCallback((event: ReactPointerEvent, task: Task, columnId: string) => {
    if (!editable || event.button === 2) return
    const startX = event.clientX
    const startY = event.clientY
    const pointerId = event.pointerId
    const isTouch = event.pointerType === 'touch'
    let activated = false
    let longPress = false
    const target = event.currentTarget as HTMLElement

    const activate = (x: number, y: number) => {
      activated = true
      const state = { task, fromColumn: columnId, x, y }
      dragRef.current = state
      setDrag(state)
      const ghost = document.getElementById('kanban-ghost')
      if (ghost) {
        ghost.style.display = 'flex'
        ghost.style.left = `${x + 12}px`
        ghost.style.top = `${y + 8}px`
      }
      if (navigator.vibrate) navigator.vibrate(12)
    }

    const timer = isTouch ? window.setTimeout(() => {
      longPress = true
      activate(startX, startY)
    }, 240) : null

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!activated) {
        if (Math.hypot(dx, dy) > 6) {
          if (isTouch && !longPress) { cleanup(); return }
          activate(ev.clientX, ev.clientY)
        }
        return
      }
      ev.preventDefault()
      const ghost = document.getElementById('kanban-ghost')
      if (ghost) {
        ghost.style.left = `${ev.clientX + 12}px`
        ghost.style.top = `${ev.clientY + 8}px`
      }
      dragRef.current = { task, fromColumn: columnId, x: ev.clientX, y: ev.clientY }
      setDrag({ task, fromColumn: columnId, x: ev.clientX, y: ev.clientY })
      highlightColumn(ev.clientX, ev.clientY)
    }

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      cleanup()
      if (activated) {
        finishDrag(ev.clientX, ev.clientY)
      } else {
        // A simple tap/click (not a drag) opens the task detail sheet.
        setDetailTaskId(task.id)
      }
    }

    const cancel = () => { cleanup(); setDrag(null); dragRef.current = null }

    function cleanup() {
      if (timer) clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      target.style.touchAction = ''
    }

    target.style.touchAction = isTouch ? 'pan-y' : ''
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    pendingRef.current = true
  }, [editable, finishDrag])

  function highlightColumn(x: number, y: number) {
    document.querySelectorAll('[data-column-id]').forEach((el) => el.classList.remove('ring-2', 'ring-forest/40'))
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const column = el?.closest('[data-column-id]')
    if (column) column.classList.add('ring-2', 'ring-forest/40')
  }

  if (loading) return <LoadingBlock label="Memuat papan kanban…" />

  return (
    <div>
      {editable && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Tarik kartu untuk memindahkan tahap. Di perangkat sentuh, tahan kartu ±0,25 detik lalu geser.
          </p>
          <button className="btn-secondary btn-sm shrink-0" onClick={() => setColumnModal({ mode: 'create' })}>
            <Plus className="h-3.5 w-3.5" /> Kolom
          </button>
        </div>
      )}

      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:snap-none sm:px-0">
        {columns.map((column) => (
          <div
            key={column.id}
            data-column-id={column.id}
            className="flex w-[276px] shrink-0 snap-start flex-col rounded-2xl border border-line bg-canvas/70 sm:w-[300px]"
          >
            <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="truncate text-sm font-semibold text-ink">{column.name}</h4>
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-muted">{column.tasks.length}</span>
                {column.is_done && <span className="badge bg-emerald-50 text-emerald-700">Selesai</span>}
              </div>
              {editable && (
                <button
                  onClick={() => setColumnModal({ mode: 'edit', column })}
                  className="rounded-lg p-1.5 text-muted hover:bg-white hover:text-ink"
                  aria-label="Pengaturan kolom"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2.5 pb-2">
              {column.tasks.map((task) => {
                const overdue = task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && !task.completed_at
                return (
                  <article
                    key={task.id}
                    data-task-id={task.id}
                    onPointerDown={(e) => startDrag(e, task, column.id)}
                    onDoubleClick={() => setDetailTaskId(task.id)}
                    className={cn(
                      'group relative cursor-grab touch-pan-y rounded-xl border border-line bg-white p-3 transition-shadow hover:shadow-[0_10px_24px_-16px_rgba(31,41,51,0.5)] active:cursor-grabbing',
                      drag?.task.id === task.id && 'opacity-40',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-line group-hover:text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug font-medium text-ink">{task.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={cn('badge', priorityTone(task.priority))}>{task.priority}</span>
                          {task.due_date && (
                            <span className={cn('inline-flex items-center gap-1 text-[10px]', overdue ? 'font-semibold text-red-600' : 'text-muted')}>
                              <CalendarClock className="h-3 w-3" />
                              {formatDate(task.due_date, 'short')}
                            </span>
                          )}
                          {task.checklist_total > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                              <CheckSquare className="h-3 w-3" />
                              <span className={task.checklist_done === task.checklist_total ? 'font-semibold text-forest' : ''}>
                                {task.checklist_done}/{task.checklist_total}
                              </span>
                            </span>
                          )}
                          {task.comment_count > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                              <MessageSquare className="h-3 w-3" /> {task.comment_count}
                            </span>
                          )}
                          {task.attachment_count > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                              <Paperclip className="h-3 w-3" /> {task.attachment_count}
                            </span>
                          )}
                        </div>
                        {task.checklist_total > 0 && (
                          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full rounded-full bg-forest"
                              style={{ width: `${(task.checklist_done / task.checklist_total) * 100}%` }}
                            />
                          </div>
                        )}
                      </div>
                      {task.assignee_name && (
                        <Avatar name={task.assignee_name} url={task.assignee_avatar_url} size={24} className="shrink-0" />
                      )}
                    </div>
                  </article>
                )
              })}
              {editable && (
                <button
                  onClick={() => setAddTaskColumn(column.id)}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2 text-xs font-medium text-muted transition-colors hover:border-forest/30 hover:bg-white hover:text-forest"
                >
                  <Plus className="h-3.5 w-3.5" /> Tambah tugas
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Drag ghost */}
      <div
        id="kanban-ghost"
        className="pointer-events-none fixed z-[2000] hidden max-w-[260px] items-center gap-2 rounded-xl border border-forest/30 bg-white px-3 py-2 text-[13px] font-medium text-ink shadow-[0_24px_48px_-24px_rgba(31,41,51,0.6)]"
        style={{ display: 'none' }}
      >
        {drag ? drag.task.title : ''}
      </div>

      {addTaskColumn && (
        <TaskFormModal
          projectId={projectId}
          boardId={addTaskColumn}
          columns={columns}
          onClose={() => setAddTaskColumn(null)}
          onSaved={() => { setAddTaskColumn(null); load() }}
        />
      )}

      {detailTaskId && (
        <TaskDetail
          taskId={detailTaskId}
          columns={columns}
          currentUserId={currentUserId}
          editable={editable}
          onClose={() => setDetailTaskId(null)}
          onChanged={load}
        />
      )}

      {columnModal && (
        <ColumnModal
          projectId={projectId}
          column={columnModal.column}
          onClose={() => setColumnModal(null)}
          onSaved={() => { setColumnModal(null); load() }}
        />
      )}

      <ConfirmDialog
        open={!!deleteColumn}
        title="Hapus kolom?"
        description={
          deleteColumn
            ? `Kolom "${deleteColumn.name}" akan dihapus. ${deleteColumn.tasks.length} tugas di dalamnya dipindahkan ke kolom pertama.`
            : ''
        }
        confirmLabel="Hapus kolom"
        danger
        onCancel={() => setDeleteColumn(null)}
        onConfirm={async () => {
          if (!deleteColumn) return
          try {
            await api.del(`/api/columns/${deleteColumn.id}`)
            toast('Kolom dihapus.')
            setDeleteColumn(null)
            load()
          } catch (err: any) {
            toast(err?.message ?? 'Gagal menghapus kolom', 'error')
          }
        }}
      />
    </div>
  )
}

function ColumnModal({
  projectId, column, onClose, onSaved,
}: { projectId: string; column?: Column; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const [name, setName] = useState(column?.name ?? '')
  const [isDone, setIsDone] = useState(!!column?.is_done)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function save() {
    setBusy(true)
    try {
      if (column) {
        await api.patch(`/api/columns/${column.id}`, { name, isDone })
        toast('Kolom diperbarui.')
      } else {
        await api.post(`/api/projects/${projectId}/columns`, { name })
        toast('Kolom ditambahkan.')
      }
      onSaved()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan kolom', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="sm"
        title={column ? 'Pengaturan kolom' : 'Kolom baru'}
        footer={
          <div className="flex items-center justify-between gap-2">
            {column ? (
              <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Hapus
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={onClose}>Batal</button>
              <button className="btn-primary" onClick={save} disabled={busy || !name.trim()}>
                {busy && <Spinner />} Simpan
              </button>
            </div>
          </div>
        }
      >
        <Field label="Nama kolom" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Contoh: Menunggu review" />
        </Field>
        <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-canvas/60 p-3 text-sm">
          <input type="checkbox" className="mt-0.5" checked={isDone} onChange={(e) => setIsDone(e.target.checked)} />
          <span>
            <span className="block font-medium text-ink">Tandai sebagai kolom selesai</span>
            <span className="block text-xs text-muted">Tugas di kolom ini dihitung selesai pada progres proyek.</span>
          </span>
        </label>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Hapus kolom ini?"
        description="Tugas di dalamnya tidak dihapus, tetapi dipindahkan ke kolom pertama."
        danger
        confirmLabel="Hapus"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!column) return
          try {
            await api.del(`/api/columns/${column.id}`)
            toast('Kolom dihapus.')
            onSaved()
          } catch (err: any) {
            toast(err?.message ?? 'Gagal menghapus kolom', 'error')
          }
        }}
      />
    </>
  )
}

export function TaskFormModal({
  projectId, boardId, columns, onClose, onSaved,
}: {
  projectId: string
  boardId: string
  columns: Column[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useApp()
  const [form, setForm] = useState({ title: '', description: '', priority: 'normal', dueDate: '', assigneeId: '' })
  const [busy, setBusy] = useState(false)
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    api.get<{ members: any[] }>(`/api/projects/${projectId}`)
      .then((data) => setMembers(data.members.map((m: any) => ({ id: m.id, name: m.name }))))
      .catch(() => null)
  }, [projectId])

  async function submit() {
    if (!form.title.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/projects/${projectId}/tasks`, {
        ...form,
        boardId,
        dueDate: form.dueDate || null,
        assigneeId: form.assigneeId || null,
      })
      toast('Tugas ditambahkan.')
      onSaved()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menambah tugas', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Tugas baru"
      description={`Kolom: ${columns.find((c) => c.id === boardId)?.name ?? ''}`}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.title.trim()}>
            {busy && <Spinner />} Tambah tugas
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Judul tugas" required>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus placeholder="Apa yang perlu diselesaikan?" />
        </Field>
        <Field label="Deskripsi">
          <textarea className="input min-h-[80px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Detail, konteks, atau tautan…" />
        </Field>
        <div className="field-grid">
          <Field label="Prioritas">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="tinggi">Tinggi</option>
              <option value="normal">Normal</option>
              <option value="rendah">Rendah</option>
            </select>
          </Field>
          <Field label="Tenggat">
            <input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Ditugaskan kepada">
          <select className="input" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            <option value="">Belum ditugaskan</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

function TaskDetail({
  taskId, columns, editable, onClose, onChanged,
}: {
  taskId: string
  columns: Column[]
  currentUserId: string
  editable: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { toast } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', priority: 'normal', dueDate: '', assigneeId: '' })
  const [newCheck, setNewCheck] = useState('')
  const [comment, setComment] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get<any>(`/api/tasks/${taskId}`)
      setData(res)
      setForm({
        title: res.task.title,
        description: res.task.description ?? '',
        priority: res.task.priority,
        dueDate: res.task.due_date ?? '',
        assigneeId: res.task.assignee_id ?? '',
      })
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memuat tugas', 'error')
    } finally {
      setLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    try {
      await api.patch(`/api/tasks/${taskId}`, { ...form, dueDate: form.dueDate || null, assigneeId: form.assigneeId || null })
      toast('Tugas diperbarui.')
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function addCheck() {
    if (!newCheck.trim()) return
    await api.post(`/api/tasks/${taskId}/checklist`, { text: newCheck }).catch((e) => toast(e.message, 'error'))
    setNewCheck('')
    load()
    onChanged()
  }

  async function toggleCheck(item: any) {
    // Subtask completion never changes the parent card's column.
    await api.patch(`/api/checklist/${item.id}`, { isDone: !item.is_done }).catch((e) => toast(e.message, 'error'))
    load()
    onChanged()
  }

  async function addComment() {
    if (!comment.trim()) return
    await api.post(`/api/tasks/${taskId}/comments`, { body: comment }).catch((e) => toast(e.message, 'error'))
    setComment('')
    load()
    onChanged()
  }

  async function attach(file: File | null) {
    if (!file) return
    try {
      const uploaded = await uploadFile(file, { projectId: data?.task.project_id })
      await api.post(`/api/tasks/${taskId}/attachments`, { fileId: uploaded.id })
      toast('Lampiran ditambahkan.')
      load()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengunggah', 'error')
    }
  }

  async function moveTo(columnId: string) {
    await api.post(`/api/tasks/${taskId}/move`, { boardId: columnId, beforeTaskId: null }).catch((e) => toast(e.message, 'error'))
    toast('Tugas dipindahkan.')
    load()
    onChanged()
  }

  const done = data?.checklist?.filter((c: any) => c.is_done).length ?? 0
  const total = data?.checklist?.length ?? 0

  return (
    <>
      <Modal open onClose={onClose} size="lg" placement="right" title="Detail tugas">
        {loading ? <LoadingBlock /> : !data ? null : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <input
                  className="w-full border-0 bg-transparent p-0 text-lg font-semibold text-ink focus:outline-none"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  disabled={!editable}
                />
                <p className="mt-1 text-xs text-muted">Dibuat {relativeTime(data.task.created_at)}</p>
              </div>
              {editable && (
                <button className="btn-primary btn-sm" onClick={save} disabled={saving}>
                  {saving && <Spinner />} Simpan
                </button>
              )}
            </div>

            <div className="field-grid">
              <Field label="Prioritas">
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} disabled={!editable}>
                  <option value="tinggi">Tinggi</option>
                  <option value="normal">Normal</option>
                  <option value="rendah">Rendah</option>
                </select>
              </Field>
              <Field label="Tenggat">
                <input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} disabled={!editable} />
              </Field>
              <Field label="Penanggung jawab">
                <select className="input" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} disabled={!editable}>
                  <option value="">Belum ditugaskan</option>
                  {data.members.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
              <Field label="Pindahkan ke tahap">
                <select
                  className="input"
                  value={data.task.board_id}
                  onChange={(e) => moveTo(e.target.value)}
                  disabled={!editable}
                >
                  {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Deskripsi">
              <textarea
                className="input min-h-[90px]"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={!editable}
                placeholder="Belum ada deskripsi."
              />
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Checklist</p>
                <span className="text-xs text-muted">{done}/{total} selesai</span>
              </div>
              <div className="space-y-1.5">
                {data.checklist.map((item: any) => (
                  <div key={item.id} className="group flex items-center gap-2 rounded-lg border border-line px-2.5 py-2">
                    <input
                      type="checkbox"
                      checked={!!item.is_done}
                      onChange={() => toggleCheck(item)}
                      disabled={!editable}
                      className="h-4 w-4 rounded border-line accent-[#245A46]"
                    />
                    <span className={cn('flex-1 text-sm', item.is_done ? 'text-muted line-through' : 'text-ink')}>{item.text}</span>
                    {editable && (
                      <button
                        className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-red-600"
                        onClick={async () => {
                          await api.del(`/api/checklist/${item.id}`).catch((e) => toast(e.message, 'error'))
                          load()
                          onChanged()
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {total === 0 && <p className="text-xs text-muted">Belum ada subtugas.</p>}
              </div>
              {editable && (
                <div className="mt-2 flex gap-2">
                  <input
                    className="input"
                    value={newCheck}
                    onChange={(e) => setNewCheck(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addCheck() }}
                    placeholder="Tambah subtugas…"
                  />
                  <button className="btn-secondary" onClick={addCheck}><Plus className="h-4 w-4" /></button>
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Lampiran</p>
              <div className="space-y-1.5">
                {data.attachments.map((a: any) => (
                  <a key={a.id} href={`/api/files/${a.file_id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs text-ink hover:bg-canvas">
                    <Paperclip className="h-3.5 w-3.5 text-muted" />
                    <span className="flex-1 truncate">{a.file_name}</span>
                  </a>
                ))}
              </div>
              {editable && (
                <>
                  <button className="btn-secondary btn-sm mt-2" onClick={() => fileRef.current?.click()}>
                    <Paperclip className="h-3.5 w-3.5" /> Unggah lampiran
                  </button>
                  <input ref={fileRef} type="file" className="hidden" onChange={(e) => attach(e.target.files?.[0] ?? null)} />
                </>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Komentar</p>
              <div className="space-y-2">
                {data.comments.map((c: any) => (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar name={c.user_name} url={c.avatar_url} size={28} />
                    <div className="min-w-0 flex-1 rounded-xl bg-canvas px-3 py-2">
                      <p className="text-xs font-medium text-ink">{c.user_name} <span className="font-normal text-muted">· {relativeTime(c.created_at)}</span></p>
                      <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">{c.body}</p>
                    </div>
                  </div>
                ))}
                {data.comments.length === 0 && <p className="text-xs text-muted">Belum ada komentar.</p>}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  className="input"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addComment() }}
                  placeholder="Tulis komentar…"
                />
                <button className="btn-secondary" onClick={addComment}>Kirim</button>
              </div>
            </div>

            {editable && (
              <div className="border-t border-line pt-4">
                <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Hapus tugas
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Hapus tugas ini?"
        description="Checklist, komentar, dan lampiran terkait juga akan dihapus."
        danger
        confirmLabel="Hapus tugas"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.del(`/api/tasks/${taskId}`).catch((e) => toast(e.message, 'error'))
          toast('Tugas dihapus.')
          setConfirmDelete(false)
          onChanged()
          onClose()
        }}
      />
    </>
  )
}
