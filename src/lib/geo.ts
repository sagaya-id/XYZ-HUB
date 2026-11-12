export type GeoFeature = {
  name: string
  description?: string
  type: 'point' | 'line' | 'polygon'
  geometry: { type: string; coordinates: any }
  valid: boolean
  reason?: string
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
    const point = placemark.getElementsByTagNameNS('*', 'Point')[0]
    const line = placemark.getElementsByTagNameNS('*', 'LineString')[0]
    const polygon = placemark.getElementsByTagNameNS('*', 'Polygon')[0]
    try {
      if (point) {
        const coords = coordPairs(point.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? '')
        if (!coords.length) throw new Error('Koordinat titik tidak valid')
        return { name, description, type: 'point' as const, geometry: { type: 'Point', coordinates: coords[0] }, valid: true }
      }
      if (line) {
        const coords = coordPairs(line.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? '')
        if (coords.length < 2) throw new Error('Garis membutuhkan minimal 2 koordinat')
        return { name, description, type: 'line' as const, geometry: { type: 'LineString', coordinates: coords }, valid: true }
      }
      if (polygon) {
        const ring = polygon.getElementsByTagNameNS('*', 'outerBoundaryIs')[0]?.getElementsByTagNameNS('*', 'coordinates')[0]
        const coords = coordPairs(ring?.textContent ?? '')
        if (coords.length < 3) throw new Error('Area membutuhkan minimal 3 koordinat')
        return { name, description, type: 'polygon' as const, geometry: { type: 'Polygon', coordinates: [coords] }, valid: true }
      }
      return { name, description, type: 'point' as const, geometry: { type: 'Point', coordinates: [] }, valid: false, reason: 'Tidak ada geometri' }
    } catch (err: any) {
      return {
        name, description, type: 'point' as const,
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
    if (!geometry?.type || !Array.isArray(geometry.coordinates)) {
      return { name, description, type: 'point' as const, geometry: { type: 'Point', coordinates: [] }, valid: false, reason: 'Geometri tidak didukung' }
    }
    if (geometry.type === 'Point') return { name, description, type: 'point' as const, geometry, valid: true }
    if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
      return { name, description, type: 'line' as const, geometry: geometry.type === 'MultiLineString' ? { type: 'LineString', coordinates: geometry.coordinates[0] } : geometry, valid: true }
    }
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      return { name, description, type: 'polygon' as const, geometry: geometry.type === 'MultiPolygon' ? { type: 'Polygon', coordinates: geometry.coordinates[0] } : geometry, valid: true }
    }
    return { name, description, type: 'point' as const, geometry, valid: false, reason: `Tipe ${geometry.type} belum didukung` }
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
    const latRaw = LAT_KEYS.map((k) => normalized[k]).find((v) => v !== undefined && v !== '')
    const lngRaw = LNG_KEYS.map((k) => normalized[k]).find((v) => v !== undefined && v !== '')
    const lat = Number(String(latRaw ?? '').replace(',', '.'))
    const lng = Number(String(lngRaw ?? '').replace(',', '.'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { name, description, type: 'point' as const, geometry: { type: 'Point', coordinates: [] }, valid: false, reason: 'Koordinat tidak ditemukan / bukan angka' }
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { name, description, type: 'point' as const, geometry: { type: 'Point', coordinates: [lng, lat] }, valid: false, reason: 'Koordinat di luar rentang' }
    }
    return { name, description, type: 'point' as const, geometry: { type: 'Point', coordinates: [lng, lat] }, valid: true }
  })
}
