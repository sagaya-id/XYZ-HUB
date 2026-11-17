/**
 * Convert KML "description" HTML into clean plain text.
 *
 * Google My Maps exports wrap descriptions in raw HTML (divs, line breaks) and
 * append hidden ARIA blocks such as `<div role="status" aria-hidden="true">`,
 * which used to show up verbatim in popups and cards.
 */
export function stripHtmlToText(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (!text) return ''

  // Line breaks become real newlines before tags are removed.
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
  // Never surface script/style or hidden ARIA helpers.
  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  text = text.replace(/<(div|span|p)[^>]*\brole="(status|alert)"[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  text = text.replace(/<(div|span|p)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  // Prefer readable text from links before dropping the remaining markup.
  text = text.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) =>
    label && label.replace(/<[^>]*>/g, '').trim() ? label : href,
  )
  text = text.replace(/<[^>]*>/g, '')

  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeChar(parseInt(dec, 10)))

  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Same helper for API responses where `null` should stay `null`. */
export function stripHtmlOrNull(value: string | null | undefined): string | null {
  const cleaned = stripHtmlToText(value)
  return cleaned ? cleaned : null
}
