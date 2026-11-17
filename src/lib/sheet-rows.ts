import * as XLSX from 'xlsx'

export type SheetRows = { name: string; headers: string[]; rows: Record<string, string>[] }

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/**
 * Converts a worksheet into a string matrix while keeping every cell hyperlink.
 * A cell displaying "📍 MAP" but linked to Google Maps becomes the maps URL, so
 * imports never lose the destination behind a label.
 */
export function sheetMatrix(sheet: XLSX.WorkSheet): string[][] {
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

/** Every non-empty worksheet of a workbook with headers and hyperlink-aware rows. */
export function workbookSheets(buffer: ArrayBuffer): SheetRows[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  return workbook.SheetNames.map((name) => {
    const matrix = sheetMatrix(workbook.Sheets[name]).filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    if (!matrix.length) return null
    const headers = matrix[0].map((cell, index) => String(cell ?? '').trim() || `Kolom ${index + 1}`)
    const rows = matrix.slice(1).map((row) => {
      const obj: Record<string, string> = {}
      headers.forEach((header, index) => { obj[header] = String(row[index] ?? '').trim() })
      return obj
    })
    return { name, headers, rows }
  }).filter((sheet): sheet is SheetRows => !!sheet && sheet.headers.length > 0)
}
