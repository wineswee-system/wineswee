/**
 * geocoding.js — Address → GPS coordinates
 *
 * Strategy (browser-safe, no forbidden headers):
 *   1️⃣  ArcGIS World Geocoder  — handles Traditional Chinese TW addresses natively,
 *                                 no API key required for low-volume use, score-filtered
 *   2️⃣  Photon (komoot.io)     — OSM-based, no User-Agent req; works for romanized queries
 *   3️⃣  Nominatim global       — last-resort fallback
 *
 * Why not Nominatim as primary:
 *   browsers silently drop the `User-Agent` header (forbidden header per Fetch spec),
 *   so requests arrive with the browser UA, violating Nominatim's usage policy → 503s.
 *
 * Why not Photon as primary:
 *   - lang=zh is unsupported (400 error); lang=default returns 0 results for zh-TW input
 *   - only useful as fallback when the address is already romanized
 */

const ARCGIS_URL  = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
const PHOTON_URL  = 'https://photon.komoot.io/api'
const NOMINATIM   = 'https://nominatim.openstreetmap.org/search'

// ─── retry helper (handles transient 503s) ───────────────────────────────────
async function fetchWithRetry(url, opts = {}, { retries = 2, baseDelay = 800 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, opts)
    if (res.ok) return res
    if (res.status === 503 && attempt < retries) {
      await new Promise(r => setTimeout(r, baseDelay * 2 ** attempt))
      continue
    }
    throw new Error(`HTTP ${res.status}`)
  }
}

// ─── provider 1: ArcGIS World Geocoder ───────────────────────────────────────
// Best for Traditional Chinese Taiwan addresses — returns score 100 for exact matches.
async function arcgis(address) {
  const params = new URLSearchParams({
    SingleLine: address,
    f: 'json',
    maxLocations: '1',
    countryCode: 'TWN',
    outFields: 'Addr_type',
  })
  const res = await fetchWithRetry(
    `${ARCGIS_URL}?${params}`,
    { signal: AbortSignal.timeout(8000) }
  )
  const data = await res.json()
  const cand = data?.candidates?.[0]
  // Reject low-confidence matches (street-centroid or worse)
  if (!cand || cand.score < 60) return null
  return {
    lat: cand.location.y,
    lng: cand.location.x,
    displayName: cand.address,
  }
}

// ─── provider 2: Photon (photon.komoot.io) ────────────────────────────────────
// Works for romanized queries; lang=zh is unsupported (400), use 'en'.
async function photon(address) {
  const params = new URLSearchParams({
    q: address,
    limit: '1',
    lang: 'en',          // zh is not supported by Photon
    lat: '23.97',        // bias toward Taiwan centre
    lon: '120.97',
  })
  const res = await fetchWithRetry(
    `${PHOTON_URL}?${params}`,
    { signal: AbortSignal.timeout(8000) }
  )
  const data = await res.json()
  const feat = data?.features?.[0]
  if (!feat) return null
  const [lon, lat] = feat.geometry.coordinates
  const p = feat.properties
  const displayName = [p.name, p.street, p.city, p.country].filter(Boolean).join(', ')
  return { lat, lng: lon, displayName }
}

// ─── provider 3: Nominatim ────────────────────────────────────────────────────
// Note: User-Agent header is silently dropped by browsers (forbidden header per Fetch spec).
async function nominatim(address, countryCode = '') {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: '1',
    'accept-language': 'zh-TW,en',
    ...(countryCode ? { countrycodes: countryCode } : {}),
  })
  const res = await fetchWithRetry(
    `${NOMINATIM}?${params}`,
    { signal: AbortSignal.timeout(8000) }
  )
  const data = await res.json()
  if (!data.length) return null
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    displayName: data[0].display_name,
  }
}

// TODO: Enable when TGOS forward geocoding endpoint is confirmed
// async function tgos(address) { ... }

/**
 * Convert an address string to { lat, lng, displayName }.
 * Tries ArcGIS → Photon → Nominatim, with retry on 503.
 * Throws if no result found.
 */
export async function geocodeAddress(address) {
  if (!address?.trim()) throw new Error('請先填寫地址')
  const q = address.trim()

  // 1️⃣ ArcGIS — best for Traditional Chinese Taiwan addresses
  const arcgisResult = await arcgis(q).catch(() => null)
  if (arcgisResult) return arcgisResult

  // 2️⃣ Photon — fallback for romanized/mixed queries
  const photonResult = await photon(q).catch(() => null)
  if (photonResult) return photonResult

  // 3️⃣ Nominatim global — last resort
  const nomResult = await nominatim(q, '').catch(() => null)
  if (nomResult) return nomResult

  throw new Error('找不到此地址的座標，請確認地址格式或手動輸入')
}
