import { useState } from 'react'
import { Coins, Info, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useApp, useAsync } from '../../lib/app-context'
import type { Budget, ProjectDetail } from '../../lib/types'
import { ConfirmDialog, Field, LoadingBlock, Spinner, VisibilityBadge, cn } from '../../components/ui'
import { formatDateTime, number, rupiah } from '../../lib/format'

type BudgetResponse = {
  budget: Budget | null
  history: any[]
  can_edit: boolean
  note: string
}

export function BudgetTab({ project, reload }: { project: ProjectDetail['project']; reload: () => void }) {
  const { toast } = useApp()
  const { data, loading, reload: reloadBudget } = useAsync<BudgetResponse>(
    () => api.get(`/api/projects/${project.id}/budget`),
    [project.id],
  )
  const [form, setForm] = useState<{ amount: string; confirmed: boolean; visibility: 'team' | 'entity'; note: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [reconfirm, setReconfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <LoadingBlock label="Memuat anggaran…" />
  if (!data) {
    return <div className="card p-6 text-center text-sm text-muted">Anggaran proyek ini bersifat khusus tim.</div>
  }

  const budget = data.budget
  const canEdit = data.can_edit
  const current = form ?? {
    amount: String(budget?.amount ?? 0),
    confirmed: !!budget?.is_confirmed,
    visibility: (budget?.visibility ?? 'team') as 'team' | 'entity',
    note: '',
  }

  function update(patch: Partial<typeof current>) {
    setForm({ ...current, ...patch })
  }

  async function submit(confirmReconfirm = false) {
    setBusy(true)
    setError(null)
    try {
      await api.put(`/api/projects/${project.id}/budget`, {
        amount: Number(String(current.amount).replace(/[^\d]/g, '')) || 0,
        isConfirmed: current.confirmed,
        visibility: current.visibility,
        note: current.note || null,
        confirmReconfirm,
      })
      toast('Anggaran disimpan.')
      setForm(null)
      setReconfirm(false)
      reloadBudget()
      reload()
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'BUDGET_RECONFIRM_REQUIRED') {
        setReconfirm(true)
      } else {
        setError(err?.message ?? 'Gagal menyimpan anggaran.')
      }
    } finally {
      setBusy(false)
    }
  }

  const confirmedTotal = budget?.is_confirmed ? budget.amount : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <section className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Nominal anggaran</h2>
              <p className="muted mt-0.5">Sederhana: satu nominal, satu status kepastian.</p>
            </div>
            <Coins className="h-5 w-5 text-forest" />
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-canvas/50 p-4">
            <p className="text-[10px] tracking-wide text-muted uppercase">Anggaran tercatat</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{rupiah(budget?.amount ?? 0)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={cn('badge', budget?.is_confirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
                {budget?.is_confirmed ? 'Anggaran sudah pasti' : 'Belum pasti'}
              </span>
              <VisibilityBadge visibility={budget?.visibility ?? 'team'} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{data.note}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-line px-3 py-2">
              <p className="text-[10px] text-muted uppercase">Total resmi</p>
              <p className="text-sm font-semibold text-ink">{rupiah(confirmedTotal)}</p>
            </div>
            <div className="rounded-xl border border-line px-3 py-2">
              <p className="text-[10px] text-muted uppercase">Usulan (tidak dihitung)</p>
              <p className="text-sm font-semibold text-ink">{rupiah(budget?.is_confirmed ? 0 : (budget?.amount ?? 0))}</p>
            </div>
          </div>

          {canEdit ? (
            <div className="mt-5 space-y-3 border-t border-line pt-4">
              <Field label="Nominal anggaran (Rp)" hint="Masukkan angka tanpa titik atau koma.">
                <input
                  className="input"
                  inputMode="numeric"
                  value={current.amount}
                  onChange={(e) => update({ amount: e.target.value.replace(/[^\d]/g, '') })}
                />
              </Field>
              <p className="text-xs text-muted">Terbaca: {rupiah(Number(current.amount) || 0)}</p>
              <label className="flex items-start gap-2.5 rounded-xl border border-line bg-canvas/50 p-3 text-sm">
                <input type="checkbox" className="mt-0.5" checked={current.confirmed} onChange={(e) => update({ confirmed: e.target.checked })} />
                <span>
                  <span className="block font-medium text-ink">Anggaran sudah pasti</span>
                  <span className="block text-xs text-muted">
                    Jika dicentang, nominal dihitung pada total resmi dan grafik. Jika tidak, nominal tetap tersimpan sebagai usulan.
                  </span>
                </span>
              </label>
              <Field label="Privasi anggaran">
                <select className="input" value={current.visibility} onChange={(e) => update({ visibility: e.target.value as any })}>
                  <option value="team">Khusus tim proyek</option>
                  <option value="entity">Seluruh entitas</option>
                </select>
              </Field>
              <Field label="Catatan perubahan (opsional)">
                <input className="input" value={current.note} onChange={(e) => update({ note: e.target.value })} placeholder="Alasan atau konteks perubahan" />
              </Field>
              {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
              <button className="btn-primary w-full" onClick={() => submit()} disabled={busy}>
                {busy ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} Simpan anggaran
              </button>
            </div>
          ) : (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-canvas/60 px-3 py-2 text-[11px] text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Hanya PIC/PA proyek, Super Admin, dan Master Admin yang dapat mengubah nominal.
            </p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="section-title">Riwayat perubahan</h2>
          <p className="muted mt-0.5">Setiap perubahan nominal tercatat.</p>
          <div className="mt-4 space-y-2">
            {data.history.length === 0 && <p className="text-xs text-muted">Belum ada riwayat.</p>}
            {data.history.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-line px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-ink">{rupiah(entry.amount)}</p>
                  <span className={cn('badge', entry.is_confirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
                    {entry.is_confirmed ? 'Pasti' : 'Usulan'}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-muted">
                  {entry.changed_by_name ?? '—'} · {formatDateTime(entry.changed_at)}
                </p>
                {entry.note && <p className="mt-1 text-[11px] text-muted">{entry.note}</p>}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-canvas/60 px-3 py-2 text-[10px] leading-relaxed text-muted">
            Total agregat hanya menjumlahkan anggaran berstatus pasti yang boleh dilihat oleh pengguna saat ini.
            Nilai pengeluaran tidak dibuat-buat karena modul realisasi belum tersedia.
          </div>
          <p className="mt-2 text-[10px] text-muted">Jumlah catatan: {number(data.history.length)}</p>
        </section>
      </div>

      <ConfirmDialog
        open={reconfirm}
        title="Konfirmasi ulang anggaran"
        description={
          <span>
            Nominal anggaran yang sudah berstatus <strong>pasti</strong> akan berubah menjadi{' '}
            <strong>{rupiah(Number(current.amount) || 0)}</strong>. Perubahan ini akan memengaruhi total resmi.
            Lanjutkan?
          </span>
        }
        confirmLabel="Ya, perbarui"
        busy={busy}
        onCancel={() => setReconfirm(false)}
        onConfirm={() => submit(true)}
      />
    </div>
  )
}
