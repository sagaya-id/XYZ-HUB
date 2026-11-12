import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Check, Copy, Download, FileSpreadsheet, History, Palette, Search, ShieldCheck, UserCog,
  UserPlus, Users,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useAsync } from '../lib/app-context'
import type { BrandingEntity, BrandingGlobal, Entity, User } from '../lib/types'
import {
  Avatar, Field, ImageUpload, LoadingBlock, Modal, PageHeader, SearchInput, Spinner, Tabs, cn,
} from '../components/ui'
import { ImportWizard } from '../components/import-wizard'
import { formatDateTime, relativeTime } from '../lib/format'

type AdminTab = 'users' | 'branding' | 'audit'

const ROLE_LABEL: Record<string, string> = { MA: 'Master Admin', SA: 'Super Admin', PA: 'Project Admin' }

export function AdminPage() {
  const { entity } = useParams<{ entity: string }>()
  const { me } = useApp()
  const [tab, setTab] = useState<AdminTab>('users')

  if (me?.user.role !== 'MA' && me?.user.role !== 'SA') {
    return (
      <div className="card p-8 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted" />
        <p className="mt-3 text-sm font-medium text-ink">Akses terbatas</p>
        <p className="mt-1 text-sm text-muted">Halaman administrasi hanya untuk Master Admin dan Super Admin.</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Administrasi"
        title="Pengelolaan platform"
        description="Undang pengguna, atur branding entitas, dan tinjau jejak audit. Pembuatan akun hanya melalui undangan."
      />
      <Tabs
        tabs={[
          { value: 'users', label: 'Pengguna', icon: Users },
          { value: 'branding', label: 'Branding & Konten', icon: Palette },
          { value: 'audit', label: 'Audit Log', icon: History },
        ]}
        value={tab}
        onChange={(value) => setTab(value)}
        className="mb-4"
      />
      {tab === 'users' && <UsersPanel entityKey={entity!} />}
      {tab === 'branding' && <BrandingPanel entityKey={entity!} />}
      {tab === 'audit' && <AuditPanel entityKey={entity!} />}
    </div>
  )
}

function UsersPanel({ entityKey }: { entityKey: string }) {
  const { me, toast } = useApp()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [inviteResult, setInviteResult] = useState<{ email: string; password: string; name: string }[] | null>(null)

  const { data, loading, reload } = useAsync<{ users: User[]; entity: Entity; canCreateRoles: string[] }>(
    () => api.get(`/api/admin/users?entity=${entityKey}${roleFilter ? `&role=${roleFilter}` : ''}`),
    [entityKey, roleFilter],
  )

  const users = (data?.users ?? []).filter((user) => {
    if (!search) return true
    return `${user.name} ${user.email} ${user.job_title ?? ''}`.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title">Akun pengguna</h2>
            <p className="muted mt-0.5">
              {data?.entity.name ?? ''} · {users.length} akun terlihat. Peran yang tersedia: MA, SA, PA.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Impor CSV/Excel
            </button>
            <button className="btn-primary btn-sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Undang pengguna
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nama atau email…" className="w-full sm:w-72" />
          <select className="input sm:w-44" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">Semua peran</option>
            <option value="MA">Master Admin</option>
            <option value="SA">Super Admin</option>
            <option value="PA">Project Admin</option>
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-canvas/70">
                <tr>
                  {['Pengguna', 'Peran', 'Proyek', 'Status', 'Login terakhir', ''].map((header) => (
                    <th key={header} className="px-3 py-2.5 text-left text-[10px] font-semibold tracking-wide text-muted uppercase">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-line hover:bg-canvas/40">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={user.name} url={user.avatar_url} size={32} />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-ink">{user.name}</p>
                          <p className="truncate text-[10px] text-muted">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('badge', user.role === 'MA' ? 'bg-forest text-white' : user.role === 'SA' ? 'bg-sky-50 text-sky-700' : 'bg-canvas text-muted')}>
                        {ROLE_LABEL[user.role]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">
                      {(user.projects ?? []).length === 0 ? '—' : (user.projects ?? []).map((p) => p.title).join(', ').slice(0, 48)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('badge', user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                        {user.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-muted">{user.last_login_at ? relativeTime(user.last_login_at) : 'Belum pernah'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button className="btn-ghost btn-sm" onClick={() => setEditing(user)}>
                          <UserCog className="h-3.5 w-3.5" /> Ubah
                        </button>
                        {user.is_active && user.id !== me?.user.id && (
                          <button
                            className="btn-ghost btn-sm !text-red-600"
                            onClick={async () => {
                              if (!window.confirm(`Nonaktifkan ${user.name}? Akses dicabut, riwayat kerja tetap tersimpan.`)) return
                              await api.del(`/api/admin/users/${user.id}`).catch((e) => toast(e.message, 'error'))
                              toast('Akun dinonaktifkan.')
                              reload()
                            }}
                          >
                            Nonaktifkan
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted">Tidak ada pengguna yang cocok.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {inviteOpen && (
        <InviteModal
          entityId={data?.entity.id ?? ''}
          roles={data?.canCreateRoles ?? ['SA', 'PA']}
          onClose={() => setInviteOpen(false)}
          onSaved={(result) => {
            setInviteOpen(false)
            reload()
            if (result) setInviteResult([result])
          }}
        />
      )}

      {editing && <EditUserModal user={editing} entities={data ? [data.entity] : []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}

      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Impor pengguna"
        description="Kolom yang dibutuhkan: email, nama, peran (MA/SA/PA), dan entitas (yayasan/store)."
        modeEnabled={false}
        fields={[
          { key: 'email', label: 'Email', required: true },
          { key: 'name', label: 'Nama', required: true },
          { key: 'role', label: 'Peran (MA/SA/PA)' },
          { key: 'entity', label: 'Entitas (yayasan/store)' },
          { key: 'jobTitle', label: 'Jabatan' },
        ]}
        confirmLabel="Buat akun"
        note={
          <p className="rounded-xl bg-canvas/60 px-3 py-2 text-[11px] text-muted">
            Setiap akun baru akan menerima kata sandi sementara yang ditampilkan setelah impor. Tidak ada email
            otomatis pada demo ini — bagikan kata sandi melalui kanal internal Anda.
          </p>
        }
        onConfirm={async (payload) => {
          const res = await api.post<{ results: any[]; created: number; invalid: number }>('/api/admin/users/import', {
            rows: payload.rows,
          })
          const created = res.results.filter((r) => r.status === 'created').map((r) => ({
            email: r.email, password: r.temporaryPassword, name: r.name,
          }))
          reload()
          if (created.length) setInviteResult(created)
          return `${res.created} akun dibuat, ${res.invalid} baris tidak valid.`
        }}
      />

      <Modal
        open={!!inviteResult}
        onClose={() => setInviteResult(null)}
        size="md"
        title="Kredensial akun baru"
        description="Tampilkan sekali dan bagikan secara aman. Kata sandi wajib diganti pada login pertama."
        footer={
          <div className="flex justify-end gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                const text = (inviteResult ?? []).map((r) => `${r.name} <${r.email}> — ${r.password}`).join('\n')
                navigator.clipboard?.writeText(text)
                toast('Kredensial disalin.')
              }}
            >
              <Copy className="h-4 w-4" /> Salin semua
            </button>
            <button className="btn-primary" onClick={() => setInviteResult(null)}>Selesai</button>
          </div>
        }
      >
        <div className="space-y-2">
          {(inviteResult ?? []).map((item) => (
            <div key={item.email} className="rounded-xl border border-line px-3 py-2">
              <p className="text-xs font-medium text-ink">{item.name}</p>
              <p className="text-[11px] text-muted">{item.email}</p>
              <p className="mt-1 font-mono text-[11px] text-forest">{item.password}</p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

function InviteModal({
  entityId, roles, onClose, onSaved,
}: {
  entityId: string
  roles: string[]
  onClose: () => void
  onSaved: (result?: { email: string; password: string; name: string }) => void
}) {
  const { toast } = useApp()
  const [form, setForm] = useState({ name: '', email: '', role: 'PA', jobTitle: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ user: User; temporaryPassword?: string }>('/api/admin/users', {
        ...form,
        entityId,
        password: form.password || undefined,
      })
      toast('Pengguna diundang.')
      onSaved(res.temporaryPassword ? { email: res.user.email, password: res.temporaryPassword, name: res.user.name } : undefined)
    } catch (err: any) {
      setError(err?.message ?? 'Gagal mengundang pengguna.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Undang pengguna"
      description="Akun dibuat oleh admin. Tidak ada pendaftaran publik."
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.name || !form.email}>
            {busy && <Spinner />} Buat akun
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="field-grid">
          <Field label="Nama lengkap" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Email" required>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Peran">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
            </select>
          </Field>
          <Field label="Jabatan">
            <input className="input" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </Field>
        </div>
        <Field label="Kata sandi awal" hint="Kosongkan untuk dibuat otomatis dan ditampilkan setelah penyimpanan.">
          <input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Minimal 8 karakter" />
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}

function EditUserModal({
  user, entities, onClose, onSaved,
}: { user: User; entities: Entity[]; onClose: () => void; onSaved: () => void }) {
  const { toast, me } = useApp()
  const [form, setForm] = useState({
    name: user.name,
    role: user.role,
    entityId: user.entity_id ?? '',
    jobTitle: user.job_title ?? '',
    phone: user.phone ?? '',
    isActive: !!user.is_active,
    password: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMaster = me?.user.role === 'MA'

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/api/admin/users/${user.id}`, {
        name: form.name,
        role: form.role,
        entityId: form.role === 'MA' ? null : form.entityId || undefined,
        jobTitle: form.jobTitle,
        phone: form.phone,
        isActive: form.isActive,
        password: form.password || undefined,
      })
      toast('Akun diperbarui.')
      onSaved()
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memperbarui akun.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ubah akun"
      description={user.email}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy && <Spinner />} Simpan
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="field-grid">
          <Field label="Nama">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Peran">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as any })} disabled={!isMaster && user.role === 'MA'}>
              {['MA', 'SA', 'PA'].filter((role) => isMaster || role !== 'MA').map((role) => (
                <option key={role} value={role}>{ROLE_LABEL[role]}</option>
              ))}
            </select>
          </Field>
          <Field label="Jabatan">
            <input className="input" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </Field>
          <Field label="Telepon">
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </div>
        {form.role !== 'MA' && isMaster && (
          <Field label="Entitas" hint="Super Admin dan Project Admin terikat pada satu entitas.">
            <select className="input" value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })}>
              <option value="">— pilih entitas —</option>
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </select>
          </Field>
        )}
        <label className="flex items-center gap-2 rounded-xl border border-line bg-canvas/50 px-3 py-2.5 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          <span className="text-ink">Akun aktif</span>
          <span className="text-xs text-muted">Menonaktifkan akan mengakhiri semua sesi.</span>
        </label>
        <Field label="Reset kata sandi" hint="Kosongkan jika tidak ingin mengubah. Sesi akan diakhiri.">
          <input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Kata sandi baru (min. 8 karakter)" />
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}

function BrandingPanel({ entityKey }: { entityKey: string }) {
  const { toast, refreshBoot } = useApp()
  const { data, loading, reload } = useAsync<{
    global: BrandingGlobal | null
    cards: Record<string, BrandingEntity>
    entities: Entity[]
    canEditGlobal: boolean
  }>(() => api.get('/api/admin/branding'), [])

  const [scope, setScope] = useState<string>('global')
  const [draft, setDraft] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const effectiveScope = useMemo(() => {
    if (!data?.canEditGlobal && scope === 'global') return data?.entities[0]?.key ?? entityKey
    return scope
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, data])

  const values = draft ?? (effectiveScope === 'global' ? data?.global : data?.cards?.[effectiveScope]) ?? null

  function update(patch: Record<string, any>) {
    setDraft({ ...(values ?? {}), ...patch })
  }

  async function save() {
    if (!values) return
    setBusy(true)
    try {
      await api.put('/api/admin/branding', { scope: effectiveScope, values })
      toast('Branding disimpan.')
      setDraft(null)
      await refreshBoot()
      reload()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan branding', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !data) return <LoadingBlock label="Memuat pengaturan branding…" />

  const scopes = [
    ...(data.canEditGlobal ? [{ key: 'global', label: 'Global' }] : []),
    ...data.entities.map((entity) => ({ key: entity.key, label: entity.name })),
  ]

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title">Branding & konten</h2>
            <p className="muted mt-0.5">
              {data.canEditGlobal
                ? 'Master Admin dapat mengubah branding global dan kedua entitas.'
                : 'Super Admin hanya dapat mengubah branding entitasnya.'}
            </p>
          </div>
          <button className="btn-primary btn-sm" onClick={save} disabled={busy || !draft}>
            {busy && <Spinner />} Simpan perubahan
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {scopes.map((item) => (
            <button
              key={item.key}
              className={cn('chip', effectiveScope === item.key && 'chip-active')}
              onClick={() => { setScope(item.key); setDraft(null) }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {values && effectiveScope === 'global' ? (
        <GlobalBrandingForm values={values} update={update} />
      ) : values ? (
        <EntityBrandingForm values={values} update={update} scope={effectiveScope} />
      ) : null}
    </div>
  )
}

function GlobalBrandingForm({ values, update }: { values: BrandingGlobal; update: (patch: any) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <section className="card p-5">
          <h3 className="text-sm font-semibold text-ink">Identitas platform</h3>
          <div className="mt-3 field-grid">
            <Field label="Nama situs">
              <input className="input" value={values.siteName} onChange={(e) => update({ siteName: e.target.value })} />
            </Field>
            <Field label="Eyebrow / label kecil">
              <input className="input" value={values.eyebrow} onChange={(e) => update({ eyebrow: e.target.value })} />
            </Field>
          </div>
          <Field label="Warna primer" className="mt-3">
            <div className="flex items-center gap-2">
              <input type="color" value={values.primaryColor} onChange={(e) => update({ primaryColor: e.target.value })} className="h-10 w-14 rounded-lg border border-line" />
              <input className="input" value={values.primaryColor} onChange={(e) => update({ primaryColor: e.target.value })} />
            </div>
          </Field>
          <ImageUpload
            label="Logo platform"
            value={values.logoFileId ? `/api/files/${values.logoFileId}` : null}
            onChange={(id) => update({ logoFileId: id })}
            className="mt-3"
          />
        </section>

        <section className="card p-5">
          <h3 className="text-sm font-semibold text-ink">Halaman depan & login</h3>
          <div className="mt-3 space-y-3">
            <Field label="Judul utama landing">
              <input className="input" value={values.landingHeadline} onChange={(e) => update({ landingHeadline: e.target.value })} />
            </Field>
            <Field label="Subjudul landing">
              <textarea className="input min-h-[70px]" value={values.landingSubtitle} onChange={(e) => update({ landingSubtitle: e.target.value })} />
            </Field>
            <Field label="Gambar hero login (URL)">
              <input className="input" value={values.loginHeroUrl} onChange={(e) => update({ loginHeroUrl: e.target.value })} />
            </Field>
            <ImageUpload
              label="Atau unggah hero login"
              value={values.loginHeroFileId ? `/api/files/${values.loginHeroFileId}` : null}
              onChange={(id) => update({ loginHeroFileId: id })}
              hint="Berkas yang diunggah akan dipakai menggantikan URL."
            />
            <Field label="Teks footer">
              <input className="input" value={values.footerText} onChange={(e) => update({ footerText: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="card p-5">
          <h3 className="text-sm font-semibold text-ink">Peta</h3>
          <p className="muted mt-0.5">Basemap default menggunakan OpenStreetMap. Anda dapat mengganti penyedia tile berlisensi.</p>
          <Field label="URL tile" className="mt-3">
            <input className="input font-mono text-xs" value={values.mapTileUrl} onChange={(e) => update({ mapTileUrl: e.target.value })} />
          </Field>
          <Field label="Atribusi tile" className="mt-3">
            <input className="input" value={values.mapAttribution} onChange={(e) => update({ mapAttribution: e.target.value })} />
          </Field>
        </section>
      </div>

      <div className="space-y-4">
        <section className="card overflow-hidden p-0">
          <div className="border-b border-line px-4 py-3">
            <p className="text-xs font-semibold text-ink">Pratinjau langsung</p>
          </div>
          <div className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              {values.logoFileId ? (
                <img src={`/api/files/${values.logoFileId}`} alt="" className="h-8 w-8 rounded-lg object-cover" />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: values.primaryColor }}>X</span>
              )}
              <div>
                <p className="text-sm font-semibold text-ink">{values.siteName}</p>
                <p className="text-[9px] tracking-[0.14em] text-muted uppercase">{values.eyebrow}</p>
              </div>
            </div>
            <p className="mt-3 text-lg leading-tight font-semibold text-ink">{values.landingHeadline}</p>
            <p className="text-[11px] leading-relaxed text-muted">{values.landingSubtitle}</p>
            <span className="btn-primary btn-sm mt-1 inline-flex" style={{ backgroundColor: values.primaryColor }}>Masuk ke portal</span>
          </div>
          <img
            src={values.loginHeroFileId ? `/api/files/${values.loginHeroFileId}` : values.loginHeroUrl}
            alt=""
            className="h-36 w-full object-cover"
          />
          <p className="border-t border-line px-4 py-2 text-[10px] text-muted">{values.footerText}</p>
        </section>
      </div>
    </div>
  )
}

function EntityBrandingForm({
  values, update, scope,
}: { values: BrandingEntity; update: (patch: any) => void; scope: string }) {
  const previewCard = (
    <div className="card overflow-hidden">
      <div className="relative aspect-[16/10]">
        <img
          src={values.cardPhotoFileId ? `/api/files/${values.cardPhotoFileId}` : values.cardPhotoUrl}
          alt=""
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="text-[9px] tracking-[0.14em] text-white/70 uppercase">Portal entitas</p>
          <p className="text-lg font-semibold text-white">{values.name}</p>
          <p className="text-[11px] text-white/75">{values.headline}</p>
        </div>
      </div>
      <p className="px-4 py-2 text-[10px] text-muted">{values.footerText}</p>
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <section className="card p-5">
          <h3 className="text-sm font-semibold text-ink">Identitas entitas</h3>
          <div className="mt-3 space-y-3">
            <Field label="Nama entitas">
              <input className="input" value={values.name} onChange={(e) => update({ name: e.target.value })} />
            </Field>
            <Field label="Headline">
              <input className="input" value={values.headline} onChange={(e) => update({ headline: e.target.value })} />
            </Field>
            <Field label="Slogan">
              <input className="input" value={values.slogan} onChange={(e) => update({ slogan: e.target.value })} />
            </Field>
            <Field label="Deskripsi">
              <textarea className="input min-h-[80px]" value={values.description} onChange={(e) => update({ description: e.target.value })} />
            </Field>
            <Field label="Warna entitas">
              <div className="flex items-center gap-2">
                <input type="color" value={values.primaryColor} onChange={(e) => update({ primaryColor: e.target.value })} className="h-10 w-14 rounded-lg border border-line" />
                <input className="input" value={values.primaryColor} onChange={(e) => update({ primaryColor: e.target.value })} />
              </div>
            </Field>
            <Field label="Teks footer">
              <input className="input" value={values.footerText} onChange={(e) => update({ footerText: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="card p-5">
          <h3 className="text-sm font-semibold text-ink">Media</h3>
          <ImageUpload
            label="Foto kartu organisasi"
            value={values.cardPhotoFileId ? `/api/files/${values.cardPhotoFileId}` : null}
            onChange={(id) => update({ cardPhotoFileId: id })}
            className="mt-3"
            hint="Foto besar pada halaman depan. Rasio 16:10 disarankan."
          />
          <Field label="Atau URL foto" className="mt-3">
            <input className="input" value={values.cardPhotoUrl} onChange={(e) => update({ cardPhotoUrl: e.target.value })} />
          </Field>
          <ImageUpload
            label="Logo entitas"
            value={values.logoFileId ? `/api/files/${values.logoFileId}` : null}
            onChange={(id) => update({ logoFileId: id })}
            className="mt-3"
            shape="circle"
          />
          <ImageUpload
            label="Banner entitas"
            value={values.bannerFileId ? `/api/files/${values.bannerFileId}` : null}
            onChange={(id) => update({ bannerFileId: id })}
            className="mt-3"
          />
        </section>
      </div>
      <div className="space-y-3">
        <p className="text-[11px] text-muted">Pratinjau kartu portal ({scope})</p>
        {previewCard}
        <div className="card p-4 text-[10px] leading-relaxed text-muted">
          Perubahan tersimpan pada konfigurasi entitas dan langsung dipakai halaman depan, header portal, serta halaman masuk.
        </div>
      </div>
    </div>
  )
}

function AuditPanel({ entityKey }: { entityKey: string }) {
  const [search, setSearch] = useState('')
  const { data, loading } = useAsync<{ audit: any[] }>(
    () => api.get(`/api/admin/audit?entity=${entityKey}&limit=150`),
    [entityKey],
  )
  const entries = (data?.audit ?? []).filter((entry) => {
    if (!search) return true
    return `${entry.actor_name} ${entry.action} ${entry.summary}`.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title">Audit log</h2>
            <p className="muted mt-0.5">Jejak tindakan penting: proyek, keanggotaan, anggaran, impor, dan autentikasi.</p>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Cari aktor atau tindakan…" className="sm:w-64" />
        </div>
      </div>
      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-line">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-forest-50 text-forest">
                  <History className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-ink">{entry.summary}</p>
                  <p className="text-[10px] text-muted">
                    {entry.actor_name ?? 'Sistem'} · <span className="font-mono">{entry.action}</span> · {formatDateTime(entry.created_at)}
                  </p>
                </div>
                {entry.entity_name && <span className="chip shrink-0 !py-0.5 !text-[9px]">{entry.entity_name}</span>}
              </div>
            ))}
            {entries.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Belum ada catatan audit.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
