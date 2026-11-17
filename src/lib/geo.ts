export type GeoFeature = {
  name: string
  description?: string
  googleMapsUrl?: string
  type: 'point' | 'line' | 'polygon'
  geometry: { type: string; coordinates: any }
  valid: boolean
  reason?: string
}

/** Column names that may carry a Google Maps link in CSV/Excel/Sheets files. */
export const MAPS_URL_KEYS = [
  'gmaps', 'gmap', 'google_maps', 'google_maps_url', 'gmaps_link', 'googlemaps',
  'link_maps', 'maps_link', 'maps_url', 'map_url', 'link_maps', 'url', 'link', 'tautan',
]

const MAPS_PATTERN = /https?:\/\/[^\s"'<>)]*(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)[^\s"'<>)]*/i

/** Pull a usable http(s) URL out of arbitrary KML/GeoJSON text. */
export function extractMapsUrl(value: string | null | undefined): string | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  const maps = raw.match(MAPS_PATTERN)
  if (maps) return maps[0]
  const anyUrl = raw.match(/https?:\/\/[^\s"'<>)]+/i)
  return anyUrl ? anyUrl[0] : undefined
}

/** Reads a lat/lng pair from a Google Maps URL (or a plain "lat, lng" value). */
export function coordinatesFromMapsUrl(value: string | null | undefined): { lat: number; lng: number } | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center|destination|daddr)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
  ]
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (!match) continue
    const lat = Number(match[1])
    const lng = Number(match[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    return { lat, lng }
  }
  return null
}

export function normalizeMapsUrl(value: string | null | undefined): string | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  if (/^https?:\/\//i.test(raw)) return raw
  const extracted = extractMapsUrl(raw)
  if (extracted) return extracted
  return undefined
}

function coordPairs(raw: string): number[][] {
  return raw
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(',').slice(0, 2).map(Number))
    .filter((pair) => pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
}

export function parseKml(text: string): GeoFeature[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Berkas KML tidak dapat dibaca.')
  const placemarks = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'))
  return placemarks.map((placemark) => {
    const name = placemark.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() || 'Tanpa nama'
    const description = placemark.getElementsByTagNameNS('*', 'description')[0]?.textContent?.trim()
    // Google Maps links can live in <description>, <ExtendedData><Data> or a
    // <link>/<href> element — accept whichever is present.
    const extended = Array.from(placemark.getElementsByTagNameNS('*', 'Data'))
      .map((data) => `${data.getAttribute('name') ?? ''}:${data.getElementsByTagNameNS('*', 'value')[0]?.textContent ?? ''}`)
      .join(' ')
    const href = Array.from(placemark.getElementsByTagNameNS('*', 'href'))
      .map((node) => node.textContent ?? '')
      .join(' ')
    const googleMapsUrl = extractMapsUrl(`${description ?? ''} ${extended} ${href}`)
    const point = placemark.getElementsByTagNameNS('*', 'Point')[0]
    const line = placemark.getElementsByTagNameNS('*', 'LineString')[0]
    const polygon = placemark.getElementsByTagNameNS('*', 'Polygon')[0]
    try {
      if (point) {
        const coords = coordPairs(point.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? '')
        if (!coords.length) throw new Error('Koordinat titik tidak valid')
        return { name, description, googleMapsUrl, type: 'point' as const, geometry: { type: 'Point', coordinates: coords[0] }, valid: true }
      }
      if (line) {
        const coords = coordPairs(line.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? '')
        if (coords.length < 2) throw new Error('Garis membutuhkan minimal 2 koordinat')
        return { name, description, googleMapsUrl, type: 'line' as const, geometry: { type: 'LineString', coordinates: coords }, valid: true }
      }
      if (polygon) {
        const ring = polygon.getElementsByTagNameNS('*', 'outerBoundaryIs')[0]?.getElementsByTagNameNS('*', 'coordinates')[0]
        const coords = coordPairs(ring?.textContent ?? '')
        if (coords.length < 3) throw new Error('Area membutuhkan minimal 3 koordinat')
        return { name, description, googleMapsUrl, type: 'polygon' as const, geometry: { type: 'Polygon', coordinates: [coords] }, valid: true }
      }
      return { name, description, googleMapsUrl, type: 'point' as const, geometry: { type: 'Point', coordinates: [] }, valid: false, reason: 'Tidak ada geometri' }
    } catch (err: any) {
      return {
        name, description, googleMapsUrl, type: 'point' as const,
        geometry: { type: 'Point', coordinates: [] }, valid: false, reason: err?.message,
      }
    }
  })
}

export function parseGeoJson(text: string): GeoFeature[] {
  const data = JSON.parse(text)
  const features = data.type === 'FeatureCollection'
    ? data.features ?? []
    : data.type === 'Feature'
      ? [data]
      : data.type && data.coordinates
        ? [{ type: 'Feature', properties: {}, geometry: data }]
        : []
  return features.map((feature: any) => {
    const geometry = feature.geometry
    const name = feature.properties?.name || feature.properties?.Name || feature.properties?.nama || 'Tanpa nama'
    const description = feature.properties?.description || feature.properties?.deskripsi
    const properties = feature.properties ?? {}
    const googleMapsUrl = normalizeMapsUrl(
      MAPS_URL_KEYS.map((key) => properties[key]).find((value) => value !== undefined && value !== '')
        ?? extractMapsUrl(description),
    )
    if (!geometry?.type || !Array.isArray(geometry.coordinates)) {
      return { name, description, googleMapsUrl, type: 'point' as const, geometry: { type: 'Point', coordinates: [] }, valid: false, reason: 'Geometri tidak didukung' }
    }
    if (geometry.type === 'Point') return { name, description, googleMapsUrl, type: 'point' as const, geometry, valid: true }
    if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
      return { name, description, googleMapsUrl, type: 'line' as const, geometry: geometry.type === 'MultiLineString' ? { type: 'LineString', coordinates: geometry.coordinates[0] } : geometry, valid: true }
    }
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      return { name, description, googleMapsUrl, type: 'polygon' as const, geometry: geometry.type === 'MultiPolygon' ? { type: 'Polygon', coordinates: geometry.coordinates[0] } : geometry, valid: true }
    }
    return { name, description, googleMapsUrl, type: 'point' as const, geometry, valid: false, reason: `Tipe ${geometry.type} belum didukung` }
  })
}

const LAT_KEYS = ['lat', 'latitude', 'lintang', 'y', 'koordinat_lat']
const LNG_KEYS = ['lng', 'lon', 'long', 'longitude', 'bujur', 'x', 'koordinat_lng']
const NAME_KEYS = ['name', 'nama', 'title', 'judul', 'lokasi', 'location']
const DESC_KEYS = ['description', 'deskripsi', 'keterangan', 'catatan', 'note']

export function featuresFromRows(rows: Record<string, string>[]): GeoFeature[] {
  return rows.map((row) => {
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) normalized[key.toLowerCase().trim()] = value
    const name = NAME_KEYS.map((k) => normalized[k]).find(Boolean) || 'Tanpa nama'
    const description = DESC_KEYS.map((k) => normalized[k]).find(Boolean)
    // A maps column wins; otherwise any cell carrying a maps link (e.g. the
    // KOORDINAT column with a "📍 MAP" hyperlink) or the description still works.
    const knownMaps = MAPS_URL_KEYS.map((k) => normalized[k]).find((v) => v !== undefined && v !== '')
    const scannedMaps = Object.values(normalized).map((value) => extractMapsUrl(value)).find(Boolean)
    const googleMapsUrl = normalizeMapsUrl(knownMaps ?? scannedMaps ?? extractMapsUrl(description))
    const latRaw = LAT_KEYS.map((k) => normalized[k]).find((v) => v !== undefined && v !== '')
    const lngRaw = LNG_KEYS.map((k) => normalized[k]).find((v) => v !== undefined && v !== '')
    // Empty cells must stay empty: Number('') is 0 and would put every row at 0,0.
    const toCoordinate = (raw: string | undefined) => {
      const text = String(raw ?? '').trim()
      return text ? Number(text.replace(',', '.')) : NaN
    }
    let lat = toCoordinate(latRaw)
    let lng = toCoordinate(lngRaw)
    // Sheets often only carry a Google Maps hyperlink (e.g. "📍 MAP"); derive the
    // point from the URL so those rows still land on the map.
    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && googleMapsUrl) {
      const fromUrl = coordinatesFromMapsUrl(googleMapsUrl)
      if (fromUrl) { lat = fromUrl.lat; lng = fromUrl.lng }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { name, description, googleMapsUrl, type: 'point' as const, geometry: { type: 'Point', coordinates: [] }, valid: false, reason: 'Koordinat tidak ditemukan / bukan angka' }
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { name, description, googleMapsUrl, type: 'point' as const, geometry: { type: 'Point', coordinates: [lng, lat] }, valid: false, reason: 'Koordinat di luar rentang' }
    }
    return { name, description, googleMapsUrl, type: 'point' as const, geometry: { type: 'Point', coordinates: [lng, lat] }, valid: true }
  })
}
