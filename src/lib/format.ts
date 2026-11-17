export const TZ = 'Asia/Jakarta'

export function formatDate(value: string | null | undefined, style: 'short' | 'long' | 'medium' = 'medium'): string {
  if (!value) return '—'
  const date = /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(`${value.slice(0, 10)}T00:00:00+07:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const opts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: '2-digit', month: 'short', timeZone: TZ }
      : style === 'long'
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }
        : { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }
  return new Intl.DateTimeFormat('id-ID', opts).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  }).format(date)
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  const part = value.slice(11, 16)
  return part || ''
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/**
 * Step a calendar date by whole days with pure UTC arithmetic.
 * Never mixes the Jakarta wall clock with `toISOString()` (which shifts the
 * date back one day), so ±1 always lands exactly one day away, all week long.
 */
export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function nowJakarta(): string {
  const date = new Date()
  const datePart = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const timePart = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  return `${datePart}T${timePart}`
}

export function rupiah(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)
}

export function compactRupiah(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  if (amount >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(amount % 1_000_000_000 === 0 ? 0 : 1)} M`
  if (amount >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)} jt`
  if (amount >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)} rb`
  return rupiah(amount)
}

export function number(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0'
  return new Intl.NumberFormat('id-ID').format(value)
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return ''
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} hari lalu`
  return formatDate(value)
}

export function initials(name: string | null | undefined): string {
  return (name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

export function dateRangeForView(view: 'day' | 'week' | 'month' | 'year', anchor: string): { from: string; to: string } {
  const [year, month, day] = anchor.slice(0, 10).split('-').map(Number)
  if (view === 'day') return { from: anchor, to: anchor }
  if (view === 'week') {
    const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
    const start = addDaysIso(anchor, -weekday)
    return { from: start, to: addDaysIso(start, 6) }
  }
  if (view === 'year') return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` }
  const first = `${anchor.slice(0, 7)}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: first, to: `${anchor.slice(0, 7)}-${String(lastDay).padStart(2, '0')}` }
}

export function monthName(month: number): string {
  return ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][month]
}

export function monthShort(month: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][month]
}

export function statusTone(status: string): { bg: string; text: string } {
  switch (status) {
    case 'Selesai':
      return { bg: 'bg-emerald-50 border border-emerald-200', text: 'text-emerald-700' }
    case 'Berjalan':
      return { bg: 'bg-forest-50 border border-forest/15', text: 'text-forest' }
    case 'Perencanaan':
      return { bg: 'bg-amber-50 border border-amber-200', text: 'text-amber-700' }
    case 'Ditunda':
      return { bg: 'bg-slate-100 border border-slate-200', text: 'text-slate-600' }
    default:
      return { bg: 'bg-slate-100 border border-slate-200', text: 'text-slate-600' }
  }
}

export function priorityTone(priority: string): string {
  if (priority === 'mendesak') return 'bg-red-600 text-white border border-red-700'
  if (priority === 'tinggi') return 'bg-red-50 text-red-700 border border-red-200'
  if (priority === 'rendah') return 'bg-slate-100 text-slate-600 border border-slate-200'
  return 'bg-amber-50 text-amber-700 border border-amber-200'
}

export const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'rendah', label: 'Rendah' },
  { value: 'normal', label: 'Normal' },
  { value: 'tinggi', label: 'Tinggi' },
  { value: 'mendesak', label: 'Mendesak' },
]
