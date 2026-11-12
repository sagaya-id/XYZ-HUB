import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Check, ImagePlus, Loader2, Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { uploadFile } from '../lib/api'
import { initials } from '../lib/format'
import { useApp } from '../lib/app-context'

export const cn = clsx

export function Avatar({
  name, url, size = 36, className,
}: { name: string | null | undefined; url?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className={cn('shrink-0 rounded-full border border-line object-cover', className)}
      />
    )
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
      className={cn('grid shrink-0 place-items-center rounded-full bg-forest-50 font-semibold text-forest', className)}
    >
      {initials(name)}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />
}

export function LoadingBlock({ label = 'Memuat data…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <Spinner /> {label}
    </div>
  )
}

export function Modal({
  open, onClose, title, description, children, footer, size = 'md', placement = 'center',
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  placement?: 'center' | 'right' | 'bottom'
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }
  const shell = placement === 'right'
    ? 'ml-auto h-full w-full sm:max-w-lg rounded-none sm:rounded-l-3xl'
    : placement === 'bottom'
      ? 'mt-auto w-full rounded-t-3xl sm:mt-0 sm:mb-auto sm:max-w-2xl sm:rounded-3xl'
      : `w-full ${widths[size]} rounded-3xl`
  return (
    <div className="fixed inset-0 z-[1500] flex bg-ink/35 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-6" onMouseDown={onClose}>
      <div
        className={cn('flex max-h-[92vh] flex-col overflow-hidden border border-line bg-white shadow-[0_40px_80px_-40px_rgba(31,41,51,0.55)]', shell)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div>
              {title && <h3 className="text-base font-semibold text-ink sm:text-lg">{title}</h3>}
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-sand hover:text-ink" aria-label="Tutup">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="border-t border-line bg-canvas/60 px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open, title, description, confirmLabel = 'Konfirmasi', cancelLabel = 'Batal', onConfirm, onCancel, danger, busy,
}: {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
  busy?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <span className={cn('grid h-8 w-8 place-items-center rounded-full', danger ? 'bg-red-50 text-red-600' : 'bg-forest-50 text-forest')}>
            <AlertTriangle className="h-4 w-4" />
          </span>
          {title}
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : <Check className="h-4 w-4" />} {confirmLabel}
          </button>
        </div>
      }
    >
      {description && <div className="text-sm leading-relaxed text-muted">{description}</div>}
    </Modal>
  )
}

export function Field({
  label, hint, error, required, children, className,
}: { label?: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}

export function SearchInput({
  value, onChange, placeholder = 'Cari…', className,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
      <input className="input pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

export function Segmented<T extends string>({
  options, value, onChange, className,
}: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-full border border-line bg-white p-1', className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
            value === opt.value ? 'bg-forest text-white shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({
  icon: Icon, title, description, action,
}: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-canvas/50 px-6 py-14 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white text-forest shadow-sm">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function PageHeader({
  eyebrow, title, description, actions,
}: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1.5 text-[11px] font-semibold tracking-[0.14em] text-forest uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({
  label, value, hint, icon: Icon, tone = 'default',
}: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: 'default' | 'forest' | 'amber' }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
        {Icon && (
          <span className={cn(
            'grid h-8 w-8 place-items-center rounded-xl',
            tone === 'forest' ? 'bg-forest-50 text-forest' : tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-canvas text-muted',
          )}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-2 text-xl font-semibold text-ink sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function Tabs<T extends string>({
  tabs, value, onChange, className,
}: { tabs: { value: T; label: string; icon?: LucideIcon; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon
        const active = value === tab.value
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={cn(
              'flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
              active ? 'border-forest text-forest' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', active ? 'bg-forest-50 text-forest' : 'bg-canvas text-muted')}>
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function ImageUpload({
  label, value, onChange, projectId, entityId, shape = 'rect', hint, className, capture,
}: {
  label: string
  value: string | null | undefined
  onChange: (fileId: string, url: string) => void
  projectId?: string
  entityId?: string
  shape?: 'rect' | 'circle'
  hint?: string
  className?: string
  capture?: boolean
}) {
  const { toast } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function handleFile(file: File | null) {
    if (!file) return
    setBusy(true)
    try {
      const uploaded = await uploadFile(file, { projectId, entityId })
      onChange(uploaded.id, uploaded.url)
      toast('Berkas berhasil diunggah.')
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengunggah berkas', 'error')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={className}>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'relative grid shrink-0 place-items-center overflow-hidden border border-dashed border-line bg-canvas text-muted transition-colors hover:border-forest/40 hover:bg-forest-50',
            shape === 'circle' ? 'h-16 w-16 rounded-full' : 'h-20 w-28 rounded-xl',
          )}
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : busy ? (
            <Spinner />
          ) : (
            <ImagePlus className="h-5 w-5" />
          )}
        </button>
        <div className="text-xs text-muted">
          <button type="button" className="btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Mengunggah…' : 'Pilih dari perangkat'}
          </button>
          <p className="mt-1.5">{hint ?? 'PNG, JPG, WEBP maks. 10 MB'}</p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(capture ? { capture: 'environment' as any } : {})}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
    </div>
  )
}

export function ProgressBar({ value, className, tone = 'forest' }: { value: number; className?: string; tone?: 'forest' | 'amber' | 'blue' }) {
  const color = tone === 'amber' ? 'bg-amber-500' : tone === 'blue' ? 'bg-sky-600' : 'bg-forest'
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export function VisibilityBadge({ visibility }: { visibility: 'team' | 'entity' }) {
  return (
    <span className={cn('badge', visibility === 'team' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800')}>
      {visibility === 'team' ? 'Khusus Tim' : 'Seluruh Entitas'}
    </span>
  )
}
