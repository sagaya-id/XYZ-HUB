import { cn } from './ui'
import { number } from '../lib/format'

const FOREST = '#245A46'
const PALETTE = ['#245A46', '#3D7E92', '#B08A4F', '#7C5CBF', '#2F6F8F', '#5D766A', '#B4453C']

export function BarChart({
  data, height = 180, format = (v: number) => number(v), color = FOREST, horizontal = false,
}: {
  data: { label: string; value: number; title?: string }[]
  height?: number
  format?: (value: number) => string
  color?: string
  horizontal?: boolean
}) {
  if (!data.length) return <ChartEmpty />
  const max = Math.max(...data.map((d) => d.value), 1)
  if (horizontal) {
    return (
      <div className="space-y-3">
        {data.map((d, i) => (
          <div key={`${d.label}-${i}`}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium text-ink" title={d.title ?? d.label}>{d.title ?? d.label}</span>
              <span className="shrink-0 text-muted">{format(d.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(d.value / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
              />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="flex items-end gap-2 sm:gap-3" style={{ height }}>
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
          <span className="text-[10px] font-medium text-muted opacity-0 transition-opacity group-hover:opacity-100">{format(d.value)}</span>
          <div
            className="w-full max-w-14 rounded-t-lg transition-all duration-700"
            style={{
              height: `${Math.max(4, (d.value / max) * (height - 34))}px`,
              backgroundColor: color,
              opacity: 0.92,
            }}
            title={`${d.title ?? d.label}: ${format(d.value)}`}
          />
          <span className="w-full truncate text-center text-[10px] text-muted sm:text-[11px]">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

export function DonutChart({
  data, size = 168, thickness = 22, centerLabel, centerValue,
}: {
  data: { label: string; value: number }[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string | number
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  if (!total) return <ChartEmpty />
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EDF0EC" strokeWidth={thickness} />
          {data.map((d, i) => {
            const fraction = d.value / total
            const dash = fraction * circumference
            const circle = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, dash - 2)} ${circumference}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
              />
            )
            offset += dash
            return circle
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold text-ink">{centerValue ?? number(total)}</span>
          {centerLabel && <span className="text-[10px] tracking-wide text-muted uppercase">{centerLabel}</span>}
        </div>
      </div>
      <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-1">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
              <span className="truncate text-muted">{d.label}</span>
            </span>
            <span className="font-medium text-ink">{number(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AreaChart({
  data, height = 170, color = FOREST, format = (v: number) => number(v),
}: { data: { label: string; count: number }[]; height?: number; color?: string; format?: (v: number) => string }) {
  if (!data.length) return <ChartEmpty />
  const width = 520
  const max = Math.max(...data.map((d) => d.count), 1)
  const step = data.length > 1 ? width / (data.length - 1) : width
  const points = data.map((d, i) => {
    const x = i * step
    const y = height - 30 - (d.count / max) * (height - 46)
    return { x, y, ...d }
  })
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = `${line} L${points[points.length - 1].x},${height - 26} L0,${height - 26} Z`
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="none" style={{ height }}>
        <defs>
          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((q) => (
          <line key={q} x1={0} x2={width} y1={height - 30 - q * (height - 46)} y2={height - 30 - q * (height - 46)} stroke="#EDF0EC" strokeWidth="1" />
        ))}
        <path d={area} fill="url(#area-grad)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        {points.map((p) => (
          <g key={p.label}>
            <circle cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke={color} strokeWidth="2" />
            <text x={p.x} y={height - 8} textAnchor="middle" fontSize="11" fill="#687780">{p.label}</text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>Total 6 bulan: {format(data.reduce((s, d) => s + d.count, 0))}</span>
        <span>Bulan ini: {format(data[data.length - 1]?.count ?? 0)}</span>
      </div>
    </div>
  )
}

export function ProgressRing({
  value, size = 86, thickness = 8, label,
}: { value: number; size?: number; thickness?: number; label?: string }) {
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EDF0EC" strokeWidth={thickness} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={FOREST} strokeWidth={thickness}
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-semibold text-ink">{Math.round(clamped)}%</span>
        {label && <span className="text-[9px] tracking-wide text-muted uppercase">{label}</span>}
      </div>
    </div>
  )
}

export function ChartEmpty({ label = 'Belum ada data untuk ditampilkan.' }: { label?: string }) {
  return (
    <div className={cn('grid place-items-center rounded-xl border border-dashed border-line px-4 py-10 text-center text-xs text-muted')}>
      {label}
    </div>
  )
}
