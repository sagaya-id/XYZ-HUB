import { useState } from 'react'
import { NotebookPen, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useApp, useAsync } from '../../lib/app-context'
import type { Note, ProjectDetail } from '../../lib/types'
import { Avatar, ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, Spinner, VisibilityBadge } from '../../components/ui'
import { formatDateTime } from '../../lib/format'

export function NotesTab({ project }: { project: ProjectDetail['project'] }) {
  const { toast } = useApp()
  const [editing, setEditing] = useState<Note | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const { data, loading, reload } = useAsync<{ notes: Note[]; can_contribute: boolean }>(
    () => api.get(`/api/projects/${project.id}/notes`),
    [project.id],
  )

  if (loading) return <LoadingBlock label="Memuat catatan…" />
  const notes = data?.notes ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="section-title">Catatan proyek</h2>
          <p className="muted mt-0.5">Dokumentasi keputusan, panduan, dan hasil rapat.</p>
        </div>
        {data?.can_contribute && (
          <button className="btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Catatan baru
          </button>
        )}
      </div>

      {notes.length === 0 ? (
        <EmptyState icon={NotebookPen} title="Belum ada catatan" description="Tulis catatan pertama untuk menyimpan konteks penting proyek." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {notes.map((note) => (
            <article key={note.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{note.title}</h3>
                <VisibilityBadge visibility={note.visibility} />
              </div>
              <p className="mt-2 line-clamp-4 text-xs leading-relaxed whitespace-pre-wrap text-muted">{note.body}</p>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <span className="flex items-center gap-2">
                  <Avatar name={note.author_name} url={note.author_avatar_url} size={22} />
                  <span className="text-[10px] text-muted">{note.author_name} · {formatDateTime(note.updated_at)}</span>
                </span>
                {data?.can_contribute && (
                  <span className="flex gap-1">
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(note)}>Ubah</button>
                    <button className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting(note)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <NoteModal
          projectId={project.id}
          note={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); reload() }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Hapus catatan?"
        description={deleting?.title}
        danger
        confirmLabel="Hapus"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await api.del(`/api/notes/${deleting.id}`).catch((e) => toast(e.message, 'error'))
          toast('Catatan dihapus.')
          setDeleting(null)
          reload()
        }}
      />
    </div>
  )
}

function NoteModal({
  projectId, note, onClose, onSaved,
}: { projectId: string; note: Note | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const [form, setForm] = useState({ title: note?.title ?? '', body: note?.body ?? '', visibility: note?.visibility ?? 'team' })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      if (note) await api.patch(`/api/notes/${note.id}`, form)
      else await api.post(`/api/projects/${projectId}/notes`, form)
      toast(note ? 'Catatan diperbarui.' : 'Catatan dibuat.')
      onSaved()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan catatan', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={note ? 'Ubah catatan' : 'Catatan baru'}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy || !form.title.trim()}>
            {busy && <Spinner />} Simpan
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Judul" required>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
        </Field>
        <Field label="Isi catatan">
          <textarea className="input min-h-[220px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        <Field label="Visibilitas">
          <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as any })}>
            <option value="team">Khusus tim proyek</option>
            <option value="entity">Seluruh entitas</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}
