import { useRef, useState } from 'react'
import { ImageUp, Pipette, RotateCcw, X } from 'lucide-react'
import { uploadFile } from '../lib/api'
import { useApp } from '../lib/app-context'
import { Spinner, cn } from './ui'

export const MARKER_DEFAULT_COLOR = '#245A46'

export const MARKER_COLORS: { value: string; label: string }[] = [
  { value: '#EA4335', label: 'Merah Google Maps' },
  { value: '#245A46', label: 'Hijau hutan' },
  { value: '#2563EB', label: 'Biru' },
  { value: '#F59E0B', label: 'Oranye' },
  { value: '#7C3AED', label: 'Ungu' },
  { value: '#1F2933', label: 'Hitam' },
]

export type MarkerStyleValue = { color: string; iconId: string | null; iconUrl: string | null }

type Props = {
  color: string
  iconId?: string | null
  iconUrl?: string | null
  projectId: string
  onChange: (next: MarkerStyleValue) => void
  onReset: () => void
  disabled?: boolean
}

/** Compact colour swatches + custom icon upload shared by the map, add and edit forms. */
export function MarkerStyleControls({ color, iconId, iconUrl, projectId, onChange, onReset, disabled }: Props) {
  const { toast } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function uploadIcon(file: File | null) {
    if (!file) return
    setUploading(true)
    try {
      const uploaded = await uploadFile(file, { projectId })
      onChange({ color, iconId: uploaded.id, iconUrl: uploaded.url })
      toast('Lambang marker diunggah.')
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengunggah lambang marker.', 'error')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="label">Warna marker</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {MARKER_COLORS.map((preset) => {
            const active = color.toLowerCase() === preset.value.toLowerCase()
            return (
              <button
                key={preset.value}
                type="button"
                title={preset.label}
                aria-label={preset.label}
                disabled={disabled}
                onClick={() => onChange({ color: preset.value, iconId: iconId ?? null, iconUrl: iconUrl ?? null })}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-50',
                  active ? 'border-ink' : 'border-white',
                  'shadow-[0_1px_3px_rgba(31,41,51,0.35)]',
                )}
                style={{ backgroundColor: preset.value }}
              />
            )
          })}
          <label
            className="relative grid h-6 w-6 cursor-pointer place-items-center rounded-full border border-line bg-white text-muted hover:text-ink"
            title="Warna kustom"
          >
            <Pipette className="h-3 w-3" />
            <input
              type="color"
              value={color}
              disabled={disabled}
              onChange={(event) => onChange({ color: event.target.value, iconId: iconId ?? null, iconUrl: iconUrl ?? null })}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Warna kustom"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? <Spinner className="h-3.5 w-3.5" /> : <ImageUp className="h-3.5 w-3.5" />} Unggah lambang
        </button>
        {iconUrl && (
          <span className="relative inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-1 pr-1.5 pl-1">
            <img src={iconUrl} alt="Lambang marker" className="h-5 w-5 rounded-full border border-line object-cover" />
            <button
              type="button"
              onClick={() => onChange({ color, iconId: null, iconUrl: null })}
              className="grid h-4 w-4 place-items-center rounded-full text-muted hover:bg-canvas hover:text-ink"
              aria-label="Hapus lambang"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <button type="button" className="btn-ghost btn-sm ml-auto" onClick={onReset} disabled={disabled}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset ke Pin Standar
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(event) => uploadIcon(event.target.files?.[0] ?? null)}
        />
      </div>
      <p className="text-[10px] text-muted">
        Lambang akan tampil di tengah pin; pilih PNG/SVG/JPG/WEBP dengan latar transparan agar rapi.
      </p>
    </div>
  )
}
