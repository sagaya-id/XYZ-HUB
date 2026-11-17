import { useMemo, useState } from 'react'
import {
  CalendarDays, Camera, Download, Images, Plus, Trash2,
} from 'lucide-react'
import { api, uploadFile } from '../lib/api'
import { useApp, useAsync } from '../lib/app-context'
import type { GalleryPhoto, ProjectSummary } from '../lib/types'
import { Avatar, ConfirmDialog, EmptyState, LoadingBlock, Modal, Spinner, cn } from './ui'
import { TZ, formatDateTime, todayIso } from '../lib/format'

const MAX_PER_UPLOAD = 20

function dateLabel(iso: string) {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00+07:00`)
  if (Number.isNaN(date.getTime())) return iso
  // "Rabu, 11 November 2026"
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ,
  }).format(date)
}

type PendingPhoto = { key: string; file: File; url: string }

export function ProjectGallery({ project }: { project: ProjectSummary }) {
  const { toast } = useApp()
  const { data, loading, reload } = useAsync<{ photos: GalleryPhoto[]; can_contribute: boolean }>(
    () => api.get(`/api/projects/${project.id}/gallery`),
    [project.id],
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [date, setDate] = useState(todayIso())
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [viewing, setViewing] = useState<GalleryPhoto | null>(null)
  const [deleting, setDeleting] = useState<GalleryPhoto | null>(null)
  const [removing, setRemoving] = useState(false)

  const photos = data?.photos ?? []
  const canContribute = data?.can_contribute ?? false

  const groups = useMemo(() => {
    const map = new Map<string, GalleryPhoto[]>()
    for (const photo of photos) {
      const key = photo.photo_date.slice(0, 10)
      const bucket = map.get(key)
      if (bucket) bucket.push(photo)
      else map.set(key, [photo])
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [photos])

  function openModal() {
    setDate(todayIso())
    setPending([])
    setModalOpen(true)
  }

  function closeModal() {
    pending.forEach((item) => URL.revokeObjectURL(item.url))
    setPending([])
    setDragActive(false)
    setModalOpen(false)
  }

  function addFiles(files: FileList | File[] | null) {
    if (!files) return
    const incoming = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!incoming.length) {
      toast('Pilih berkas gambar (JPG, PNG, atau WebP).', 'error')
      return
    }
    const room = MAX_PER_UPLOAD - pending.length
    if (room <= 0) {
      toast(`Maksimum ${MAX_PER_UPLOAD} foto per unggahan.`, 'error')
      return
    }
    const accepted = incoming.slice(0, room)
    setPending((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url: URL.createObjectURL(file),
      })),
    ])
    if (accepted.length < incoming.length) {
      toast(`Hanya ${accepted.length} foto pertama yang ditambahkan (maks. ${MAX_PER_UPLOAD}).`, 'error')
    }
  }

  function removePending(key: string) {
    setPending((prev) => {
      const target = prev.find((item) => item.key === key)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((item) => item.key !== key)
    })
  }

  async function save() {
    if (!pending.length) {
      toast('Pilih minimal satu foto terlebih dahulu.', 'error')
      return
    }
    if (!date) {
      toast('Tanggal kegiatan wajib diisi.', 'error')
      return
    }
    setBusy(true)
    try {
      const fileIds: string[] = []
      for (const item of pending) {
        const uploaded = await uploadFile(item.file, { projectId: project.id })
        fileIds.push(uploaded.id)
      }
      await api.post(`/api/projects/${project.id}/gallery`, { date, fileIds })
      toast(`${fileIds.length} foto ditambahkan ke ${dateLabel(date)}.`)
      pending.forEach((item) => URL.revokeObjectURL(item.url))
      setPending([])
      setModalOpen(false)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan foto ke galeri.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setRemoving(true)
    try {
      await api.del(`/api/gallery/${deleting.id}`)
      toast('Foto dihapus dari galeri.')
      setDeleting(null)
      setViewing(null)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus foto.', 'error')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="section-title">Galeri foto lapangan</h2>
          <p className="muted mt-0.5">Foto dikelompokkan otomatis menurut tanggal kegiatan — terbaru di atas.</p>
        </div>
        {canContribute && (
          <button className="btn-primary btn-sm shrink-0 self-start sm:self-auto" onClick={openModal}>
            <Camera className="h-3.5 w-3.5" /> Tambah foto
          </button>
        )}
      </div>

      {loading ? (
        <LoadingBlock label="Memuat galeri foto…" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Images}
          title="Belum ada foto galeri"
          description="Dokumentasikan kegiatan proyek. Foto akan dikelompokkan otomatis berdasarkan tanggal kegiatan yang Anda pilih."
          action={canContribute ? <button className="btn-primary" onClick={openModal}><Camera className="h-4 w-4" /> Tambah foto</button> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(([groupDate, items]) => (
            <section key={groupDate} className="card overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-ink">{dateLabel(groupDate)}</h3>
                    <p className="text-[11px] text-muted">{items.length} foto kegiatan</p>
                  </div>
                </div>
              </header>
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4">
                {items.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setViewing(photo)}
                    className="group relative overflow-hidden rounded-xl border border-line bg-canvas"
                  >
                    <img
                      src={photo.url}
                      alt={`Foto ${dateLabel(photo.photo_date)}`}
                      loading="lazy"
                      className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    {photo.can_delete && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); setDeleting(photo) }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); setDeleting(photo) } }}
                        className="absolute top-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-red-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
                        aria-label="Hapus foto"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        size="md"
        title="Tambah foto galeri"
        description="Pilih tanggal kegiatan dan unggah satu atau beberapa foto."
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={closeModal} disabled={busy}>Batal</button>
            <button className="btn-primary" onClick={save} disabled={!pending.length || busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {busy ? 'Mengunggah…' : 'Unggah foto'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="galeri-date">
              Tanggal kegiatan <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                id="galeri-date"
                type="date"
                className="input rounded-full pl-10"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              Foto akan masuk ke bagian tanggal ini, bukan tanggal unggah.
            </p>
          </div>

          <div>
            <span className="label">Upload foto</span>
            <label
              onDragOver={(event) => { event.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragActive(false)
                addFiles(event.dataTransfer.files)
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed px-4 py-7 text-center transition-colors',
                dragActive ? 'border-forest bg-forest-50/70' : 'border-line bg-canvas/40 hover:border-forest/40 hover:bg-forest-50/40',
              )}
            >
              <Camera className="h-5 w-5 text-forest" />
              <span className="text-xs font-medium text-ink">Pilih dari galeri atau kamera perangkat</span>
              <span className="text-[10px] text-muted">Bisa banyak foto sekaligus · JPG/PNG/WEBP maks. 10 MB per foto</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>

            {pending.length > 0 && (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {pending.map((item) => (
                    <div key={item.key} className="relative">
                      <img src={item.url} alt={item.file.name} className="aspect-square w-full rounded-xl border border-line object-cover" />
                      <button
                        type="button"
                        onClick={() => removePending(item.key)}
                        className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-red-600 shadow-sm"
                        aria-label="Hapus dari pilihan"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  {pending.length} foto dipilih · akan disimpan ke <strong className="text-ink">{dateLabel(date)}</strong>.
                </p>
              </>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="xl"
        title={viewing ? dateLabel(viewing.photo_date) : undefined}
        description={viewing?.uploader_name ? `Diunggah oleh ${viewing.uploader_name} · ${formatDateTime(viewing.created_at)}` : undefined}
        footer={
          viewing ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <Avatar name={viewing.uploader_name ?? '—'} url={viewing.uploader_avatar_url} size={24} />
                {viewing.uploader_name ?? 'Anggota'}
              </div>
              <div className="flex gap-2">
                {viewing.can_delete && (
                  <button className="btn-danger btn-sm" onClick={() => setDeleting(viewing)}>
                    <Trash2 className="h-3.5 w-3.5" /> Hapus
                  </button>
                )}
                <a className="btn-secondary btn-sm" href={viewing.url} download>
                  <Download className="h-3.5 w-3.5" /> Unduh
                </a>
              </div>
            </div>
          ) : undefined
        }
      >
        {viewing && (
          <img
            src={viewing.url}
            alt={`Foto ${dateLabel(viewing.photo_date)}`}
            className="mx-auto max-h-[62vh] w-auto rounded-xl object-contain"
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Hapus foto galeri?"
        description={
          deleting
            ? `Foto tanggal ${dateLabel(deleting.photo_date)} akan dihapus dari galeri proyek. Tindakan ini tidak dapat dibatalkan.`
            : undefined
        }
        danger
        confirmLabel="Hapus foto"
        busy={removing}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
