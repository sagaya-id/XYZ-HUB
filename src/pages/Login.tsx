import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, ChevronDown, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/app-context'
import { Field, Spinner, cn } from '../components/ui'

const DEMO_ACCOUNTS = [
  { email: 'master@xyz.co.id', password: 'Master#2026', role: 'Master Admin', name: 'Ayu Prakoso', scope: 'Kedua entitas' },
  { email: 'sari.admin@xyz.co.id', password: 'Yayasan#2026', role: 'Super Admin', name: 'Sari Wulandari', scope: 'Yayasan XYZ' },
  { email: 'budi.admin@xyz.co.id', password: 'Store#2026', role: 'Super Admin', name: 'Budi Santoso', scope: 'XYZ Store' },
  { email: 'rina.pic@xyz.co.id', password: 'Proyek#2026', role: 'Project Admin', name: 'Rina Kartika', scope: 'PIC Yayasan' },
  { email: 'dewi.pic@xyz.co.id', password: 'Proyek#2026', role: 'Project Admin', name: 'Dewi Lestari', scope: 'PIC XYZ Store' },
  { email: 'siti.tim@xyz.co.id', password: 'Proyek#2026', role: 'Anggota Tim', name: 'Siti Rahmawati', scope: 'Tim lapangan' },
]

export function Login() {
  const { boot, me, refreshMe, toast } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const portal = params.get('portal')
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDemo, setShowDemo] = useState(true)

  const card = portal ? boot?.cards?.[portal] : null

  useEffect(() => {
    if (form.email) return
    if (portal === 'store') setForm((f) => ({ ...f, email: 'budi.admin@xyz.co.id', password: 'Store#2026' }))
    if (portal === 'yayasan') setForm((f) => ({ ...f, email: 'sari.admin@xyz.co.id', password: 'Yayasan#2026' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal])

  useEffect(() => {
    if (me) {
      navigate(`/app/${me.entity?.key ?? portal ?? 'yayasan'}/home`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ user: any; mustChangePassword: boolean }>('/api/auth/login', form)
      await refreshMe()
      toast(`Selamat datang, ${res.user.name.split(' ')[0]}.`)
      const key = res.user.entity_id ? (boot?.entities.find((en) => en.id === res.user.entity_id)?.key ?? portal ?? 'yayasan') : (portal ?? 'yayasan')
      navigate(`/app/${key}/home`, { replace: true })
    } catch (err: any) {
      setError(err?.message ?? 'Gagal masuk.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <img src={boot?.global?.loginHeroUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/10" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Link to="/" className="flex items-center gap-2.5 text-white">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 text-sm font-bold backdrop-blur">X</span>
            <span className="text-sm font-semibold">{boot?.global?.siteName ?? 'XYZ Project Hub'}</span>
          </Link>
          <div className="max-w-md">
            <p className="text-[11px] font-medium tracking-[0.16em] text-white/60 uppercase">{boot?.global?.eyebrow}</p>
            <h1 className="mt-3 text-4xl leading-tight font-semibold text-white">
              {card ? card.headline : boot?.global?.landingHeadline}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              {card ? card.description : boot?.global?.landingSubtitle}
            </p>
            <div className="mt-6 flex items-center gap-2 text-[11px] text-white/60">
              <ShieldCheck className="h-3.5 w-3.5" /> Sesi aman, akses berbasis peran, isolasi entitas di sisi server.
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center bg-canvas px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted hover:text-ink lg:hidden">
            ← Kembali ke beranda
          </Link>
          <div className="mb-6">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-forest uppercase">
              {portal ? `Portal ${card?.name ?? portal}` : 'Masuk ke platform'}
            </p>
            <h2 className="mt-1.5 text-2xl font-semibold text-ink sm:text-3xl">Selamat datang kembali</h2>
            <p className="mt-1.5 text-sm text-muted">
              Gunakan akun yang diundang oleh admin entitas Anda. Tidak ada pendaftaran publik.
            </p>
          </div>

          <form onSubmit={submit} className="card space-y-4 p-5 sm:p-6">
            <Field label="Email" required>
              <input
                type="email"
                className="input"
                autoComplete="username"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="nama@xyz.co.id"
                required
              />
            </Field>
            <Field label="Kata sandi" required>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
                  aria-label="Tampilkan kata sandi"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
            <button className="btn-primary w-full" type="submit" disabled={busy}>
              {busy ? <Spinner /> : <Lock className="h-4 w-4" />} Masuk
            </button>
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" /> Sesi 14 hari, HttpOnly</span>
              <Link to="/" className="hover:text-ink">Beranda</Link>
            </div>
          </form>

          <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-white">
            <button onClick={() => setShowDemo((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span>
                <span className="block text-xs font-semibold text-ink">Akun demo untuk pengujian</span>
                <span className="block text-[11px] text-muted">Data fiktif untuk kedua entitas.</span>
              </span>
              <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', showDemo && 'rotate-180')} />
            </button>
            {showDemo && (
              <div className="border-t border-line">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    onClick={() => { setForm({ email: account.email, password: account.password }); setError(null) }}
                    className="flex w-full items-center justify-between gap-3 border-b border-line/70 px-4 py-2.5 text-left last:border-0 hover:bg-canvas"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink">{account.email}</span>
                      <span className="block text-[10px] text-muted">{account.name} · {account.scope}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="chip !px-2 !py-0.5 !text-[9px]">{account.role}</span>
                      <ArrowRight className="h-3 w-3 text-muted" />
                    </span>
                  </button>
                ))}
                <p className="px-4 py-2 text-[10px] leading-relaxed text-muted">
                  Klik salah satu akun untuk mengisi formulir. Kata sandi demo: lihat dokumentasi README.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
