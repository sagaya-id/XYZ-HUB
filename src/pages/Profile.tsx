import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Camera, KeyRound, LogOut, Save, ShieldCheck } from 'lucide-react'
import { api, uploadFile } from '../lib/api'
import { useApp, useAsync } from '../lib/app-context'
import { Avatar, Field, LoadingBlock, PageHeader, Spinner, cn } from '../components/ui'
import { formatDateTime } from '../lib/format'

const PREF_LABELS: Record<string, string> = {
  'project.assigned': 'Ditambahkan ke proyek',
  'project.pic': 'Ditunjuk sebagai PIC',
  'project.removed': 'Akses proyek dicabut',
  'task.assigned': 'Tugas baru / penugasan',
  'task.due': 'Pengingat tenggat tugas',
  'project.milestone': 'Pengingat milestone proyek',
  'calendar.created': 'Agenda baru / pengingat',
  'calendar.updated': 'Perubahan agenda',
  'calendar.cancelled': 'Pembatalan agenda',
  'budget.updated': 'Perubahan anggaran',
}

export function ProfilePage() {
  const { me, refreshMe, toast, logout } = useApp()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', phone: '', jobTitle: '' })
  const [busy, setBusy] = useState(false)
  const [avatar, setAvatar] = useState<string | null>(me?.user.avatar_id ?? null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [prefs, setPrefs] = useState<{ type: string; enabled: boolean }[]>([])
  const { data: prefsData, reload: reloadPrefs } = useAsync<{ prefs: { type: string; enabled: boolean }[] }>(
    () => api.get('/api/notifications/prefs'),
    [],
  )

  useEffect(() => {
    if (me) setForm({ name: me.user.name, phone: me.user.phone ?? '', jobTitle: me.user.job_title ?? '' })
  }, [me])

  useEffect(() => {
    if (prefsData) setPrefs(prefsData.prefs)
  }, [prefsData])

  async function saveProfile() {
    setBusy(true)
    try {
      await api.patch('/api/auth/profile', { ...form, avatarId: avatar })
      await refreshMe()
      toast('Profil diperbarui. Avatar otomatis dipakai di seluruh halaman.')
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan profil', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function uploadAvatar(file: File | null) {
    if (!file) return
    setAvatarUploading(true)
    try {
      const uploaded = await uploadFile(file)
      setAvatar(uploaded.id)
      await api.patch('/api/auth/profile', { ...form, avatarId: uploaded.id })
      await refreshMe()
      toast('Avatar diperbarui di seluruh aplikasi.')
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengunggah avatar', 'error')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function changePassword() {
    if (passwordForm.next !== passwordForm.confirm) {
      toast('Konfirmasi kata sandi tidak sama.', 'error')
      return
    }
    setPasswordBusy(true)
    try {
      await api.post('/api/auth/password', { current: passwordForm.current, next: passwordForm.next })
      setPasswordForm({ current: '', next: '', confirm: '' })
      toast('Kata sandi diperbarui.')
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengubah kata sandi', 'error')
    } finally {
      setPasswordBusy(false)
    }
  }

  async function savePrefs(next: typeof prefs) {
    setPrefs(next)
    try {
      await api.put('/api/notifications/prefs', { prefs: next })
      toast('Preferensi notifikasi disimpan.')
      reloadPrefs()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyimpan preferensi', 'error')
    }
  }

  if (!me) return <LoadingBlock />

  return (
    <div>
      <PageHeader
        eyebrow="Akun"
        title="Profil saya"
        description="Perbarui data pribadi, avatar, kata sandi, dan preferensi notifikasi."
        actions={
          <button className="btn-secondary" onClick={async () => { await logout(); navigate('/login') }}>
            <LogOut className="h-4 w-4" /> Keluar
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <section className="card p-5">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div className="relative">
                <Avatar name={me.user.name} url={avatar ? `/api/files/${avatar}` : null} size={76} className="ring-2 ring-forest-50" />
                <label className="absolute -right-1 -bottom-1 grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-line bg-white text-forest shadow-sm hover:bg-forest-50">
                  {avatarUploading ? <Spinner className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadAvatar(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <div className="min-w-0">
                <p className="text-lg font-semibold text-ink">{me.user.name}</p>
                <p className="text-sm text-muted">{me.user.email}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="badge bg-forest-50 text-forest">
                    {me.user.role === 'MA' ? 'Master Admin' : me.user.role === 'SA' ? 'Super Admin' : 'Project Admin'}
                  </span>
                  {me.entity && <span className="chip !py-0.5 !text-[10px]">{me.entity.name}</span>}
                  {me.user.job_title && <span className="chip !py-0.5 !text-[10px]">{me.user.job_title}</span>}
                </div>
              </div>
            </div>

            <div className="mt-5 field-grid">
              <Field label="Nama lengkap">
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Jabatan">
                <input className="input" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
              </Field>
              <Field label="Nomor telepon">
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Email" hint="Email hanya dapat diubah oleh admin.">
                <input className="input" value={me.user.email} readOnly disabled />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] text-muted">Terakhir masuk: {me.user.last_login_at ? formatDateTime(me.user.last_login_at) : '—'}</p>
              <button className="btn-primary" onClick={saveProfile} disabled={busy}>
                {busy ? <Spinner /> : <Save className="h-4 w-4" />} Simpan profil
              </button>
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-forest" />
              <h2 className="section-title">Kata sandi</h2>
            </div>
            <div className="mt-3 space-y-3">
              <Field label="Kata sandi saat ini">
                <input type="password" className="input" value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })} autoComplete="current-password" />
              </Field>
              <div className="field-grid">
                <Field label="Kata sandi baru" hint="Minimal 8 karakter.">
                  <input type="password" className="input" value={passwordForm.next} onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })} autoComplete="new-password" />
                </Field>
                <Field label="Ulangi kata sandi baru">
                  <input type="password" className="input" value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} autoComplete="new-password" />
                </Field>
              </div>
              <button className="btn-secondary" onClick={changePassword} disabled={passwordBusy || !passwordForm.current || !passwordForm.next}>
                {passwordBusy ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} Perbarui kata sandi
              </button>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="card p-5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-forest" />
              <h2 className="section-title">Preferensi notifikasi</h2>
            </div>
            <p className="muted mt-0.5">Notifikasi tersimpan di aplikasi. Pengingat dibuat saat Anda membuka aplikasi (tidak ada cron eksternal).</p>
            <div className="mt-3 space-y-1.5">
              {prefs.map((pref) => (
                <label key={pref.type} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="text-xs text-ink">{PREF_LABELS[pref.type] ?? pref.type}</span>
                  <button
                    role="switch"
                    aria-checked={pref.enabled}
                    onClick={() => savePrefs(prefs.map((p) => p.type === pref.type ? { ...p, enabled: !p.enabled } : p))}
                    className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', pref.enabled ? 'bg-forest' : 'bg-line')}
                  >
                    <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform', pref.enabled ? 'left-4.5' : 'left-0.5')} style={{ left: pref.enabled ? 18 : 2 }} />
                  </button>
                </label>
              ))}
              {prefs.length === 0 && <p className="text-xs text-muted">Memuat preferensi…</p>}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="section-title">Keanggotaan proyek</h2>
            <p className="muted mt-0.5">Proyek yang saat ini dapat Anda akses.</p>
            <div className="mt-3 space-y-1.5">
              {(me.memberships ?? []).map((membership) => (
                <div key={membership.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink">{membership.title}</span>
                    <span className="block text-[10px] text-muted">{membership.access === 'admin' ? 'Project Admin' : 'Anggota tim'}</span>
                  </span>
                  {membership.is_primary_pic ? <span className="badge bg-forest-50 text-forest">PIC</span> : null}
                </div>
              ))}
              {(me.memberships ?? []).length === 0 && <p className="text-xs text-muted">Belum ada keanggotaan proyek.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
