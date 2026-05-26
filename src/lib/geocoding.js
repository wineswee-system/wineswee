/**
 * geocoding.js — Address → GPS coordinates
 * Primary:  OpenStreetMap Nominatim  (countrycodes=tw)
 * Fallback: OpenStreetMap Nominatim  (no country restriction)
 * Future:   TGOS forward geocoding  (enable once endpoint confirmed)
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'sme-ops/1.0 (contact: astrops.psych@gmail.com)'

async function nominatim(address, countryCode = 'tw') {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: '1',
    'accept-language': 'zh-TW,en',
    ...(countryCode ? { countrycodes: countryCode } : {}),
  })
  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)
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
 * Tries Taiwan-restricted Nominatim first, then global as fallback.
 * Throws if no result found.
 */
export async function geocodeAddress(address) {
  if (!address?.trim()) throw new Error('請先填寫地址')

  // 1️⃣ Taiwan-restricted search
  const twResult = await nominatim(address.trim(), 'tw').catch(() => null)
  if (twResult) return twResult

  // 2️⃣ Global fallback (handles non-standard Taiwan address formats)
  const globalResult = await nominatim(address.trim(), '').catch(() => null)
  if (globalResult) return globalResult

  throw new Error('找不到此地址的座標，請確認地址格式或手動輸入')
}
