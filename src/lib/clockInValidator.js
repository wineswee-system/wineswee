/**
 * Clock-in validation: GPS location + WiFi IP verification
 * Checks employee position / IP against their assigned store's settings.
 * Either GPS or WiFi pass is sufficient (OR logic, matching Locations page description).
 * Validation failure BLOCKS clock-in (throws error with descriptive message).
 */

// GPS accuracy threshold in metres — positions less accurate than this are discarded
export const GPS_ACCURACY_THRESHOLD = 200

// Haversine distance in metres
export function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Get current GPS position via browser Geolocation API
// retryWithCache: 第二次嘗試時放寬 timeout 並容忍 60s 快取（避開瀏覽器忙的 race）
function getGeoPosition(retryWithCache = false) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('瀏覽器不支援 GPS 定位'))
    const options = retryWithCache
      ? { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      : { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        const weak = accuracy > GPS_ACCURACY_THRESHOLD
        resolve({ lat: latitude, lng: longitude, accuracy, weak })
      },
      (err) => reject(new Error(err.code === 1 ? 'GPS 定位被拒絕，請允許位置存取權限' : 'GPS 定位失敗，請確認裝置已開啟定位')),
      options
    )
  })
}

// 第一次失敗自動 retry 一次（容忍 60s 快取）
async function getGeoPositionWithRetry() {
  try {
    return await getGeoPosition(false)
  } catch {
    return await getGeoPosition(true)
  }
}

// Get public IP with retry (up to 2 attempts, fallback to backup API)
export async function getPublicIP() {
  const apis = [
    'https://api.ipify.org?format=json',
    'https://api.seeip.org/jsonip',
  ]
  for (const url of apis) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const data = await res.json()
      return data.ip
    } catch {
      // try next API
    }
  }
  return null
}

// Check if an IP matches a CIDR or exact IP entry
export function ipMatchesCIDR(ip, cidr) {
  const trimmed = cidr.trim()
  if (!trimmed) return false
  const ipToNum = (s) => {
    const parts = s.split('.')
    if (parts.length !== 4) return null
    const num = parts.reduce((acc, oct) => {
      const n = parseInt(oct, 10)
      if (isNaN(n) || n < 0 || n > 255) return null
      return acc !== null ? (acc << 8) + n : null
    }, 0)
    return num !== null ? num >>> 0 : null
  }
  const ipNum = ipToNum(ip)
  if (ipNum === null) return false

  if (trimmed.includes('/')) {
    const [network, bitsStr] = trimmed.split('/')
    const bits = parseInt(bitsStr, 10)
    if (isNaN(bits) || bits < 0 || bits > 32) return false
    const netNum = ipToNum(network)
    if (netNum === null) return false
    const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1) >>> 0
    return (ipNum & mask) === (netNum & mask)
  }
  return ip === trimmed
}

/**
 * Main validation entry point.
 * @param {Object|null} store - The store record (with lat, lng, clock_radius, allowed_wifi)
 * @param {Object|null} prefetchedGeo - { lat, lng, accuracy, timestamp } 若 30s 內 fresh 直接用，
 *                                       避免按打卡時又重抓一次（mount 時已抓過的好結果）
 * @returns {Promise<{lat, lng, ip, method, locationName}>}
 * @throws {Error} when validation is required but fails — caller should display error and block clock-in
 */
export async function validateClockIn(store, prefetchedGeo = null) {
  const PREFETCH_MAX_AGE_MS = 30000
  const usePrefetch = !!(
    prefetchedGeo?.lat && prefetchedGeo?.lng &&
    prefetchedGeo?.timestamp && (Date.now() - prefetchedGeo.timestamp < PREFETCH_MAX_AGE_MS)
  )

  let geo = null
  let geoError = null
  let publicIP = null

  if (usePrefetch) {
    // 用 mount 時抓到的 fresh GPS，省去按打卡時再抓一次的等待 + 失敗風險
    const acc = prefetchedGeo.accuracy ?? 0
    geo = {
      lat: prefetchedGeo.lat,
      lng: prefetchedGeo.lng,
      accuracy: acc,
      weak: acc > GPS_ACCURACY_THRESHOLD,
    }
    publicIP = await getPublicIP()
  } else {
    // 沒 prefetch 或過期 → 抓 GPS + IP（GPS 帶 retry 容錯）
    const [geoResult, ipResult] = await Promise.allSettled([getGeoPositionWithRetry(), getPublicIP()])
    geo = geoResult.status === 'fulfilled' ? geoResult.value : null
    geoError = geoResult.status === 'rejected' ? geoResult.reason.message : null
    publicIP = ipResult.status === 'fulfilled' ? ipResult.value : null
  }

  // If no store configured, just record the data without validation
  if (!store) {
    return {
      lat: geo?.lat || null,
      lng: geo?.lng || null,
      ip: publicIP,
      method: 'none',
      locationName: geo ? '定位成功（無門市設定）' : '無定位',
    }
  }

  const hasGPSConfig = !!(store.lat && store.lng)
  const hasWifiConfig = !!(store.allowed_wifi && store.allowed_wifi.length > 0)

  // If store has neither configured, allow
  if (!hasGPSConfig && !hasWifiConfig) {
    return {
      lat: geo?.lat || null,
      lng: geo?.lng || null,
      ip: publicIP,
      method: 'none',
      locationName: store.name,
    }
  }

  let gpsPass = false
  let gpsDetail = ''
  let wifiPass = false
  let wifiDetail = ''

  // GPS validation — skip if accuracy is too poor
  if (hasGPSConfig) {
    if (geo && !geo.weak) {
      const dist = haversineMetres(geo.lat, geo.lng, store.lat, store.lng)
      const radius = store.clock_radius || 150
      gpsPass = dist <= radius
      if (!gpsPass) {
        gpsDetail = `GPS 距離 ${store.name} ${Math.round(dist)} 公尺（超出 ${radius}m 範圍）`
      }
    } else if (geo && geo.weak) {
      gpsDetail = `GPS 精確度不足（${Math.round(geo.accuracy)}m），無法用於定位驗證`
    } else {
      gpsDetail = geoError || '無法取得 GPS 定位'
    }
  }

  // WiFi IP validation
  if (hasWifiConfig) {
    if (publicIP) {
      wifiPass = store.allowed_wifi.some((cidr) => ipMatchesCIDR(publicIP, cidr))
      if (!wifiPass) {
        wifiDetail = `網路 IP（${publicIP}）不在允許的 WiFi 白名單內`
      }
    } else {
      wifiDetail = '無法取得網路 IP，請確認網路連線正常'
    }
  }

  // Either GPS or WiFi must pass
  if (gpsPass || wifiPass) {
    return {
      lat: geo?.lat || null,
      lng: geo?.lng || null,
      ip: publicIP,
      method: gpsPass ? 'gps' : 'wifi',
      locationName: store.name,
    }
  }

  // Both failed — throw to BLOCK clock-in
  const reasons = []
  if (gpsDetail) reasons.push(gpsDetail)
  if (wifiDetail) reasons.push(wifiDetail)

  const error = new Error(`打卡失敗：位置驗證未通過\n${reasons.join('\n')}`)
  error.code = 'VALIDATION_FAILED'
  error.detail = { lat: geo?.lat || null, lng: geo?.lng || null, ip: publicIP, reasons }
  throw error
}
