import { useMemo, useState } from 'react'
import { cn } from './ui'
import type { EventItem } from '../lib/types'
import { monthName, monthShort } from '../lib/format'

const DAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

function parseIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfGrid(anchor: string): Date {
  const base = parseIso(anchor)
  const first = new Date(base.getFullYear(), base.getMonth(), 1)
  const weekday = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - weekday)
  return start
}

function sortEvents(events: EventItem[]): EventItem[] {
  return [...events].sort((a, b) => {
    if (a.all_day !== b.all_day) return a.all_day ? -1 : 1
    return a.start_local.localeCompare(b.start_local)
  })
}

function eventLabel(event: EventItem): string {
  // Indonesian agenda style inside month cells: "08.00 Monitoring Lapangan".
  if (event.all_day) return event.title
  return `${event.time_label.replace(':', '.')} ${event.title}`
}

export type CalendarProps = {
  view: 'day' | 'week' | 'month' | 'year'
  anchor: string
  events: EventItem[]
  holidays: Record<string, string>
  onEventClick: (event: EventItem) => void
  onDayClick: (date: string, events: EventItem[]) => void
  onMonthClick?: (monthIndex: number) => void
  onViewChange?: (view: CalendarProps['view']) => void
}

export function CalendarView({
  view, anchor, events, holidays, onEventClick, onDayClick, onMonthClick,
}: CalendarProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, EventItem[]>()
    for (const event of events) {
      const key = event.date || event.start_local.slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(event)
    }
    for (const [key, list] of map) map.set(key, sortEvents(list))
    return map
  }, [events])

  if (view === 'year') {
    return <YearView anchor={anchor} grouped={grouped} onDayClick={onDayClick} onMonthClick={onMonthClick} holidays={holidays} />
  }
  if (view === 'week') return <WeekView anchor={anchor} grouped={grouped} onEventClick={onEventClick} onDayClick={onDayClick} holidays={holidays} />
  if (view === 'day') return <DayView anchor={anchor} grouped={grouped} onEventClick={onEventClick} holidays={holidays} />
  return <MonthView anchor={anchor} grouped={grouped} onEventClick={onEventClick} onDayClick={onDayClick} holidays={holidays} />
}

function MonthView({
  anchor, grouped, onEventClick, onDayClick, holidays,
}: {
  anchor: string
  grouped: Map<string, EventItem[]>
  onEventClick: (event: EventItem) => void
  onDayClick: (date: string, events: EventItem[]) => void
  holidays: Record<string, string>
}) {
  const base = parseIso(anchor)
  const start = startOfGrid(anchor)
  const today = toIso(new Date())
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    cells.push(date)
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="grid grid-cols-7 border-b border-line bg-canvas/60">
        {DAY_LABELS.map((label) => (
          <div key={label} className="px-1 py-2 text-center text-[10px] font-semibold tracking-wide text-muted uppercase sm:px-2 sm:text-[11px]">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, index) => {
          const iso = toIso(date)
          const dayEvents = grouped.get(iso) ?? []
          const isCurrentMonth = date.getMonth() === base.getMonth()
          const isToday = iso === today
          const holiday = holidays[iso]
          const visible = dayEvents.slice(0, 2)
          return (
            <button
              key={iso}
              onClick={() => onDayClick(iso, dayEvents)}
              className={cn(
                'cal-cell cal-cell-mobile relative flex flex-col items-stretch gap-1 border-r border-b border-line p-1 text-left align-top transition-colors last:border-r-0 sm:p-1.5',
                !isCurrentMonth && 'bg-canvas/40',
                index % 7 === 6 && 'border-r-0',
                'hover:bg-forest-50/50',
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    'grid h-5 w-5 place-items-center rounded-full text-[11px] font-medium sm:h-6 sm:w-6 sm:text-xs',
                    isToday ? 'bg-forest text-white' : isCurrentMonth ? 'text-ink' : 'text-muted/60',
                  )}
                >
                  {date.getDate()}
                </span>
                {holiday && <span className="hidden truncate text-[9px] text-red-600 sm:block" title={holiday}>Libur</span>}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-0.5">
                {visible.map((event) => (
                  <span
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onEventClick(event) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onEventClick(event) } }}
                    className="flex w-full min-w-0 items-center gap-1 rounded px-0.5 py-0.5 text-[9.5px] leading-tight hover:bg-white sm:px-1 sm:text-[11px]"
                    title={eventLabel(event)}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: event.category_color ?? '#245A46' }} />
                    <span className="truncate text-ink">{eventLabel(event)}</span>
                  </span>
                ))}
                {dayEvents.length > 2 && (
                  <span className="px-0.5 text-[9px] font-medium text-forest sm:px-1 sm:text-[10px]">
                    +{dayEvents.length - 2} lagi
                  </span>
                )}
              </div>
              {holiday && (
                <span className="truncate text-[8px] text-red-600 sm:hidden">{eventLabel({
                  ...({} as EventItem), title: holiday, all_day: true, time_label: '', id: 'h',
                })}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({
  anchor, grouped, onEventClick, onDayClick, holidays,
}: {
  anchor: string
  grouped: Map<string, EventItem[]>
  onEventClick: (event: EventItem) => void
  onDayClick: (date: string, events: EventItem[]) => void
  holidays: Record<string, string>
}) {
  const start = startOfGrid(anchor)
  const day = (parseIso(anchor).getDay() + 6) % 7
  const monday = new Date(parseIso(anchor))
  monday.setDate(monday.getDate() - day)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    return date
  })
  const today = toIso(new Date())
  void start

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
        {days.map((date) => {
          const iso = toIso(date)
          const list = grouped.get(iso) ?? []
          return (
            <div key={iso} className="flex min-h-[130px] flex-col rounded-2xl border border-line bg-white p-2.5">
              <button onClick={() => onDayClick(iso, list)} className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">{DAY_LABELS[(date.getDay() + 6) % 7]}</span>
                <span className={cn('grid h-6 w-6 place-items-center rounded-full text-xs font-medium', iso === today ? 'bg-forest text-white' : 'text-ink')}>
                  {date.getDate()}
                </span>
              </button>
              {holidays[iso] && <p className="mb-1 truncate text-[10px] text-red-600">{holidays[iso]}</p>}
              <div className="flex-1 space-y-1">
                {list.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className="w-full truncate rounded-md px-1.5 py-1 text-left text-[11px] leading-tight hover:bg-canvas"
                    style={{ borderLeft: `3px solid ${event.category_color ?? '#245A46'}` }}
                  >
                    {eventLabel(event)}
                  </button>
                ))}
                {list.length === 0 && <p className="text-[10px] text-muted/70">—</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayView({
  anchor, grouped, onEventClick, holidays,
}: {
  anchor: string
  grouped: Map<string, EventItem[]>
  onEventClick: (event: EventItem) => void
  holidays: Record<string, string>
}) {
  const list = grouped.get(anchor) ?? []
  return (
    <div className="rounded-2xl border border-line bg-white p-4 sm:p-6">
      {holidays[anchor] && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Libur nasional: {holidays[anchor]}
        </div>
      )}
      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Tidak ada agenda pada hari ini.</p>
      ) : (
        <div className="space-y-2">
          {list.map((event) => (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className="flex w-full items-start gap-3 rounded-xl border border-line px-3 py-3 text-left hover:bg-canvas"
            >
              <span className="w-14 shrink-0 text-xs font-semibold text-forest">{event.all_day ? 'Sepanjang hari' : event.time_label}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{event.title}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {event.project_title ?? 'Agenda entitas'} {event.location ? `· ${event.location}` : ''}
                </span>
              </span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: event.category_color ?? '#245A46' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function YearView({
  anchor, grouped, onDayClick, onMonthClick, holidays,
}: {
  anchor: string
  grouped: Map<string, EventItem[]>
  onDayClick: (date: string, events: EventItem[]) => void
  onMonthClick?: (month: number) => void
  holidays: Record<string, string>
}) {
  const year = parseIso(anchor).getFullYear()
  const [hover, setHover] = useState<string | null>(null)
  const months = Array.from({ length: 12 }, (_, m) => {
    const first = new Date(year, m, 1)
    const offset = (first.getDay() + 6) % 7
    const daysInMonth = new Date(year, m + 1, 0).getDate()
    const cells: (string | null)[] = Array.from({ length: offset }, () => null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(toIso(new Date(year, m, d)))
    while (cells.length % 7 !== 0) cells.push(null)
    return { month: m, cells }
  })
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {months.map(({ month, cells }) => {
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
        const count = [...grouped.entries()].filter(([key]) => key.startsWith(monthKey)).reduce((sum, [, list]) => sum + list.length, 0)
        return (
          <div key={month} className="rounded-2xl border border-line bg-white p-3">
            <button onClick={() => onMonthClick?.(month)} className="mb-2 flex w-full items-center justify-between">
              <span className="text-sm font-semibold text-ink">{monthName(month)}</span>
              <span className="text-[10px] text-muted">{count} agenda</span>
            </button>
            <div className="grid grid-cols-7 gap-y-1">
              {['S', 'S', 'R', 'K', 'J', 'S', 'M'].map((d, i) => (
                <span key={`${d}-${i}`} className="text-center text-[8px] text-muted">{d}</span>
              ))}
              {cells.map((iso, i) => {
                if (!iso) return <span key={`empty-${i}`} />
                const list = grouped.get(iso) ?? []
                const isHoliday = !!holidays[iso]
                return (
                  <button
                    key={iso}
                    onClick={() => onDayClick(iso, list)}
                    onMouseEnter={() => setHover(iso)}
                    onMouseLeave={() => setHover(null)}
                    title={`${iso}${list.length ? ` · ${list.length} agenda` : ''}`}
                    className={cn(
                      'relative mx-auto grid h-5 w-5 place-items-center rounded-full text-[9px] hover:bg-forest-50',
                      isHoliday ? 'text-red-600' : 'text-ink',
                      hover === iso && 'bg-forest-50',
                    )}
                  >
                    {Number(iso.slice(8, 10))}
                    {list.length > 0 && (
                      <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-forest" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function AgendaList({
  events, onEventClick, emptyLabel = 'Tidak ada agenda.',
}: { events: EventItem[]; onEventClick: (event: EventItem) => void; emptyLabel?: string }) {
  if (!events.length) return <p className="py-6 text-center text-sm text-muted">{emptyLabel}</p>
  return (
    <div className="divide-y divide-line">
      {events.map((event) => (
        <button key={event.id} onClick={() => onEventClick(event)} className="flex w-full items-start gap-3 px-1 py-2.5 text-left hover:bg-canvas/70">
          <span className="w-12 shrink-0 text-xs font-semibold text-forest">{event.all_day ? '—' : event.time_label}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{event.title}</span>
            <span className="block truncate text-[11px] text-muted">
              {event.project_title ?? 'Agenda entitas'}{event.location ? ` · ${event.location}` : ''}
            </span>
          </span>
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: event.category_color ?? '#245A46' }} />
        </button>
      ))}
    </div>
  )
}

export { monthName, monthShort }
