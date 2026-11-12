import { Link } from 'react-router-dom'
import {
  ArrowRight, Bell, CalendarDays, CheckCircle2, Layers, Lock, MapPinned, Sparkles,
} from 'lucide-react'
import { useApp } from '../lib/app-context'
import type { BrandingEntity } from '../lib/types'

const FALLBACK_ENTITY: BrandingEntity = {
  key: 'yayasan', name: 'Yayasan XYZ', headline: '', slogan: '', description: '',
  cardPhotoFileId: null, cardPhotoUrl: '', bannerFileId: null, logoFileId: null,
  primaryColor: '#245A46', footerText: '',
}

export function Landing() {
  const { boot, me } = useApp()
  const global = boot?.global
  const entities = boot?.entities ?? []

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line/70 glass">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link to="/" className="flex items-center gap-2.5">
            {global?.logoFileId ? (
              <img src={`/api/files/${global.logoFileId}`} alt="" className="h-9 w-9 rounded-xl object-cover" />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-sm font-bold text-white">X</span>
            )}
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold text-ink">{global?.siteName ?? 'XYZ Project Hub'}</span>
              <span className="block text-[10px] tracking-[0.14em] text-muted uppercase">{global?.eyebrow ?? 'Project Monitoring'}</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a href="#organisasi" className="hover:text-ink">Organisasi</a>
            <a href="#fitur" className="hover:text-ink">Fitur</a>
            <a href="#tentang" className="hover:text-ink">Tentang</a>
          </nav>
          <div className="flex items-center gap-2">
            {me ? (
              <Link to={`/app/${me.entity?.key ?? 'yayasan'}/home`} className="btn-primary btn-sm">
                Buka portal <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden text-sm font-medium text-muted hover:text-ink sm:block">Masuk</Link>
                <Link to="/login" className="btn-primary btn-sm">Masuk ke portal</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pt-14 pb-16 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-medium text-forest">
              <Sparkles className="h-3.5 w-3.5" /> Dua entitas, satu standar tata kelola
            </span>
            <h1 className="mt-5 text-[34px] leading-[1.1] font-semibold tracking-tight text-ink sm:text-5xl">
              {global?.landingHeadline ?? 'Satu hub untuk seluruh proyek kebaikan.'}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
              {global?.landingSubtitle}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/login" className="btn-primary">
                Masuk ke portal <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#organisasi" className="btn-secondary">Lihat organisasi</a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-forest" /> Akses undangan & isolasi data</span>
              <span className="inline-flex items-center gap-1.5"><MapPinned className="h-3.5 w-3.5 text-forest" /> Peta & logbook lapangan</span>
              <span className="inline-flex items-center gap-1.5"><Bell className="h-3.5 w-3.5 text-forest" /> Notifikasi tersimpan</span>
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-[28px] border border-line bg-white p-2 shadow-[0_40px_80px_-50px_rgba(31,41,51,0.6)]">
              <img
                src={global?.loginHeroUrl}
                alt="Aktivitas program"
                className="h-[300px] w-full rounded-[20px] object-cover sm:h-[380px]"
                loading="eager"
              />
            </div>
            <div className="absolute -bottom-6 -left-3 hidden w-56 rounded-2xl border border-line bg-white p-3.5 shadow-[0_24px_48px_-24px_rgba(31,41,51,0.4)] sm:block">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">Progres program</p>
              <div className="mt-2 space-y-2">
                {[62, 48, 71].map((value, index) => (
                  <div key={value} className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-forest" style={{ width: `${value}%` }} />
                    </div>
                    <span className="text-[10px] font-medium text-muted">{value}%</span>
                    <span className="sr-only">{index}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="organisasi" className="mx-auto max-w-6xl px-5 pb-16">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-forest uppercase">Pilih portal</p>
            <h2 className="mt-1.5 text-2xl font-semibold text-ink sm:text-3xl">Dua organisasi, ruang kerja terpisah</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">
              Setiap entitas memiliki katalog proyek, kalender, peta, dan pengguna sendiri. Tidak ada data yang tercampur.
            </p>
          </div>
          <Link to="/login" className="btn-ghost btn-sm">Butuh akun? Hubungi Master Admin</Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {(entities.length ? entities : [{ key: 'yayasan', name: 'Yayasan XYZ' }, { key: 'store', name: 'XYZ Store' }]).map((entity) => {
            const card = boot?.cards?.[entity.key] ?? { ...FALLBACK_ENTITY, key: entity.key as 'yayasan' | 'store', name: entity.name }
            return (
              <Link
                key={entity.key}
                to={`/login?portal=${entity.key}`}
                className="group relative block overflow-hidden rounded-[28px] border border-line bg-ink"
              >
                <div className="relative aspect-[16/11] w-full overflow-hidden">
                  {card.cardPhotoFileId ? (
                    <img src={`/api/files/${card.cardPhotoFileId}`} alt={card.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
                  ) : (
                    <img src={card.cardPhotoUrl} alt={card.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/25 to-transparent" />
                </div>
                <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
                  <div className="flex items-center gap-2">
                    {card.logoFileId ? (
                      <img src={`/api/files/${card.logoFileId}`} alt="" className="h-7 w-7 rounded-lg object-cover" />
                    ) : (
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/15 text-[11px] font-bold text-white backdrop-blur">
                        {card.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="text-[11px] font-medium tracking-[0.14em] text-white/70 uppercase">Portal entitas</span>
                  </div>
                  <h3 className="mt-2 text-2xl font-semibold text-white">{card.name}</h3>
                  <p className="mt-1 max-w-md text-sm text-white/75">{card.headline}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-ink transition-transform group-hover:translate-x-0.5">
                    Masuk ke portal <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      <section id="fitur" className="border-y border-line bg-white py-16">
        <div className="mx-auto max-w-6xl px-5">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-forest uppercase">Satu platform</p>
          <h2 className="mt-1.5 max-w-2xl text-2xl font-semibold text-ink sm:text-3xl">
            Semua yang dibutuhkan untuk memantau proyek lintas entitas.
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Layers, title: 'Katalog proyek visual', text: 'Kartu proyek dengan sampul, kategori, PIC, progres, dan status.' },
              { icon: MapPinned, title: 'Peta interaktif nyata', text: 'Impor KML, GeoJSON, atau koordinat Excel; titik, garis, dan area.' },
              { icon: CalendarDays, title: 'Kalender per entitas', text: 'Agenda tampil langsung di dalam tanggal, plus Agenda Terdekat.' },
              { icon: CheckCircle2, title: 'Kanban & logbook', text: 'Geser kartu antar tahap, checklist, foto lapangan, dan riwayat.' },
            ].map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-line bg-canvas/60 p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-forest-50 text-forest">
                  <feature.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-ink">{feature.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{feature.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="tentang" className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-8 rounded-[28px] border border-line bg-white p-7 sm:p-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <h2 className="text-2xl font-semibold text-ink">Dibangun untuk tata kelola yang tenang.</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              XYZ Project Hub menyatukan pemantauan program yayasan dan operasional unit usaha dalam satu pengalaman
              yang konsisten. Hak akses dijaga di sisi server: Master Admin mengelola kedua entitas, Super Admin hanya
              entitasnya, dan Project Admin hanya proyek yang ditugaskan.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                'Isolasi data antar entitas di setiap kueri',
                'Anggaran hanya dihitung setelah dikonfirmasi',
                'Riwayat kerja tetap utuh saat akses dicabut',
                'Audit log untuk tindakan penting',
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 text-xs text-ink">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-canvas/60 p-5">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">Akses</p>
            <p className="mt-2 text-sm text-ink">Pembuatan akun hanya melalui undangan Master Admin atau Super Admin.</p>
            <Link to="/login" className="btn-primary mt-4 w-full">
              Masuk dengan akun undangan <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Untuk demonstrasi, halaman masuk menyediakan daftar akun demo dengan peran berbeda.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>{global?.footerText}</span>
          <span className="flex items-center gap-3">
            <Link to="/login" className="hover:text-ink">Masuk</Link>
            <span className="text-line">·</span>
            <span>Waktu Asia/Jakarta · IDR</span>
          </span>
        </div>
      </footer>
    </div>
  )
}
