/**
 * geocoding.js — Address → GPS coordinates
 *
 * Strategy (all browser-safe, no forbidden headers):
 *   1️⃣  Photon (photon.komoot.io)  — OSM-based, no User-Agent req, handles zh-TW well
 *   2️⃣  Nominatim TW-restricted    — fallback, countrycodes=tw
 *   3️⃣  Nominatim global           — last-resort fallback
 *
 * Note: browsers silently drop the `User-Agent` header (forbidden header per Fetch spec).
 * Photon avoids this by not requiring one; Nominatim requests are sent without custom UA.
 */

const PHOTON    = 'https://photon.komoot.io/api'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

// ─── retry helper ────────────────────────────────────────────────────────────
async function fetchWithRetry(url, opts = {}, { retries = 2, baseDelay = 800 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, opts)
    if (res.ok) return res
    if (res.status === 503 && attempt < retries) {
      // exponential back-off: 800ms, 1600ms
      await new Promise(r => setTimeout(r, baseDelay * 2 ** attempt))
      continue
    }
    throw new Error(`HTTP ${res.status}`)
  }
}

// ─── provider: Photon (photon.komoot.io) ─────────────────────────────────────
async function photon(address) {
  const params = new URLSearchParams({
    q: address,
    limit: '1',
    lang: 'zh',
    // bias toward Taiwan
    lat: '23.97',
    lon: '120.97',
  })
  const res = await fetchWithRetry(
    `${PHOTON}?${params}`,
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

// ─── provider: Nominatim ─────────────────────────────────────────────────────
async function nominatim(address, countryCode = 'tw') {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: '1',
    'accept-language': 'zh-TW,en',
    ...(countryCode ? { countrycodes: countryCode } : {}),
  })
  // Note: User-Agent is a forbidden header in browsers and is silently dropped.
  // Nominatim receives the browser's default UA instead of our custom string.
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
 * Tries Photon → Nominatim TW → Nominatim global, with retry on 503.
 * Throws if no result found.
 */
export async function geocodeAddress(address) {
  if (!address?.trim()) throw new Error('請先填寫地址')
  const q = address.trim()

  // 1️⃣ Photon — browser-safe, no User-Agent requirement
  const photonResult = await photon(q).catch(() => null)
  if (photonResult) return photonResult

  // 2️⃣ Nominatim Taiwan-restricted
  const twResult = await nominatim(q, 'tw').catch(() => null)
  if (twResult) return twResult

  // 3️⃣ Nominatim global fallback
  const globalResult = await nominatim(q, '').catch(() => null)
  if (globalResult) return globalResult

  throw new Error('找不到此地址的座標，請確認地址格式或手動輸入')
}
