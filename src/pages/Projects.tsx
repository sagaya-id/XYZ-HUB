import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Archive, ArchiveRestore, Coins, FolderPlus, MapPin, MoreHorizontal,
  Search, Users,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useAsync, useDebounced } from '../lib/app-context'
import { compactRupiah, statusTone } from '../lib/format'
import {
  Avatar, ConfirmDialog, EmptyState, Field, ImageUpload, LoadingBlock, Modal, PageHeader,
  ProgressBar, SearchInput, Spinner, cn,
} from '../components/ui'
import type { ProjectSummary, User } from '../lib/types'

type ProjectsResponse = { projects: ProjectSummary[]; categories: string[]; entity: { name: string } }

export function ProjectsPage() {
  const { entity } = useParams<{ entity: string }>()
  const { me } = useApp()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 200)
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<ProjectSummary | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<ProjectSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)

  const query = new URLSearchParams()
  if (debounced) query.set('q', debounced)
  if (showArchived) query.set('archived', '1')
  const { data, loading, reload } = useAsync<ProjectsResponse>(
    () => api.get(`/api/projects?entity=${entity}&${query.toString()}`),
    [entity, debounced, showArchived],
  )

  const canCreate = me?.user.role === 'MA' || me?.user.role === 'SA'
  let projects = data?.projects ?? []
  if (status) projects = projects.filter((p) => p.status === status)
  if (category) projects = projects.filter((p) => p.category === category)

  return (
    <div>
      <PageHeader
        eyebrow={data?.entity.name ?? 'Katalog'}
        title="Katalog Proyek"
        description="Semua proyek yang dapat Anda akses pada entitas ini. Kartu diperbarui otomatis dari data proyek."
        actions={
          <>
            <button className={cn('chip', showArchived && 'chip-active')} onClick={() => setShowArchived((v) => !v)}>
              <Archive className="h-3.5 w-3.5" /> {showArchived ? 'Sembunyikan arsip' : 'Tampilkan arsip'}
            </button>
            {canCreate && (
              <button className="btn-primary" onClick={() => setCreateOpen(true)}>
                <FolderPlus className="h-4 w-4" /> Proyek baru
              </button>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Cari judul, kode, lokasi, atau PIC…" className="sm:max-w-xs" />
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          <button className={cn('chip shrink-0', !category && 'chip-active')} onClick={() => setCategory('')}>Semua kategori</button>
          {(data?.categories ?? []).map((c) => (
            <button key={c} className={cn('chip shrink-0', category === c && 'chip-active')} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
        <select className="input ml-auto w-full sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Semua status</option>
          {['Perencanaan', 'Berjalan', 'Selesai', 'Ditunda'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Tidak ada proyek yang cocok"
          description="Ubah filter atau buat proyek baru untuk mulai memantau kegiatan."
          action={canCreate ? <button className="btn-primary" onClick={() => setCreateOpen(true)}>Buat proyek</button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const tone = statusTone(project.status)
            return (
              <div key={project.id} className="card-lift group relative flex flex-col overflow-hidden">
                <Link to={`/app/${entity}/projects/${project.id}`} className="block">
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-canvas">
                    {project.cover_url ? (
                      <img src={project.cover_url} alt={project.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-xs text-muted">Tanpa sampul</div>
                    )}
                    <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
                      <span className={cn('badge backdrop-blur', tone.bg, tone.text)}>{project.status}</span>
                      <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-ink backdrop-blur">{project.code}</span>
                    </div>
                    {project.archived_at && (
                      <div className="absolute inset-0 grid place-items-center bg-ink/50">
                        <span className="badge bg-white text-ink"><Archive className="h-3 w-3" /> Diarsipkan</span>
                      </div>
                    )}
                  </div>
                </Link>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/app/${entity}/projects/${project.id}`} className="min-w-0">
                      <p className="text-[10px] font-semibold tracking-[0.1em] text-forest uppercase">{project.category}</p>
                      <h3 className="mt-1 line-clamp-2 text-[15px] leading-snug font-semibold text-ink">{project.title}</h3>
                    </Link>
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setMenuFor(menuFor?.id === project.id ? null : project)}
                        className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink"
                        aria-label="Menu proyek"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {menuFor?.id === project.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
                            <Link to={`/app/${entity}/projects/${project.id}?tab=settings`} onClick={() => setMenuFor(null)} className="block px-3.5 py-2 text-xs text-ink hover:bg-canvas">Pengaturan proyek</Link>
                            <button
                              onClick={() => { setArchiveTarget(project); setMenuFor(null) }}
                              className="flex w-full items-center gap-2 px-3.5 py-2 text-xs text-ink hover:bg-canvas"
                            >
                              {project.archived_at ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                              {project.archived_at ? 'Aktifkan kembali' : 'Arsipkan'}
                            </button>
                            {(me?.user.role === 'MA' || me?.user.role === 'SA') && (
                              <button
                                onClick={() => { setDeleteTarget(project); setMenuFor(null) }}
                                className="w-full px-3.5 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                              >
                                Hapus (soft delete)
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {project.location_text ?? 'Tanpa lokasi'}</span>
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {project.member_count}</span>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
                      <span>Progres</span>
                      <span className="font-semibold text-ink">{project.progress}%</span>
                    </div>
                    <ProgressBar value={project.progress} />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar name={project.pic_name ?? 'PIC'} url={project.pic_avatar_url} size={24} />
                      <span className="min-w-0">
                        <span className="block text-[10px] text-muted">PIC utama</span>
                        <span className="block truncate text-[11px] font-medium text-ink">{project.pic_name ?? 'Belum ditetapkan'}</span>
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="flex items-center justify-end gap-1 text-[10px] text-muted"><Coins className="h-3 w-3" /> Anggaran</span>
                      <span className="block text-[11px] font-semibold text-ink">
                        {project.budget_amount ? compactRupiah(project.budget_amount) : '—'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {createOpen && (
        <CreateProjectModal
          entity={entity!}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); reload() }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        title={archiveTarget?.archived_at ? 'Aktifkan kembali proyek?' : 'Arsipkan proyek?'}
        description={
          archiveTarget?.archived_at
            ? `${archiveTarget?.title} akan kembali muncul sebagai proyek aktif.`
            : `${archiveTarget?.title} akan disembunyikan dari daftar aktif. Seluruh data tetap tersimpan dan dapat dipulihkan.`
        }
        confirmLabel={archiveTarget?.archived_at ? 'Aktifkan' : 'Arsipkan'}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={async () => {
          if (!archiveTarget) return
          await api.post(`/api/projects/${archiveTarget.id}/archive`, { archived: !archiveTarget.archived_at })
          setArchiveTarget(null)
          reload()
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus proyek?"
        description={`${deleteTarget?.title} akan ditandai terhapus (soft delete). Data historis tetap tersimpan di basis data, namun proyek tidak lagi tampil.`}
        danger
        confirmLabel="Hapus proyek"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return
          await api.del(`/api/projects/${deleteTarget.id}`)
          setDeleteTarget(null)
          reload()
        }}
      />
    </div>
  )
}

function CreateProjectModal({ entity, onClose, onCreated }: { entity: string; onClose: () => void; onCreated: () => void }) {
  const { toast, boot } = useApp()
  const [form, setForm] = useState({
    title: '', code: '', category: '', description: '', locationText: '',
    status: 'Perencanaan', visibility: 'team', startDate: '', endDate: '',
    entityId: boot?.entities.find((e) => e.key === entity)?.id ?? '',
  })
  const [cover, setCover] = useState<string | null>(null)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [paIds, setPaIds] = useState<string[]>([])
  const [primaryPicId, setPrimaryPicId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: usersData } = useAsync<{ users: User[] }>(() => api.get('/api/admin/users?role=PA'), [])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/projects', {
        ...form, coverId: cover, paIds,
        primaryPicId: primaryPicId || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
      })
      toast('Proyek berhasil dibuat.')
      onCreated()
    } catch (err: any) {
      setError(err?.message ?? 'Gagal membuat proyek.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Proyek baru"
      description="Proyek akan langsung muncul di katalog dan dropdown penugasan."
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.title.trim() || !form.code.trim()}>
            {busy && <Spinner />} Simpan proyek
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="field-grid">
          <Field label="Judul proyek" required>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Contoh: Sekolah Binaan Ceria" />
          </Field>
          <Field label="Kode proyek" required hint="Harus unik dalam entitas.">
            <input className="input uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="YYS-005" />
          </Field>
          <Field label="Kategori">
            <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Pendidikan / Lingkungan / Operasional" list="category-list" />
            <datalist id="category-list">
              <option value="Pendidikan" /><option value="Lingkungan" /><option value="Sosial Ekonomi" />
              <option value="Infrastruktur" /><option value="Operasional" /><option value="Pemasaran" /><option value="Logistik" />
            </datalist>
          </Field>
          <Field label="Lokasi">
            <input className="input" value={form.locationText} onChange={(e) => setForm({ ...form, locationText: e.target.value })} placeholder="Kota / kabupaten, provinsi" />
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['Perencanaan', 'Berjalan', 'Selesai', 'Ditunda'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Visibilitas">
            <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              <option value="team">Khusus tim proyek</option>
              <option value="entity">Seluruh entitas</option>
            </select>
          </Field>
          <Field label="Tanggal mulai">
            <input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="Tanggal selesai">
            <input type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Deskripsi">
          <textarea className="input min-h-[80px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <ImageUpload
          label="Sampul proyek"
          value={coverUrl}
          onChange={(id, url) => { setCover(id); setCoverUrl(url) }}
          entityId={form.entityId}
          hint="Disarankan rasio 16:9, maks. 10 MB"
        />
        <div className="rounded-xl border border-line bg-canvas/50 p-3">
          <p className="mb-2 text-xs font-semibold text-ink">Tim proyek (opsional)</p>
          <div className="max-h-40 space-y-1.5 overflow-y-auto">
            {(usersData?.users ?? []).map((user) => (
              <label key={user.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={paIds.includes(user.id)}
                  onChange={(e) => setPaIds(e.target.checked ? [...paIds, user.id] : paIds.filter((id) => id !== user.id))}
                />
                <Avatar name={user.name} url={user.avatar_url} size={22} />
                <span className="min-w-0 flex-1 truncate text-ink">{user.name}</span>
                <span className="text-[10px] text-muted">{user.job_title ?? 'PA'}</span>
              </label>
            ))}
            {(usersData?.users ?? []).length === 0 && <p className="text-[11px] text-muted">Belum ada pengguna dengan peran Project Admin.</p>}
          </div>
          <Field label="PIC utama" className="mt-3">
            <select className="input" value={primaryPicId} onChange={(e) => setPrimaryPicId(e.target.value)}>
              <option value="">Tetapkan nanti</option>
              {(usersData?.users ?? []).filter((u) => paIds.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
