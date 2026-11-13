import {
  useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  CalendarClock, Check, CheckSquare, Download, GripVertical, MessageSquare, Paperclip, Plus,
  Settings2, Trash2, X,
} from 'lucide-react'
import { api, uploadFile } from '../lib/api'
import type { Column, Task } from '../lib/types'
import { formatDate, PRIORITY_OPTIONS, priorityTone, relativeTime } from '../lib/format'
import {
  Avatar, ConfirmDialog, Field, LoadingBlock, Modal, Spinner, cn,
} from './ui'
import { useApp } from '../lib/app-context'

type BoardResponse = { columns: Column[]; can_edit: boolean; done_column_ids: string[] }

const DRAG_THRESHOLD = 6
const TOUCH_HOLD_MS = 240

/** Immutable board transform used for the optimistic drag result. */
function moveTaskInBoard(
  board: BoardResponse,
  taskId: string,
  targetColumnId: string,
  beforeTaskId: string | null,
): BoardResponse | null {
  const columns = board.columns.map((column) => ({ ...column, tasks: [...column.tasks] }))
  const source = columns.find((column) => column.tasks.some((task) => task.id === taskId))
  if (!source) return null
  const taskIndex = source.tasks.findIndex((task) => task.id === taskId)
  const [task] = source.tasks.splice(taskIndex, 1)
  const target = columns.find((column) => column.id === targetColumnId)
  if (!target) return null
  const insertAt = beforeTaskId ? target.tasks.findIndex((item) => item.id === beforeTaskId) : -1
  const moved: Task = {
    ...task,
    board_id: targetColumnId,
    completed_at: target.is_done ? task.completed_at ?? new Date().toISOString() : null,
  }
  if (insertAt === -1) target.tasks.push(moved)
  else target.tasks.splice(insertAt, 0, moved)
  return { ...board, columns }
}

export function KanbanBoard({
  projectId, currentUserId, canEdit,
}: { projectId: string; currentUserId: string; canEdit: boolean }) {
  const { toast } = useApp()
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const boardRef = useRef<BoardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [addTaskColumn, setAddTaskColumn] = useState<string | null>(null)
  const [columnModal, setColumnModal] = useState<{ mode: 'create' | 'edit'; column?: Column } | null>(null)
  const moveSeq = useRef(0)
  const ghostRef = useRef<HTMLDivElement>(null)
  const endDragRef = useRef<(() => void) | null>(null)

  useEffect(() => { boardRef.current = board }, [board])

  const load = useCallback(async () => {
    try {
      const data = await api.get<BoardResponse>(`/api/projects/${projectId}/board`)
      setBoard(data)
      boardRef.current = data
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memuat papan', 'error')
    } finally {
      setLoading(false)
    }
  }, [projectId, toast])

  useEffect(() => { load() }, [load])

  // Never leave a ghost card or pointer listeners behind when the board unmounts.
  useEffect(() => () => endDragRef.current?.(), [])

  const columns = board?.columns ?? []
  const editable = canEdit && (board?.can_edit ?? false)

  const paintDropTarget = useCallback((x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const activeColumn = el?.closest('[data-column-id]') as HTMLElement | null
    document.querySelectorAll('[data-column-id]').forEach((node) => {
      node.classList.remove('ring-2', 'ring-forest/40', 'ring-offset-2')
    })
    if (activeColumn) activeColumn.classList.add('ring-2', 'ring-forest/40')
  }, [])

  const startDrag = useCallback((event: ReactPointerEvent, task: Task, columnId: string) => {
    if (!editable || event.button === 2 || endDragRef.current) return
    const startX = event.clientX
    const startY = event.clientY
    const pointerId = event.pointerId
    const isTouch = event.pointerType === 'touch'
    const target = event.currentTarget as HTMLElement
    let activated = false
    let longPress = false
    let frame = 0
    let longPressTimer: number | null = null
    let lastX = startX
    let lastY = startY

    const ghost = ghostRef.current

    const removeListeners = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', cancel)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      target.style.touchAction = ''
      if (ghost) ghost.style.display = 'none'
    }

    const endDrag = () => {
      removeListeners()
      endDragRef.current = null
      setDraggingTaskId(null)
      document.querySelectorAll('[data-column-id]').forEach((node) => {
        node.classList.remove('ring-2', 'ring-forest/40', 'ring-offset-2')
      })
    }

    const activate = (x: number, y: number) => {
      if (activated) return
      activated = true
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
      target.style.touchAction = 'none'
      setDraggingTaskId(task.id)
      if (ghost) {
        ghost.textContent = task.title
        ghost.style.display = 'flex'
        ghost.style.left = `${x + 12}px`
        ghost.style.top = `${y + 8}px`
      }
      if (navigator.vibrate) navigator.vibrate(12)
    }

    if (isTouch) {
      longPressTimer = window.setTimeout(() => {
        longPress = true
        activate(startX, startY)
      }, TOUCH_HOLD_MS)
    }

    function schedule(x: number, y: number) {
      lastX = x
      lastY = y
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (ghost) {
          ghost.style.left = `${lastX + 12}px`
          ghost.style.top = `${lastY + 8}px`
        }
        paintDropTarget(lastX, lastY)
      })
    }

    function move(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!activated) {
        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return
        if (isTouch && !longPress) { endDrag(); return }
        activate(ev.clientX, ev.clientY)
        return
      }
      ev.preventDefault()
      schedule(ev.clientX, ev.clientY)
    }

    function dropPoint(x: number, y: number) {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const columnEl = el?.closest('[data-column-id]') as HTMLElement | null
      if (!columnEl) return null
      const columnId = columnEl.dataset.columnId!
      let beforeTaskId: string | null = null
      const cardEl = el?.closest('[data-task-id]') as HTMLElement | null
      if (cardEl && cardEl.dataset.taskId !== task.id) {
        const cards = Array.from(columnEl.querySelectorAll('[data-task-id]')) as HTMLElement[]
        const rect = cardEl.getBoundingClientRect()
        const after = y > rect.top + rect.height / 2
        const index = cards.indexOf(cardEl)
        beforeTaskId = after ? cards[index + 1]?.dataset.taskId ?? null : cardEl.dataset.taskId ?? null
      }
      return { columnId, beforeTaskId }
    }

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const wasActivated = activated
      endDrag()
      if (!wasActivated) {
        // A plain click/tap opens the detail drawer; no drag state is left behind.
        setDetailTaskId(task.id)
        return
      }
      const drop = dropPoint(ev.clientX, ev.clientY)
      if (!drop) return
      const snapshot = boardRef.current
      if (!snapshot) return
      const optimistic = moveTaskInBoard(snapshot, task.id, drop.columnId, drop.beforeTaskId)
      if (!optimistic) return
      // Snap into place immediately, persist in the background.
      setBoard(optimistic)
      boardRef.current = optimistic
      const token = ++moveSeq.current
      api
        .post<{ board: BoardResponse }>(`/api/tasks/${task.id}/move`, {
          boardId: drop.columnId,
          beforeTaskId: drop.beforeTaskId,
        })
        .then((res) => {
          // Keep the optimistic order unless a newer drag landed in the meantime.
          if (moveSeq.current === token) {
            const next = { ...res.board, can_edit: optimistic.can_edit }
            setBoard(next)
            boardRef.current = next
          }
        })
        .catch((err: any) => {
          setBoard(snapshot)
          boardRef.current = snapshot
          toast(err?.message ?? 'Gagal memindahkan tugas', 'error')
        })
    }

    function cancel() {
      const wasActivated = activated
      endDrag()
      if (wasActivated) toast('Pemindahan tugas dibatalkan.', 'info')
    }

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && activated) cancel()
    }

    endDragRef.current = endDrag
    target.style.touchAction = isTouch ? 'pan-y' : ''
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', cancel)
  }, [editable, paintDropTarget, toast])

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
            className="flex w-[276px] shrink-0 snap-start flex-col rounded-2xl border border-line bg-canvas/70 transition-shadow sm:w-[300px]"
          >
            <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="truncate text-sm font-semibold text-ink">{column.name}</h4>
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-muted">{column.tasks.length}</span>
                {column.is_done && <span className="badge bg-emerald-50 text-emerald-700">Selesai</span>}
              </div>
              {editable && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
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
                      'group relative cursor-grab touch-pan-y rounded-xl border border-line bg-white p-3 transition-[box-shadow,opacity,transform] hover:shadow-[0_10px_24px_-16px_rgba(31,41,51,0.5)] active:cursor-grabbing',
                      draggingTaskId === task.id && 'scale-[0.98] opacity-40',
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
                  onPointerDown={(e) => e.stopPropagation()}
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
        ref={ghostRef}
        className="pointer-events-none fixed z-[2000] hidden max-w-[260px] items-center gap-2 truncate rounded-xl border border-forest/30 bg-white px-3 py-2 text-[13px] font-medium text-ink shadow-[0_24px_48px_-24px_rgba(31,41,51,0.6)]"
        style={{ display: 'none' }}
      />

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
              {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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

type SaveState = 'idle' | 'saving' | 'saved'

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
  const { toast, me } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ title: '', description: '', priority: 'normal', dueDate: '', assigneeId: '' })
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [newCheck, setNewCheck] = useState('')
  const [comment, setComment] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef(form)
  useEffect(() => { formRef.current = form }, [form])

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

  /** Persists any subset of task fields; keeps the drawer responsive. */
  const persist = useCallback(async (patch: Partial<typeof form>, options: { silent?: boolean } = {}) => {
    const next = { ...formRef.current, ...patch }
    setForm(next)
    if (!editable) return
    if (!next.title.trim()) {
      toast('Judul tugas tidak boleh kosong.', 'error')
      load()
      return
    }
    setSaveState('saving')
    try {
      await api.patch(`/api/tasks/${taskId}`, {
        title: next.title,
        description: next.description,
        priority: next.priority,
        dueDate: next.dueDate || null,
        assigneeId: next.assigneeId || null,
      })
      setSaveState('saved')
      if (!options.silent) toast('Perubahan tugas disimpan.')
      onChanged()
      window.setTimeout(() => setSaveState('idle'), 1600)
    } catch (err: any) {
      setSaveState('idle')
      toast(err?.message ?? 'Gagal menyimpan', 'error')
      load()
    }
  }, [editable, load, onChanged, taskId, toast])

  async function addCheck() {
    if (!newCheck.trim()) return
    try {
      const res = await api.post<any>(`/api/tasks/${taskId}/checklist`, { text: newCheck.trim() })
      // Instant feedback before the reload resolves.
      setData((prev: any) => prev && ({
        ...prev,
        checklist: [...prev.checklist, { ...res.item, is_done: false }],
      }))
      setNewCheck('')
      await load()
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menambah item', 'error')
    }
  }

  async function toggleCheck(item: any) {
    const nextDone = !item.is_done
    // Checklist completion never moves the parent card between columns.
    setData((prev: any) => prev && ({
      ...prev,
      checklist: prev.checklist.map((row: any) => row.id === item.id ? { ...row, is_done: nextDone ? 1 : 0 } : row),
    }))
    try {
      await api.patch(`/api/checklist/${item.id}`, { isDone: nextDone })
      await load()
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memperbarui checklist', 'error')
      load()
    }
  }

  async function renameCheck(item: any, text: string) {
    const trimmed = text.trim()
    if (!trimmed || trimmed === item.text) return
    try {
      await api.patch(`/api/checklist/${item.id}`, { text: trimmed })
      setData((prev: any) => prev && ({
        ...prev,
        checklist: prev.checklist.map((row: any) => row.id === item.id ? { ...row, text: trimmed } : row),
      }))
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengubah item', 'error')
    }
  }

  async function removeCheck(item: any) {
    setData((prev: any) => prev && ({ ...prev, checklist: prev.checklist.filter((row: any) => row.id !== item.id) }))
    try {
      await api.del(`/api/checklist/${item.id}`)
      await load()
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus item', 'error')
      load()
    }
  }

  async function addComment() {
    const body = comment.trim()
    if (!body) return
    try {
      const res = await api.post<any>(`/api/tasks/${taskId}/comments`, { body })
      setData((prev: any) => prev && ({
        ...prev,
        comments: [
          { ...res.comment, user_name: me?.user.name ?? 'Anda', avatar_url: me?.user.avatar_url ?? null },
          ...prev.comments,
        ],
      }))
      setComment('')
      await load()
      onChanged()
      toast('Komentar dikirim.')
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengirim komentar', 'error')
    }
  }

  async function attach(files: FileList | null) {
    if (!files?.length || !data?.task) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadFile(file, { projectId: data.task.project_id })
        await api.post(`/api/tasks/${taskId}/attachments`, { fileId: uploaded.id })
      }
      toast(files.length > 1 ? `${files.length} lampiran ditambahkan.` : 'Lampiran ditambahkan.')
      await load()
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengunggah lampiran', 'error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeAttachment(attachment: any) {
    try {
      await api.del(`/api/attachments/${attachment.id}`)
      setData((prev: any) => prev && ({ ...prev, attachments: prev.attachments.filter((row: any) => row.id !== attachment.id) }))
      onChanged()
      toast('Lampiran dihapus.')
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus lampiran', 'error')
    }
  }

  async function moveTo(columnId: string) {
    try {
      await api.post(`/api/tasks/${taskId}/move`, { boardId: columnId, beforeTaskId: null })
      toast('Tugas dipindahkan.')
      await load()
      onChanged()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memindahkan tugas', 'error')
    }
  }

  const done = data?.checklist?.filter((c: any) => c.is_done).length ?? 0
  const total = data?.checklist?.length ?? 0

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        placement="right"
        title="Detail tugas"
        description={editable ? 'Semua kolom dapat langsung diubah dan tersimpan otomatis.' : 'Anda hanya dapat melihat tugas ini.'}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted">
              {saveState === 'saving' ? 'Menyimpan…' : saveState === 'saved' ? 'Tersimpan' : 'Perubahan tersimpan otomatis'}
            </span>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={onClose}>Tutup</button>
              {editable && (
                <button
                  className="btn-primary"
                  onClick={() => persist({ description: formRef.current.description, title: formRef.current.title })}
                  disabled={saveState === 'saving'}
                >
                  {saveState === 'saving' ? <Spinner /> : <Check className="h-4 w-4" />} Simpan Perubahan
                </button>
              )}
            </div>
          </div>
        }
      >
        {loading ? <LoadingBlock /> : !data ? null : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <input
                  className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold text-ink transition-colors hover:border-line focus:border-forest/40 focus:bg-white focus:outline-none disabled:hover:border-transparent"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  onBlur={() => { if (form.title.trim() && form.title !== data.task.title) persist({ title: form.title }) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                    if (e.key === 'Escape') setForm({ ...form, title: data.task.title })
                  }}
                  disabled={!editable}
                  aria-label="Judul tugas"
                />
                <p className="mt-1 px-1 text-xs text-muted">Dibuat {relativeTime(data.task.created_at)} · klik judul untuk mengubah</p>
              </div>
            </div>

            <div className="field-grid">
              <Field label="Prioritas">
                <select
                  className="input"
                  value={form.priority}
                  onChange={(e) => persist({ priority: e.target.value })}
                  disabled={!editable}
                >
                  {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </Field>
              <Field label="Tenggat waktu">
                <input
                  type="date"
                  className="input"
                  value={form.dueDate}
                  onChange={(e) => persist({ dueDate: e.target.value })}
                  disabled={!editable}
                />
              </Field>
              <Field label="Penanggung jawab">
                <select
                  className="input"
                  value={form.assigneeId}
                  onChange={(e) => persist({ assigneeId: e.target.value })}
                  disabled={!editable}
                >
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
                className="input min-h-[110px]"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                onBlur={() => { if (form.description !== (data.task.description ?? '')) persist({ description: form.description }, { silent: true }) }}
                disabled={!editable}
                placeholder="Tambahkan detail, konteks, atau tautan…"
              />
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Checklist</p>
                <span className={cn('text-xs', done === total && total > 0 ? 'font-semibold text-forest' : 'text-muted')}>{done}/{total} selesai</span>
              </div>
              <div className="space-y-1.5">
                {data.checklist.map((item: any) => (
                  <div key={item.id} className="group flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={!!item.is_done}
                      onChange={() => toggleCheck(item)}
                      disabled={!editable}
                      className="h-4 w-4 shrink-0 rounded border-line accent-[#245A46]"
                    />
                    <input
                      className={cn(
                        'min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-line focus:border-forest/40 focus:bg-white focus:outline-none disabled:hover:border-transparent',
                        item.is_done ? 'text-muted line-through' : 'text-ink',
                      )}
                      defaultValue={item.text}
                      key={`${item.id}-${item.text}`}
                      onBlur={(e) => renameCheck(item, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') { (e.target as HTMLInputElement).value = item.text; (e.target as HTMLInputElement).blur() }
                      }}
                      disabled={!editable}
                      aria-label="Teks checklist"
                    />
                    {editable && (
                      <button
                        className="rounded p-1 text-muted opacity-60 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                        onClick={() => removeCheck(item)}
                        aria-label="Hapus item checklist"
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
                    placeholder="+ Tambah item checklist"
                    aria-label="Tambah item checklist"
                  />
                  <button className="btn-secondary shrink-0" onClick={addCheck} disabled={!newCheck.trim()}>
                    <Plus className="h-4 w-4" /> Tambah
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Lampiran</p>
                <span className="text-xs text-muted">{data.attachments.length} berkas</span>
              </div>
              <div className="space-y-1.5">
                {data.attachments.map((a: any) => {
                  const isImage = String(a.mime ?? '').startsWith('image/')
                  return (
                    <div key={a.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs">
                      {isImage ? (
                        <img src={`/api/files/${a.file_id}`} alt="" className="h-8 w-8 shrink-0 rounded-md border border-line object-cover" />
                      ) : (
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" />
                      )}
                      <a
                        href={`/api/files/${a.file_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-ink hover:underline"
                      >
                        {a.file_name}
                      </a>
                      <a
                        href={`/api/files/${a.file_id}`}
                        download={a.file_name}
                        className="rounded p-1 text-muted hover:bg-canvas hover:text-forest"
                        aria-label="Unduh lampiran"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      {editable && (
                        <button
                          className="rounded p-1 text-muted hover:text-red-600"
                          onClick={() => removeAttachment(a)}
                          aria-label="Hapus lampiran"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
                {data.attachments.length === 0 && <p className="text-xs text-muted">Belum ada lampiran.</p>}
              </div>
              {editable && (
                <>
                  <button className="btn-secondary btn-sm mt-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? <Spinner /> : <Paperclip className="h-3.5 w-3.5" />} Unggah Lampiran
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.json"
                    className="hidden"
                    onChange={(e) => attach(e.target.files)}
                  />
                  <p className="mt-1 text-[10px] text-muted">Gambar, PDF, dokumen, atau spreadsheet maks. 10 MB per berkas.</p>
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
                      <p className="text-xs font-medium text-ink">
                        {c.user_name} <span className="font-normal text-muted">· {relativeTime(c.created_at)}</span>
                      </p>
                      <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">{c.body}</p>
                    </div>
                  </div>
                ))}
                {data.comments.length === 0 && <p className="text-xs text-muted">Belum ada komentar.</p>}
              </div>
              {editable && (
                <div className="mt-2 flex gap-2">
                  <input
                    className="input"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) addComment() }}
                    placeholder="Tulis komentar…"
                    aria-label="Tulis komentar"
                  />
                  <button className="btn-secondary shrink-0" onClick={addComment} disabled={!comment.trim()}>Kirim</button>
                </div>
              )}
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
