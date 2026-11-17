import { Hono } from 'hono'
import * as XLSX from 'xlsx/xlsx.mjs'
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

dataRoutes.patch('/data/fields/:fieldId', async (c) => {
  const user = c.get('user')
  const field = await one<any>(c.env.DB, `SELECT * FROM data_fields WHERE id = ?`, c.req.param('fieldId'))
  if (!field) return c.json({ error: 'Kolom tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, field.project_id)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat mengubah kolom.')
  const body = await c.req.json().catch(() => ({}))
  const label = String(body.label ?? '').trim()
  if (!label) return c.json({ error: 'Nama kolom wajib diisi.' }, 400)
  if (label.length > 80) return c.json({ error: 'Nama kolom maksimal 80 karakter.' }, 400)
  const dupe = await one<any>(
    c.env.DB,
    `SELECT id FROM data_fields WHERE project_id = ? AND LOWER(label) = LOWER(?) AND id <> ?`,
    project.id, label, field.id,
  )
  if (dupe) return c.json({ error: 'Nama kolom sudah dipakai.' }, 409)
  // Only the display label changes; keys and every cell value stay untouched.
  await run(c.env.DB, `UPDATE data_fields SET label = ? WHERE id = ?`, label, field.id)
  await audit(c.env, user, 'data.field_renamed', 'project', project.id, `Mengubah kolom ${field.label} menjadi ${label}`, project.entity_id, { key: field.key })
  return c.json({ field: await one<any>(c.env.DB, `SELECT * FROM data_fields WHERE id = ?`, field.id) })
})

dataRoutes.delete('/data/fields/:fieldId', async (c) => {
  const user = c.get('user')
  const field = await one<any>(c.env.DB, `SELECT * FROM data_fields WHERE id = ?`, c.req.param('fieldId'))
  if (!field) return c.json({ error: 'Kolom tidak ditemukan.' }, 404)
  const { project, member } = await loadProject(c.env, user, field.project_id)
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat menghapus kolom.')
  const total = await one<any>(c.env.DB, `SELECT COUNT(*) AS n FROM data_fields WHERE project_id = ?`, project.id)
  if ((total?.n ?? 0) <= 1) {
    return c.json({ error: 'Tidak dapat menghapus kolom terakhir. Tabel harus memiliki minimal satu kolom.' }, 400)
  }
  // Drop the schema column and the matching value from every record so the
  // table never keeps orphaned data after the column disappears.
  const records = await q<any>(c.env.DB, `SELECT id, data FROM data_records WHERE project_id = ?`, project.id)
  let affected = 0
  for (const record of records) {
    const data = parseJson<Record<string, any>>(record.data, {})
    if (!(field.key in data)) continue
    delete data[field.key]
    await run(c.env.DB, `UPDATE data_records SET data = ?, updated_at = ? WHERE id = ?`, JSON.stringify(data), nowIso(), record.id)
    affected++
  }
  await run(c.env.DB, `DELETE FROM data_fields WHERE id = ?`, field.id)
  await audit(
    c.env, user, 'data.field_deleted', 'project', project.id,
    `Menghapus kolom ${field.label} dari ${project.title}`, project.entity_id,
    { key: field.key, records: affected },
  )
  return c.json({ ok: true, records: affected })
})

/** Batch delete for the Kelola Kolom modal (always keeps at least one column). */
dataRoutes.post('/projects/:id/data/fields/bulk-delete', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat menghapus kolom.')
  const body = await c.req.json().catch(() => ({}))
  const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).map((id: any) => String(id)).filter(Boolean)))
  if (!ids.length) return c.json({ error: 'Pilih minimal satu kolom untuk dihapus.' }, 400)
  const all = await q<any>(c.env.DB, `SELECT * FROM data_fields WHERE project_id = ? ORDER BY position`, project.id)
  let targets = all.filter((field) => ids.includes(field.id))
  if (!targets.length) return c.json({ error: 'Kolom yang dipilih tidak ditemukan.' }, 404)
  // "Pilih Semua" is allowed, but a table always keeps its first column so it
  // can never end up without headers.
  let kept: string | null = null
  if (all.length - targets.length < 1) {
    kept = targets[0].label
    targets = targets.slice(1)
  }
  if (!targets.length) {
    return c.json({ error: 'Tidak dapat menghapus semua kolom. Tabel harus memiliki minimal satu kolom.' }, 400)
  }
  const keys = targets.map((field) => field.key)
  const records = await q<any>(c.env.DB, `SELECT id, data FROM data_records WHERE project_id = ?`, project.id)
  let affected = 0
  for (const record of records) {
    const data = parseJson<Record<string, any>>(record.data, {})
    const present = keys.filter((key) => key in data)
    if (!present.length) continue
    for (const key of present) delete data[key]
    await run(c.env.DB, `UPDATE data_records SET data = ?, updated_at = ? WHERE id = ?`, JSON.stringify(data), nowIso(), record.id)
    affected++
  }
  for (const field of targets) {
    await run(c.env.DB, `DELETE FROM data_fields WHERE id = ?`, field.id)
  }
  await audit(
    c.env, user, 'data.fields_deleted', 'project', project.id,
    `Menghapus ${targets.length} kolom dari ${project.title}`, project.entity_id,
    { keys, records: affected },
  )
  return c.json({ ok: true, deleted: targets.length, keys, records: affected, kept })
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

dataRoutes.post('/data/records/bulk-delete', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const ids = (Array.isArray(body.ids) ? body.ids : []).map((id: any) => String(id)).filter(Boolean)
  if (!ids.length) return c.json({ error: 'Tidak ada baris yang dipilih.' }, 400)
  if (ids.length > 1000) return c.json({ error: 'Maksimum 1000 baris per tindakan.' }, 400)
  let deleted = 0
  const denied: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const record = await one<any>(c.env.DB, `SELECT * FROM data_records WHERE id = ?`, id)
    if (!record) continue
    const { project, member } = await loadProject(c.env, user, record.project_id)
    if (!member && !isAdminOf(user, project, member)) { denied.push(id); continue }
    await run(c.env.DB, `DELETE FROM data_records WHERE id = ?`, record.id)
    deleted++
  }
  if (deleted) {
    await audit(c.env, user, 'data.bulk_deleted', 'project', null, `Menghapus ${deleted} baris data sekaligus`, user.entity_id, { requested: ids.length, deleted, denied: denied.length })
  }
  return c.json({ deleted, denied })
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
  const mode = ['append', 'update', 'skip', 'replace'].includes(body.mode) ? body.mode : 'append'
  if (mode === 'replace' && !isAdminOf(user, project, member)) {
    throw new HttpError(403, 'Hanya admin proyek yang dapat mengganti seluruh isi tabel.')
  }
  const dedupeField: string = String(body.dedupeField ?? '')
  const fieldDefs: { key: string; label: string; type?: string }[] =
    Array.isArray(body.fields) && body.fields.length
      ? body.fields
      : Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
  await ensureFields(c.env, project.id, fieldDefs)
  let replaced = 0
  if (mode === 'replace') {
    const previous = await one<any>(c.env.DB, `SELECT COUNT(*) AS n FROM data_records WHERE project_id = ?`, project.id)
    replaced = previous?.n ?? 0
    await run(c.env.DB, `DELETE FROM data_records WHERE project_id = ?`, project.id)
  }
  const existingRows = mode === 'replace'
    ? []
    : await q<any>(c.env.DB, `SELECT * FROM data_records WHERE project_id = ?`, project.id)
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
    project.entity_id, { mode, dedupeField, replaced, worksheet: body.worksheet ?? null },
  )
  return c.json({ inserted, updated, skipped, mode, replaced, worksheet: body.worksheet ?? null })
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

function spreadsheetId(url: string): string | null {
  const match = String(url ?? '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match ? match[1] : null
}

function gidFromUrl(url: string): string | null {
  const match = String(url ?? '').match(/[#&?]gid=([0-9]+)/)
  return match ? match[1] : null
}

/**
 * `worksheet` may be a numeric gid or a tab name. A tab name is passed through
 * Google's `sheet=` parameter, so users can still import when the tab list
 * cannot be read from the sharing page.
 */
function sheetCsvUrl(url: string, worksheet?: string | null): string | null {
  const id = spreadsheetId(url)
  if (!id) return null
  const target = String(worksheet ?? '').trim()
  const gid = /^\d+$/.test(target) ? target : gidFromUrl(url)
  const sheetName = target && !/^\d+$/.test(target) ? target : null
  const query = sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : gid ? `&gid=${gid}` : ''
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${query}`
}

/** Reads every tab (name + gid) exposed by the public spreadsheet page. */
async function listSheetTabs(url: string): Promise<{ gid: string; name: string }[]> {
  const id = spreadsheetId(url)
  if (!id) throw new HttpError(400, 'Tautan Google Sheets tidak valid.')
  const pageUrl = `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`
  let html = ''
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9,id;q=0.8',
      },
    })
    if (res.ok) html = await res.text()
  } catch {
    /* fall through to the name-only fallback */
  }
  const tabs = new Map<string, string>()
  const names = new Set<string>()
  const add = (gid: string | undefined, name: string | undefined) => {
    const cleanGid = String(gid ?? '').trim()
    const cleanName = String(name ?? '')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\//g, '/')
      .trim()
    if (!cleanName || names.has(cleanName)) return
    // Sheets encodes the bootstrap payload with escaped quotes; key by gid when
    // known, otherwise by name so tab names alone still produce a selector.
    const key = cleanGid || `name:${cleanName}`
    if (tabs.has(key)) return
    tabs.set(key, cleanName)
    names.add(cleanName)
  }
  const normalized = html.replace(/\\"/g, '"')
  // Sheet snapshots: [index,flag,"gid",[{"1":[[0,0,"Nama Tab"]…
  for (const match of normalized.matchAll(/\[\d+,\d+,"(\d+)",\[\{"1":\[\[0,0,"((?:[^"\\]|\\.)*)"/g)) {
    add(match[1], match[2])
  }
  // Alternative bootstrap orderings used by older/newer Sheets builds.
  for (const match of normalized.matchAll(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"(?:gid|sheetId)"\s*:\s*"?(\d+)"?/g)) {
    add(match[2], match[1])
  }
  for (const match of normalized.matchAll(/"sheetId"\s*:\s*"?(\d+)"?[^{}]{0,200}?"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    add(match[1], match[2])
  }
  for (const match of normalized.matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]{0,200}?"sheetId"\s*:\s*"?(\d+)"?/g)) {
    add(match[2], match[1])
  }
  // Legacy HTML view exposes tabs as links: …gid=0>Nama Tab</a>
  for (const match of normalized.matchAll(/gid=(\d+)[^>]*>([^<]{1,80})<\/a>/g)) {
    add(match[1], match[2])
  }
  // Last resort: tab captions in DOM order (names only; imports use sheet=Name).
  if (!tabs.size) {
    for (const match of html.matchAll(/docs-sheet-tab-caption">([^<]{1,80})</g)) {
      add('', match[1])
    }
  }
  return [...tabs.entries()]
    .map(([key, name]) => ({ gid: key.startsWith('name:') ? '' : key, name }))
    .sort((a, b) => (a.gid && b.gid ? Number(a.gid) - Number(b.gid) : 0))
}

const SHEET_FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9,id;q=0.8',
}

/** Resolves a numeric gid to its tab name so the XLSX export can be sliced. */
async function worksheetTabName(url: string, worksheet?: string | null): Promise<string | null> {
  const target = String(worksheet ?? '').trim()
  if (!target) return null
  if (!/^\d+$/.test(target)) return target
  try {
    const tabs = await listSheetTabs(url)
    return tabs.find((tab) => tab.gid === target)?.name ?? null
  } catch {
    return null
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/**
 * Reads a worksheet into a string matrix, keeping the real hyperlink of every
 * cell that has one. A cell such as "📍 MAP" linked to Google Maps therefore
 * yields the maps URL instead of the display label.
 */
function worksheetMatrix(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet?.['!ref']
  if (!ref) return []
  const range = XLSX.utils.decode_range(ref)
  const matrix: string[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell: any = sheet[XLSX.utils.encode_cell({ r, c })]
      const href = cell?.l?.Target ? String(cell.l.Target) : ''
      const text = cell?.w ?? (cell?.v === undefined || cell?.v === null ? '' : String(cell.v))
      row.push(href && !isHttpUrl(text) ? href : text)
    }
    matrix.push(row)
  }
  return matrix
}

async function fetchSheetRows(url: string, worksheet?: string | null): Promise<{
  headers: string[]
  rows: Record<string, string>[]
  sheetName: string | null
}> {
  const id = spreadsheetId(url)
  if (!id) throw new HttpError(400, 'Tautan Google Sheets tidak valid.')

  // 1) XLSX export keeps cell hyperlinks (maps URLs behind "📍 MAP" labels).
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, {
      headers: SHEET_FETCH_HEADERS,
    })
    if (res.ok) {
      const buffer = await res.arrayBuffer()
      if (buffer.byteLength > 0) {
        const workbook = XLSX.read(buffer, { type: 'array' })
        const wanted = await worksheetTabName(url, worksheet)
        const sheetName = wanted && workbook.SheetNames.includes(wanted) ? wanted : workbook.SheetNames[0]
        const matrix = sheetName ? worksheetMatrix(workbook.Sheets[sheetName]) : []
        const filled = matrix.filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
        if (filled.length) {
          const headers = filled[0].map((h, i) => String(h ?? '').trim() || `kolom_${i + 1}`)
          const rows = filled.slice(1).map((row) => {
            const obj: Record<string, string> = {}
            headers.forEach((header, index) => { obj[header] = String(row[index] ?? '').trim() })
            return obj
          })
          return { headers, rows, sheetName: sheetName ?? null }
        }
      }
    }
  } catch {
    /* fall back to the CSV feed below */
  }

  // 2) CSV fallback: values only, used when the export endpoint is blocked.
  const csvUrl = sheetCsvUrl(url, worksheet)
  if (!csvUrl) throw new HttpError(400, 'Tautan Google Sheets tidak valid.')
  const res = await fetch(csvUrl, { headers: SHEET_FETCH_HEADERS })
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
  return { headers, rows, sheetName: null }
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

/** Lists the tabs of a pasted Google Sheets URL before importing. */
dataRoutes.post('/projects/:id/sheets/tabs', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const url = String(body.url ?? '').trim()
  if (!spreadsheetId(url)) return c.json({ error: 'Tautan Google Sheets tidak valid.' }, 400)
  let sheets: { gid: string; name: string }[] = []
  try {
    sheets = await listSheetTabs(url)
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Gagal membaca daftar sheet.' }, 400)
  }
  const selectedGid = gidFromUrl(url)
  return c.json({
    sheets,
    selectedGid: sheets.some((sheet) => sheet.gid && sheet.gid === selectedGid) ? selectedGid : null,
    restricted: sheets.length === 0,
    message: sheets.length === 0
      ? 'Daftar tab tidak dapat dibaca otomatis. Masukkan nama tab secara manual di bawah.'
      : null,
  })
})

dataRoutes.post('/projects/:id/sheets/preview', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const link = await one<any>(c.env.DB, `SELECT * FROM sheet_links WHERE project_id = ?`, project.id)
  // The import flow passes an ad-hoc URL + worksheet; the sync flow uses the saved link.
  const sourceUrl = String(body.url ?? '').trim() || link?.url || ''
  const worksheet = body.worksheet !== undefined ? String(body.worksheet ?? '') : link?.worksheet ?? ''
  if (!sourceUrl) return c.json({ error: 'Belum ada Google Sheets yang terhubung.' }, 400)
  const dedupeField = String(body.dedupeField ?? '')
  let sheet: { headers: string[]; rows: Record<string, string>[] }
  try {
    sheet = await fetchSheetRows(sourceUrl, worksheet)
  } catch (err: any) {
    if (link) await run(c.env.DB, `UPDATE sheet_links SET status = ? WHERE id = ?`, `gagal: ${err.message}`.slice(0, 180), link.id)
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
    sample: sheet.rows.slice(0, 5),
    worksheet: worksheet || null,
    added: added.slice(0, 100),
    changed: changed.slice(0, 100).map((c2) => ({ ...c2, local: undefined })),
    counts: { added: added.length, changed: changed.length, unchanged: unchanged.length },
    requiresDedupeField: !dedupeField,
  })
})

/** Imports one chosen tab, either appended or as a full replacement. */
dataRoutes.post('/projects/:id/sheets/import', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!member && !isAdminOf(user, project, member)) throw new HttpError(403, 'Tidak diizinkan.')
  const body = await c.req.json().catch(() => ({}))
  const url = String(body.url ?? '').trim()
  const worksheet = String(body.worksheet ?? '').trim()
  if (!spreadsheetId(url)) return c.json({ error: 'Tautan Google Sheets tidak valid.' }, 400)
  if (!worksheet) return c.json({ error: 'Pilih sheet yang ingin diimpor terlebih dahulu.' }, 400)
  const mode = body.mode === 'replace' ? 'replace' : 'append'
  if (mode === 'replace' && !isAdminOf(user, project, member)) {
    throw new HttpError(403, 'Hanya admin proyek yang dapat mengganti seluruh isi tabel.')
  }
  // Resolve a numeric gid back to its tab name so history/audit/toasts read
  // "Impor sheet Data Lokasi" instead of the raw gid.
  let worksheetLabel = worksheet
  if (/^\d+$/.test(worksheet)) {
    try {
      const tabs = await listSheetTabs(url)
      worksheetLabel = tabs.find((tab) => tab.gid === worksheet)?.name ?? worksheet
    } catch {
      /* keep the gid when the tab list cannot be read */
    }
  }
  let sheet: { headers: string[]; rows: Record<string, string>[] }
  try {
    sheet = await fetchSheetRows(url, worksheet)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Gagal membaca sheet.' }, 400)
  }
  if (!sheet.rows.length) return c.json({ error: 'Sheet terpilih tidak memiliki baris data.' }, 400)
  if (sheet.rows.length > 5000) return c.json({ error: 'Maksimum 5000 baris per impor.' }, 400)
  await ensureFields(c.env, project.id, sheet.headers.map((header) => ({ key: header, label: header })))
  let replaced = 0
  if (mode === 'replace') {
    const previous = await one<any>(c.env.DB, `SELECT COUNT(*) AS n FROM data_records WHERE project_id = ?`, project.id)
    replaced = previous?.n ?? 0
    await run(c.env.DB, `DELETE FROM data_records WHERE project_id = ?`, project.id)
  }
  let inserted = 0
  let skipped = 0
  for (const row of sheet.rows) {
    const cleaned: Record<string, string> = {}
    for (const header of sheet.headers) cleaned[header] = String(row[header] ?? '')
    if (!Object.values(cleaned).some((value) => value.trim() !== '')) { skipped++; continue }
    await run(
      c.env.DB,
      `INSERT INTO data_records (id, project_id, data, visibility, row_source, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      uid('rec_'), project.id, JSON.stringify(cleaned), 'team', `google-sheets:${worksheet}`, user.id, nowIso(), nowIso(),
    )
    inserted++
  }
  await run(
    c.env.DB,
    `INSERT INTO data_imports (id, project_id, user_id, filename, source, mode, inserted, updated, skipped, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    uid('imp_'), project.id, user.id, `Google Sheets — ${worksheetLabel}`, 'sheets', mode, inserted, 0, skipped, nowIso(),
  )
  await audit(
    c.env, user, 'sheets.imported', 'project', project.id,
    `Impor sheet ${worksheetLabel} ke ${project.title}: +${inserted}${replaced ? ` (mengganti ${replaced} baris)` : ''}`,
    project.entity_id, { worksheet, worksheetLabel, mode, replaced },
  )
  return c.json({ inserted, skipped, replaced, mode, worksheet: worksheetLabel, headers: sheet.headers })
})

dataRoutes.post('/projects/:id/sheets/sync', async (c) => {
  const user = c.get('user')
  const { project, member } = await loadProject(c.env, user, c.req.param('id'))
  if (!isAdminOf(user, project, member)) throw new HttpError(403, 'Hanya admin proyek yang dapat menyinkronkan sheet.')
  const link = await one<any>(c.env.DB, `SELECT * FROM sheet_links WHERE project_id = ?`, project.id)
  if (!link) return c.json({ error: 'Belum ada Google Sheets yang terhubung.' }, 400)
  const body = await c.req.json().catch(() => ({}))
  const dedupeField = String(body.dedupeField ?? '')
  // The modal can sync a tab that has not been saved yet; an explicit
  // worksheet override wins over the stored configuration.
  const worksheet = body.worksheet !== undefined ? String(body.worksheet ?? '') : link.worksheet
  let sheet: { headers: string[]; rows: Record<string, string>[]; sheetName: string | null }
  try {
    sheet = await fetchSheetRows(link.url, worksheet)
  } catch (err: any) {
    await run(c.env.DB, `UPDATE sheet_links SET status = ? WHERE id = ?`, `gagal: ${err.message}`.slice(0, 180), link.id)
    return c.json({ error: err.message ?? 'Sinkronisasi gagal.' }, 400)
  }

  // "Ganti Semua Kolom & Data (Reset Bersih)": drop stale schema + rows first so
  // the table mirrors the chosen tab exactly.
  if (body.mode === 'reset') {
    if (sheet.rows.length > 5000) return c.json({ error: 'Maksimum 5000 baris per sinkronisasi.' }, 400)
    const fieldCount = await one<any>(c.env.DB, `SELECT COUNT(*) AS n FROM data_fields WHERE project_id = ?`, project.id)
    const rowCount = await one<any>(c.env.DB, `SELECT COUNT(*) AS n FROM data_records WHERE project_id = ?`, project.id)
    await run(c.env.DB, `DELETE FROM data_records WHERE project_id = ?`, project.id)
    await run(c.env.DB, `DELETE FROM data_fields WHERE project_id = ?`, project.id)
    await ensureFields(c.env, project.id, sheet.headers.map((h) => ({ key: h, label: h })))
    let inserted = 0
    let skipped = 0
    for (const row of sheet.rows) {
      const cleaned: Record<string, string> = {}
      for (const header of sheet.headers) cleaned[header] = String(row[header] ?? '')
      if (!Object.values(cleaned).some((value) => value.trim() !== '')) { skipped++; continue }
      await run(
        c.env.DB,
        `INSERT INTO data_records (id, project_id, data, visibility, row_source, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        uid('rec_'), project.id, JSON.stringify(cleaned), 'team', 'google-sheets', user.id, nowIso(), nowIso(),
      )
      inserted++
    }
    await run(c.env.DB, `UPDATE sheet_links SET last_sync_at = ?, status = ? WHERE id = ?`, nowIso(), 'sukses', link.id)
    await run(
      c.env.DB,
      `INSERT INTO data_imports (id, project_id, user_id, filename, source, mode, inserted, updated, skipped, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uid('imp_'), project.id, user.id, 'Google Sheets — reset', 'sheets', 'reset', inserted, 0, skipped, nowIso(),
    )
    await audit(
      c.env, user, 'sheets.synced', 'project', project.id,
      `Reset & sinkron Google Sheets ${project.title}: ${inserted} baris`, project.entity_id,
      { mode: 'reset', worksheet, removedColumns: fieldCount?.n ?? 0, removedRows: rowCount?.n ?? 0 },
    )
    return c.json({
      inserted, updated: 0, skipped, reset: true,
      removedColumns: fieldCount?.n ?? 0, removedRows: rowCount?.n ?? 0, syncedAt: nowIso(),
    })
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
