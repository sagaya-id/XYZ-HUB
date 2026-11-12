import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso, parseJson } from '../db'
import { HttpError, canSeeVisibility, isAdminOf, loadProject } from '../scope'
import { audit } from '../lib'

export const dataRoutes = new Hono<AppEnv>()

type FieldDef = { id: string; key: string; label: string; type: string; sensitive: number }

async function ensureFields(env: any, projectId: string, defs: { key: string; label: string; type?: string }[]): Promise<FieldDef[]> {
  const existing = await q<any>(env.DB, `SELECT * FROM data_fields WHERE project_id = ? ORDER BY position`, projectId)
  const byKey = new Map(existing.map((f) => [f.key, f]))
  let position = existing.length
  for (const def of defs) {
    if (!def.key || byKey.has(def.key)) continue
    const id = uid('fld_')
    await run(
      env.DB,
      `INSERT INTO data_fields (id, project_id, key, label, type, position, sensitive) VALUES (?,?,?,?,?,?,0)`,
      id, projectId, def.key, def.label || def.key, def.type || 'text', position++,
    )
    byKey.set(def.key, { id, project_id: projectId, key: def.key, label: def.label || def.key, type: def.type || 'text', sensitive: 0 })
  }
  return [...byKey.values()]
}

dataRoutes.get('/projects/:id/data', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  const fields = await q<any>(c.env.DB, `SELECT * FROM data_fields WHERE project_id = ? ORDER BY position`, project.id)
  const all = await q<any>(
    c.env.DB,
    `SELECT r.*, u.name AS created_by_name FROM data_records r LEFT JOIN users u ON u.id = r.created_by
     WHERE r.project_id = ? ORDER BY r.created_at DESC`,
    project.id,
  )
  const visible = all.filter((r) => canSeeVisibility(user, r.visibility, project, member))
  const imports = await q<any>(
    c.env.DB,
    `SELECT i.*, u.name AS user_name FROM data_imports i LEFT JOIN users u ON u.id = i.user_id
     WHERE i.project_id = ? ORDER BY i.created_at DESC LIMIT 20`,
    project.id,
  )
  const sheet = await one<any>(c.env.DB, `SELECT * FROM sheet_links WHERE project_id = ?`, project.id)
  return c.json({
    fields,
    records: visible.map((r) => ({ ...r, data: parseJson<any>(r.data, {}) })),
    imports,
    sheet: sheet ? { ...sheet, mapping: parseJson<any>(sheet.mapping, null) } : null,
    can_contribute: !!member || isAdminOf(user, project, member),
    googleSheetsConfigured: false,
  })
})

dataRoutes.post('/projects/:id/data/fields', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const key = String(body.key ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  if (!key) return c.json({ error: 'Nama kolom tidak valid.' }, 400)
  const existing = await one<any>(c.env.DB, `SELECT id FROM data_fields WHERE project_id = ? AND key = ?`, project.id, key)
  if (existing) return c.json({ error: 'Kolom sudah ada.' }, 409)
  const position = await one<any>(c.env.DB, `SELECT COUNT(*) AS n FROM data_fields WHERE project_id = ?`, project.id)
  const id = uid('fld_')
  await run(
    c.env.DB,
    `INSERT INTO data_fields (id, project_id, key, label, type, position, sensitive) VALUES (?,?,?,?,?,?,?)`,
    id, project.id, key, body.label || key, body.type || 'text', position?.n ?? 0, body.sensitive ? 1 : 0,
  )
  await audit(c.env, user, 'data.field_created', 'project', project.id, `Menambah kolom data ${body.label || key}`, project.entity_id)
  return c.json({ field: await one<any>(c.env.DB, `SELECT * FROM data_fields WHERE id = ?`, id) })
})

dataRoutes.delete('/data/fields/:fieldId', async (c) => {
  const user = c.get('user')
  const field = await one<any>(c.env.DB, `SELECT * FROM data_fields WHERE id = ?`, c.req.param('fieldId'))
  if (!field) return c.json({ error: 'Kolom tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, field.project_id)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek.')
  await run(c.env.DB, `DELETE FROM data_fields WHERE id = ?`, field.id)
  return c.json({ ok: true })
})

dataRoutes.post('/projects/:id/data/records', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const data = body.data ?? {}
  if (!Object.keys(data).length) return c.json({ error: 'Data tidak boleh kosong.' }, 400)
  const fields = body.fields ? await ensureFields(c.env, project.id, body.fields) : []
  const id = uid('rec_')
  await run(
    c.env.DB,
    `INSERT INTO data_records (id, project_id, data, visibility, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    id, project.id, JSON.stringify(data), body.visibility === 'entity' ? 'entity' : 'team', user.id, nowIso(), nowIso(),
  )
  await audit(c.env, user, 'data.record_created', 'project', project.id, `Menambah baris data pada ${project.title}`, project.entity_id, { fields: fields.length })
  return c.json({ id })
})

dataRoutes.patch('/data/records/:recordId', async (c) => {
  const user = c.get('user')
  const record = await one<any>(c.env.DB, `SELECT * FROM data_records WHERE id = ?`, c.req.param('recordId'))
  if (!record) return c.json({ error: 'Baris tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, record.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const merged = body.replace ? { ...body.data } : { ...parseJson<any>(record.data, {}), ...(body.data ?? {}) }
  await run(
    c.env.DB,
    `UPDATE data_records SET data = ?, visibility = ?, updated_at = ? WHERE id = ?`,
    JSON.stringify(merged), body.visibility ?? record.visibility, nowIso(), record.id,
  )
  await audit(c.env, user, 'data.record_updated', 'project', project.id, `Mengubah baris data pada ${project.title}`, project.entity_id)
  return c.json({ ok: true, record: { ...record, data: merged } })
})

dataRoutes.delete('/data/records/:recordId', async (c) => {
  const user = c.get('user')
  const record = await one<any>(c.env.DB, `SELECT * FROM data_records WHERE id = ?`, c.req.param('recordId'))
  if (!record) return c.json({ error: 'Baris tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, record.project_id)
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  await run(c.env.DB, `DELETE FROM data_records WHERE id = ?`, record.id)
  return c.json({ ok: true })
})

dataRoutes.post('/projects/:id/data/import', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const rows: any[] = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) return c.json({ error: 'Tidak ada baris untuk diimpor.' }, 400)
  if (rows.length > 5000) return c.json({ error: 'Maksimum 5000 baris per impor.' }, 400)
  const mode = ['append', 'update', 'skip'].includes(body.mode) ? body.mode : 'append'
  const dedupeField: string = String(body.dedupeField ?? '')
  const fieldDefs: { key: string; label: string; type?: string }[] =
    Array.isArray(body.fields) && body.fields.length
      ? body.fields
      : Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
  await ensureFields(c.env, project.id, fieldDefs)
  const existingRows = await q<any>(c.env.DB, `SELECT * FROM data_records WHERE project_id = ?`, project.id)
  const existingByValue = new Map<string, any>()
  for (const r of existingRows) {
    const data = parseJson<any>(r.data, {})
    if (dedupeField && data[dedupeField] !== undefined) existingByValue.set(String(data[dedupeField]).trim().toLowerCase(), r)
  }
  let inserted = 0
  let updated = 0
  let skipped = 0
  const seen = new Set<string>()
  for (const row of rows) {
    const value = dedupeField ? String(row[dedupeField] ?? '').trim().toLowerCase() : ''
    const match = value ? existingByValue.get(value) : undefined
    if (value && seen.has(value) && mode !== 'append') { skipped++; continue }
    if (value) seen.add(value)
    if (match) {
      if (mode === 'skip') { skipped++; continue }
      if (mode === 'update') {
        const merged = { ...parseJson<any>(match.data, {}), ...row }
        await run(c.env.DB, `UPDATE data_records SET data = ?, updated_at = ? WHERE id = ?`, JSON.stringify(merged), nowIso(), match.id)
        updated++
        continue
      }
    }
    const id = uid('rec_')
    await run(
      c.env.DB,
      `INSERT INTO data_records (id, project_id, data, visibility, row_source, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      id, project.id, JSON.stringify(row), 'team', body.filename ?? 'import', user.id, nowIso(), nowIso(),
    )
    inserted++
  }
  await run(
    c.env.DB,
    `INSERT INTO data_imports (id, project_id, user_id, filename, source, mode, inserted, updated, skipped, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    uid('imp_'), project.id, user.id, body.filename ?? 'impor', body.source ?? 'file', mode, inserted, updated, skipped, nowIso(),
  )
  await audit(
    c.env, user, 'data.imported', 'project', project.id,
    `Impor data ${body.filename ?? ''} ke ${project.title}: +${inserted} / ~${updated} / -${skipped}`,
    project.entity_id, { mode, dedupeField },
  )
  return c.json({ inserted, updated, skipped, mode })
})

dataRoutes.get('/projects/:id/data/imports', async (c) => {
  const user = c.get('user')
  const { project } = await loadProject(c.env, user, c.req.param('id'))
  const rows = await q<any>(
    c.env.DB,
    `SELECT i.*, u.name AS user_name FROM data_imports i LEFT JOIN users u ON u.id = i.user_id
     WHERE i.project_id = ? ORDER BY i.created_at DESC LIMIT 50`,
    project.id,
  )
  return c.json({ imports: rows })
})

// ---------- Google Sheets (public link based) ----------

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch === '\r') continue
    else field += ch
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function sheetCsvUrl(url: string, worksheet?: string | null): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!match) return null
  const id = match[1]
  const gidMatch = url.match(/[#&?]gid=([0-9]+)/)
  const gid = worksheet || gidMatch?.[1]
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`
}

async function fetchSheetRows(url: string, worksheet?: string | null) {
  const csvUrl = sheetCsvUrl(url, worksheet)
  if (!csvUrl) throw new HttpError(400, 'Tautan Google Sheets tidak valid.')
  const res = await fetch(csvUrl, { headers: { 'user-agent': 'XYZProjectHub/1.0' } })
  if (!res.ok) throw new HttpError(400, `Google Sheets menolak permintaan (${res.status}). Pastikan sheet dibagikan "Anyone with the link".`)
  const text = await res.text()
  if (text.trim().startsWith('<')) throw new HttpError(400, 'Sheet tidak dapat dibaca publik. Ubah akses menjadi "Anyone with the link".')
  const table = parseCsv(text)
  if (!table.length) throw new HttpError(400, 'Sheet kosong.')
  const headers = table[0].map((h, i) => (h.trim() || `kolom_${i + 1}`))
  const rows = table.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim() })
    return obj
  })
  return { headers, rows }
}

dataRoutes.put('/projects/:id/sheets', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat menghubungkan sheet.')
  const body = await c.req.json().catch(() => ({}))
  const url = String(body.url ?? '').trim()
  if (!sheetCsvUrl(url, body.worksheet)) return c.json({ error: 'Tautan Google Sheets tidak valid.' }, 400)
  try {
    await fetchSheetRows(url, body.worksheet)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Tidak dapat membaca sheet.' }, 400)
  }
  const existing = await one<any>(c.env.DB, `SELECT * FROM sheet_links WHERE project_id = ?`, project.id)
  if (existing) {
    await run(c.env.DB, `UPDATE sheet_links SET url = ?, worksheet = ?, status = 'terhubung' WHERE project_id = ?`, url, body.worksheet ?? null, project.id)
  } else {
    await run(
      c.env.DB,
      `INSERT INTO sheet_links (id, project_id, url, worksheet, last_sync_at, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      uid('shl_'), project.id, url, body.worksheet ?? null, null, 'terhubung', user.id, nowIso(),
    )
  }
  await audit(c.env, user, 'sheets.linked', 'project', project.id, `Menghubungkan Google Sheets ke ${project.title}`, project.entity_id)
  return c.json({ ok: true })
})

dataRoutes.delete('/projects/:id/sheets', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek.')
  await run(c.env.DB, `DELETE FROM sheet_links WHERE project_id = ?`, project.id)
  return c.json({ ok: true })
})

dataRoutes.post('/projects/:id/sheets/preview', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const link = await one<any>(c.env.DB, `SELECT * FROM sheet_links WHERE project_id = ?`, project.id)
  if (!link) return c.json({ error: 'Belum ada Google Sheets yang terhubung.' }, 400)
  const body = await c.req.json().catch(() => ({}))
  const dedupeField = String(body.dedupeField ?? '')
  let sheet: { headers: string[]; rows: Record<string, string>[] }
  try {
    sheet = await fetchSheetRows(link.url, link.worksheet)
  } catch (err: any) {
    await run(c.env.DB, `UPDATE sheet_links SET status = ? WHERE id = ?`, `gagal: ${err.message}`.slice(0, 180), link.id)
    return c.json({ error: err.message ?? 'Sinkronisasi gagal.' }, 400)
  }
  const existingRows = await q<any>(c.env.DB, `SELECT * FROM data_records WHERE project_id = ?`, project.id)
  const byValue = new Map<string, any>()
  for (const r of existingRows) {
    const data = parseJson<any>(r.data, {})
    if (dedupeField && data[dedupeField] !== undefined) byValue.set(String(data[dedupeField]).trim().toLowerCase(), data)
  }
  const added: any[] = []
  const changed: any[] = []
  const unchanged: any[] = []
  for (const row of sheet.rows) {
    const value = dedupeField ? String(row[dedupeField] ?? '').trim().toLowerCase() : ''
    const local = value ? byValue.get(value) : undefined
    if (!local) added.push(row)
    else {
      const diffs: string[] = []
      for (const key of Object.keys(row)) {
        const localVal = local[key] === undefined ? '' : String(local[key])
        if (localVal !== String(row[key] ?? '')) diffs.push(key)
      }
      if (diffs.length) changed.push({ row, local, diffs })
      else unchanged.push(row)
    }
  }
  return c.json({
    headers: sheet.headers,
    totalRemote: sheet.rows.length,
    totalLocal: existingRows.length,
    added: added.slice(0, 100),
    changed: changed.slice(0, 100).map((c2) => ({ ...c2, local: undefined })),
    counts: { added: added.length, changed: changed.length, unchanged: unchanged.length },
    requiresDedupeField: !dedupeField,
  })
})

dataRoutes.post('/projects/:id/sheets/sync', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat menyinkronkan sheet.')
  const link = await one<any>(c.env.DB, `SELECT * FROM sheet_links WHERE project_id = ?`, project.id)
  if (!link) return c.json({ error: 'Belum ada Google Sheets yang terhubung.' }, 400)
  const body = await c.req.json().catch(() => ({}))
  const dedupeField = String(body.dedupeField ?? '')
  let sheet: { headers: string[]; rows: Record<string, string>[] }
  try {
    sheet = await fetchSheetRows(link.url, link.worksheet)
  } catch (err: any) {
    await run(c.env.DB, `UPDATE sheet_links SET status = ? WHERE id = ?`, `gagal: ${err.message}`.slice(0, 180), link.id)
    return c.json({ error: err.message ?? 'Sinkronisasi gagal.' }, 400)
  }
  await ensureFields(c.env, project.id, sheet.headers.map((h) => ({ key: h, label: h })))
  const existingRows = await q<any>(c.env.DB, `SELECT * FROM data_records WHERE project_id = ?`, project.id)
  const byValue = new Map<string, any>()
  for (const r of existingRows) {
    const data = parseJson<any>(r.data, {})
    if (dedupeField && data[dedupeField] !== undefined) byValue.set(String(data[dedupeField]).trim().toLowerCase(), r)
  }
  let inserted = 0
  let updated = 0
  let skipped = 0
  for (const row of sheet.rows) {
    const value = dedupeField ? String(row[dedupeField] ?? '').trim().toLowerCase() : ''
    const local = value ? byValue.get(value) : undefined
    if (local) {
      if (body.conflictPolicy === 'local') { skipped++; continue }
      const merged = { ...parseJson<any>(local.data, {}), ...row }
      await run(c.env.DB, `UPDATE data_records SET data = ?, updated_at = ? WHERE id = ?`, JSON.stringify(merged), nowIso(), local.id)
      updated++
    } else {
      await run(
        c.env.DB,
        `INSERT INTO data_records (id, project_id, data, visibility, row_source, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        uid('rec_'), project.id, JSON.stringify(row), 'team', 'google-sheets', user.id, nowIso(), nowIso(),
      )
      inserted++
    }
  }
  await run(c.env.DB, `UPDATE sheet_links SET last_sync_at = ?, status = ? WHERE id = ?`, nowIso(), 'sukses', link.id)
  await run(
    c.env.DB,
    `INSERT INTO data_imports (id, project_id, user_id, filename, source, mode, inserted, updated, skipped, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    uid('imp_'), project.id, user.id, 'Google Sheets', 'sheets', body.conflictPolicy === 'local' ? 'skip-conflict' : 'merge', inserted, updated, skipped, nowIso(),
  )
  await audit(c.env, user, 'sheets.synced', 'project', project.id, `Sinkronisasi Google Sheets ${project.title}: +${inserted} / ~${updated}`, project.entity_id)
  return c.json({ inserted, updated, skipped, syncedAt: nowIso() })
})
