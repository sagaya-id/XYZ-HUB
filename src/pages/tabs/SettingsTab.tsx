import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, Crown, Plus, Save, ShieldAlert, Trash2, UserPlus, Users } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useApp } from '../../lib/app-context'
import type { Kpi, Member, ProjectDetail, User } from '../../lib/types'
import {
  Avatar, ConfirmDialog, Field, ImageUpload, Modal, Spinner, cn,
} from '../../components/ui'
import { formatDate } from '../../lib/format'

export function SettingsTab({
  detail, reload, entityKey,
}: { detail: ProjectDetail; reload: () => void; entityKey: string }) {
  const { project, members, kpis } = detail
  const navigate = useNavigate()
  const { toast, me } = useApp()
  const [form, setForm] = useState({
    title: project.title,
    code: project.code,
    category: project.category,
    description: project.description ?? '',
    locationText: project.location_text ?? '',
    status: project.status,
    visibility: project.visibility,
    startDate: project.start_date ?? '',
    endDate: project.end_date ?? '',
    progress: project.progress,
  })
  const [cover, setCover] = useState<string | null>(project.cover_id)
  const [coverUrl, setCoverUrl] = useState<string | null>(project.cover_url)
  const [saving, setSaving] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [removeMember, setRemoveMember] = useState<Member | null>(null)
  const [picTarget, setPicTarget] = useState<Member | null>(null)
  const [kpiDraft, setKpiDraft] = useState({ label: '', unit: '', target: '', current: '' })
  const [kpiSaving, setKpiSaving] = useState(false)

  const canManage = project.can_manage
  const isEntityAdmin = me?.user.role === 'MA' || me?.user.role === 'SA'

  async function saveProject() {
    setSaving(true)
    try {
      await api.patch(`/api/projects/${project.id}`, {
        ...form,
        coverId: cover,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        progress: Number(form.progress),
      })
      toast('Pengaturan proyek disimpan.')
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan proyek', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function setPrimaryPic(member: Member, confirmReplace = false) {
    try {
      await api.patch(`/api/projects/${project.id}/members/${member.membership_id}`, {
        isPrimaryPic: true,
        confirmReplace,
      })
      toast(`${member.name} ditetapkan sebagai PIC utama.`)
      setPicTarget(null)
      reload()
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'PIC_CONFIRM_REQUIRED') {
        setPicTarget(member)
      } else {
        toast(err?.message ?? 'Gagal menetapkan PIC', 'error')
      }
    }
  }

  async function changeAccess(member: Member, access: 'admin' | 'member') {
    try {
      await api.patch(`/api/projects/${project.id}/members/${member.membership_id}`, { access })
      toast('Hak akses diperbarui.')
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengubah akses', 'error')
    }
  }

  // Project Admins may only deactivate/reactivate members of this project.
  async function setMemberActive(member: Member, active: boolean) {
    try {
      await api.post(`/api/projects/${project.id}/members/${member.membership_id}/status`, { active })
      toast(active ? `${member.name} diaktifkan kembali.` : `${member.name} dinonaktifkan.`)
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengubah status anggota', 'error')
    }
  }

  async function addKpi() {
    if (!kpiDraft.label.trim()) return
    setKpiSaving(true)
    try {
      await api.post(`/api/projects/${project.id}/kpis`, {
        label: kpiDraft.label,
        unit: kpiDraft.unit || null,
        targetValue: Number(kpiDraft.target) || 0,
        currentValue: Number(kpiDraft.current) || 0,
      })
      setKpiDraft({ label: '', unit: '', target: '', current: '' })
      toast('Indikator ditambahkan.')
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menambah indikator', 'error')
    } finally {
      setKpiSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title">Informasi proyek</h2>
            <p className="muted mt-0.5">Perubahan nama dan kode langsung tercermin pada dropdown penugasan.</p>
          </div>
          {canManage && (
            <button className="btn-primary btn-sm" onClick={saveProject} disabled={saving}>
              {saving ? <Spinner /> : <Save className="h-3.5 w-3.5" />} Simpan
            </button>
          )}
        </div>
        <div className="field-grid">
          <Field label="Judul proyek">
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={!canManage} />
          </Field>
          <Field label="Kode">
            <input className="input uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!canManage} />
          </Field>
          <Field label="Kategori">
            <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} disabled={!canManage} />
          </Field>
          <Field label="Lokasi">
            <input className="input" value={form.locationText} onChange={(e) => setForm({ ...form, locationText: e.target.value })} disabled={!canManage} />
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} disabled={!canManage}>
              {['Perencanaan', 'Berjalan', 'Selesai', 'Ditunda'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Visibilitas proyek">
            <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as any })} disabled={!canManage}>
              <option value="team">Khusus tim proyek</option>
              <option value="entity">Seluruh entitas</option>
            </select>
          </Field>
          <Field label="Tanggal mulai">
            <input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} disabled={!canManage} />
          </Field>
          <Field label="Tanggal selesai">
            <input type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} disabled={!canManage} />
          </Field>
        </div>
        <Field label="Deskripsi" className="mt-4">
          <textarea className="input min-h-[80px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={!canManage} />
        </Field>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ImageUpload
            label="Sampul proyek"
            value={coverUrl}
            onChange={(id, url) => { setCover(id); setCoverUrl(url) }}
            projectId={project.id}
            hint="Disarankan rasio 16:9"
          />
          <Field label={`Progres manual (${form.progress}%)`} hint="Progres otomatis dihitung dari kolom kanban selesai bila tersedia.">
            <input type="range" min={0} max={100} value={form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} disabled={!canManage} className="mt-3 w-full accent-[#245A46]" />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="section-title">Indikator KPI</h2>
            <p className="muted mt-0.5">Dapat berbeda untuk setiap jenis proyek.</p>
          </div>
        </div>
        <div className="space-y-2">
          {kpis.map((kpi) => <KpiRow key={kpi.id} kpi={kpi} canManage={canManage} onSaved={reload} />)}
          {kpis.length === 0 && <p className="text-xs text-muted">Belum ada indikator.</p>}
        </div>
        {canManage && (
          <div className="mt-4 grid gap-2 rounded-xl border border-line bg-canvas/50 p-3 sm:grid-cols-5">
            <input className="input sm:col-span-2" placeholder="Nama indikator" value={kpiDraft.label} onChange={(e) => setKpiDraft({ ...kpiDraft, label: e.target.value })} />
            <input className="input" placeholder="Satuan" value={kpiDraft.unit} onChange={(e) => setKpiDraft({ ...kpiDraft, unit: e.target.value })} />
            <input className="input" placeholder="Target" inputMode="decimal" value={kpiDraft.target} onChange={(e) => setKpiDraft({ ...kpiDraft, target: e.target.value })} />
            <div className="flex gap-2">
              <input className="input" placeholder="Capaian" inputMode="decimal" value={kpiDraft.current} onChange={(e) => setKpiDraft({ ...kpiDraft, current: e.target.value })} />
              <button className="btn-secondary" onClick={addKpi} disabled={kpiSaving || !kpiDraft.label.trim()}>
                {kpiSaving ? <Spinner /> : <Plus className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title">Tim & keanggotaan</h2>
            <p className="muted mt-0.5">Satu PIC utama aktif per proyek. Pencabutan akses tidak menghapus riwayat kerja.</p>
          </div>
          {canManage && (
            <button className="btn-primary btn-sm" onClick={() => setAddMemberOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Anggota
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-canvas/60">
              <tr>
                {['Nama', 'Peran proyek', 'Hak akses', 'Bergabung', ''].map((header) => (
                  <th key={header} className="px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-muted uppercase">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-line">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={member.name} url={member.avatar_url} size={28} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-xs font-medium text-ink">
                          {member.name}
                          {member.is_active === 0 && <span className="badge bg-red-50 text-[9px] text-red-700">Nonaktif</span>}
                        </p>
                        <p className="truncate text-[10px] text-muted">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {member.is_primary_pic ? (
                      <span className="badge bg-forest-50 text-forest"><Crown className="h-3 w-3" /> PIC Utama</span>
                    ) : member.access === 'admin' ? (
                      <span className="badge bg-sky-50 text-sky-700">Project Admin</span>
                    ) : (
                      <span className="badge bg-canvas text-muted">Anggota tim</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {canManage ? (
                      <select
                        className="rounded-lg border border-line bg-white px-2 py-1 text-xs"
                        value={member.access}
                        onChange={(e) => changeAccess(member, e.target.value as 'admin' | 'member')}
                      >
                        <option value="admin">Kelola proyek</option>
                        <option value="member">Kontribusi saja</option>
                      </select>
                    ) : (
                      <span className="text-xs text-muted">{member.access === 'admin' ? 'Kelola proyek' : 'Kontribusi'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">{formatDate(member.joined_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {canManage && (
                      <div className="inline-flex items-center gap-1">
                        {member.id !== me?.user.id && !(member.role === 'MA' && me?.user.role !== 'MA') && (
                          <button
                            className={cn('btn-ghost btn-sm', member.is_active === 0 ? '!text-forest' : '!text-amber-700')}
                            onClick={() => setMemberActive(member, member.is_active === 0)}
                          >
                            {member.is_active === 0 ? 'Aktifkan' : 'Nonaktifkan'}
                          </button>
                        )}
                        {!member.is_primary_pic && (
                          <button className="btn-ghost btn-sm" onClick={() => setPrimaryPic(member)}>Jadikan PIC</button>
                        )}
                        <button className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600" onClick={() => setRemoveMember(member)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted">Belum ada anggota.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-center gap-2 text-[10px] text-muted">
          <Users className="h-3 w-3" /> Menghapus anggota hanya mencabut akses. Catatan, logbook, foto, dan riwayat tugas tetap tersimpan.
        </p>
        <p className="mt-1 text-[10px] text-muted">
          Project Admin dapat menonaktifkan atau mengaktifkan kembali anggota proyek ini. Penghapusan akun permanen hanya
          tersedia untuk Master Admin dan Super Admin.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="section-title">Zona pengelolaan</h2>
        <p className="muted mt-0.5">Tindakan berikut berdampak pada tampilan katalog proyek.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {canManage && (
            <button className="btn-secondary" onClick={() => setArchiveConfirm(true)}>
              <Archive className="h-4 w-4" /> {project.archived_at ? 'Aktifkan kembali' : 'Arsipkan proyek'}
            </button>
          )}
          {isEntityAdmin && (
            <button className="btn-danger" onClick={() => setDeleteConfirm(true)}>
              <ShieldAlert className="h-4 w-4" /> Hapus proyek (soft delete)
            </button>
          )}
        </div>
      </section>

      {addMemberOpen && (
        <AddMemberModal
          projectId={project.id}
          onClose={() => setAddMemberOpen(false)}
          onSaved={() => { setAddMemberOpen(false); reload() }}
        />
      )}

      <ConfirmDialog
        open={!!removeMember}
        title="Cabut akses anggota?"
        description={
          <span>
            <strong>{removeMember?.name}</strong> tidak lagi dapat mengakses proyek ini. Seluruh riwayat kerja
            (logbook, catatan, foto, tugas) tetap tersimpan dan tetap tercatat atas nama mereka.
          </span>
        }
        danger
        confirmLabel="Cabut akses"
        onCancel={() => setRemoveMember(null)}
        onConfirm={async () => {
          if (!removeMember) return
          await api.del(`/api/projects/${project.id}/members/${removeMember.membership_id}`).catch((e) => toast(e.message, 'error'))
          toast('Akses anggota dicabut.')
          setRemoveMember(null)
          reload()
        }}
      />

      <ConfirmDialog
        open={!!picTarget}
        title="Ganti PIC utama?"
        description={`PIC utama saat ini akan digantikan oleh ${picTarget?.name}. Hanya satu PIC utama aktif per proyek.`}
        confirmLabel="Ya, ganti PIC"
        onCancel={() => setPicTarget(null)}
        onConfirm={() => picTarget && setPrimaryPic(picTarget, true)}
      />

      <ConfirmDialog
        open={archiveConfirm}
        title={project.archived_at ? 'Aktifkan kembali proyek?' : 'Arsipkan proyek?'}
        description={project.archived_at ? 'Proyek akan kembali ke daftar aktif.' : 'Proyek akan dipindahkan ke arsip. Data tetap utuh.'}
        confirmLabel={project.archived_at ? 'Aktifkan' : 'Arsipkan'}
        onCancel={() => setArchiveConfirm(false)}
        onConfirm={async () => {
          await api.post(`/api/projects/${project.id}/archive`, { archived: !project.archived_at }).catch((e) => toast(e.message, 'error'))
          setArchiveConfirm(false)
          toast(project.archived_at ? 'Proyek diaktifkan.' : 'Proyek diarsipkan.')
          reload()
        }}
      />

      <ConfirmDialog
        open={deleteConfirm}
        title="Hapus proyek?"
        description="Proyek ditandai terhapus (soft delete) dan hilang dari katalog. Data historis tetap tersimpan di basis data."
        danger
        confirmLabel="Hapus proyek"
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={async () => {
          await api.del(`/api/projects/${project.id}`).catch((e) => toast(e.message, 'error'))
          toast('Proyek dihapus.')
          navigate(`/app/${entityKey}/projects`)
        }}
      />
    </div>
  )
}

function KpiRow({ kpi, canManage, onSaved }: { kpi: Kpi; canManage: boolean; onSaved: () => void }) {
  const { toast } = useApp()
  const [values, setValues] = useState({
    label: kpi.label,
    unit: kpi.unit ?? '',
    target: String(kpi.target_value),
    current: String(kpi.current_value),
  })
  const dirty = values.label !== kpi.label || values.unit !== (kpi.unit ?? '') ||
    values.target !== String(kpi.target_value) || values.current !== String(kpi.current_value)

  return (
    <div className="grid gap-2 rounded-xl border border-line px-3 py-2 sm:grid-cols-[1.6fr_0.8fr_0.7fr_0.7fr_auto]">
      <input className="input !py-1.5 text-xs" value={values.label} onChange={(e) => setValues({ ...values, label: e.target.value })} disabled={!canManage} />
      <input className="input !py-1.5 text-xs" value={values.unit} onChange={(e) => setValues({ ...values, unit: e.target.value })} disabled={!canManage} placeholder="Satuan" />
      <input className="input !py-1.5 text-xs" value={values.target} onChange={(e) => setValues({ ...values, target: e.target.value })} disabled={!canManage} placeholder="Target" />
      <input className="input !py-1.5 text-xs" value={values.current} onChange={(e) => setValues({ ...values, current: e.target.value })} disabled={!canManage} placeholder="Capaian" />
      <div className="flex items-center gap-1">
        {canManage && (
          <>
            <button
              className={cn('btn-secondary btn-sm', !dirty && 'opacity-50')}
              disabled={!dirty}
              onClick={async () => {
                try {
                  await api.patch(`/api/kpis/${kpi.id}`, {
                    label: values.label, unit: values.unit || null,
                    targetValue: Number(values.target) || 0, currentValue: Number(values.current) || 0,
                  })
                  toast('Indikator diperbarui.')
                  onSaved()
                } catch (err: any) {
                  toast(err?.message ?? 'Gagal menyimpan', 'error')
                }
              }}
            >
              <Save className="h-3 w-3" />
            </button>
            <button
              className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
              onClick={async () => {
                await api.del(`/api/kpis/${kpi.id}`).catch((e) => toast(e.message, 'error'))
                onSaved()
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function AddMemberModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const [candidates, setCandidates] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [access, setAccess] = useState<'admin' | 'member'>('admin')
  const [isPrimaryPic, setIsPrimaryPic] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get<{ users: User[] }>(`/api/projects/${projectId}/members/candidates`)
      .then((res) => { setCandidates(res.users); setUserId(res.users[0]?.id ?? '') })
      .catch((err) => toast(err?.message ?? 'Gagal memuat kandidat', 'error'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function submit(confirmReplace = false) {
    setBusy(true)
    try {
      await api.post(`/api/projects/${projectId}/members`, { userId, access, isPrimaryPic, confirmReplace })
      toast('Anggota ditambahkan.')
      onSaved()
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'PIC_CONFIRM_REQUIRED') {
        if (window.confirm(`${err.message}\n\nLanjutkan mengganti PIC utama?`)) {
          await submit(true)
        }
      } else {
        toast(err?.message ?? 'Gagal menambah anggota', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Tambah anggota proyek"
      description="Pilih pengguna dari entitas yang sama."
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={() => submit()} disabled={busy || !userId}>
            {busy && <Spinner />} Tambahkan
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Pengguna" required>
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={loading}>
            {candidates.map((user) => (
              <option key={user.id} value={user.id}>{user.name} — {user.email} ({user.role})</option>
            ))}
            {candidates.length === 0 && !loading && <option value="">Tidak ada kandidat tersedia</option>}
          </select>
        </Field>
        <Field label="Hak akses">
          <select className="input" value={access} onChange={(e) => setAccess(e.target.value as any)}>
            <option value="admin">Project Admin — dapat mengelola proyek</option>
            <option value="member">Anggota tim — dapat berkontribusi</option>
          </select>
        </Field>
        <label className="flex items-start gap-2.5 rounded-xl border border-line bg-canvas/50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5" checked={isPrimaryPic} onChange={(e) => setIsPrimaryPic(e.target.checked)} />
          <span>
            <span className="block font-medium text-ink">Jadikan PIC utama</span>
            <span className="block text-xs text-muted">Menggantikan PIC aktif. Konfirmasi tambahan diperlukan.</span>
          </span>
        </label>
      </div>
    </Modal>
  )
}
