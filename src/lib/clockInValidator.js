/**
 * Clock-in validation: GPS location + WiFi IP verification
 * Checks employee position / IP against their assigned store's settings.
 * Either GPS or WiFi pass is sufficient (OR logic, matching Locations page description).
 */

// Haversine distance in metres
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Get current GPS position via browser Geolocation API
function getGeoPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('瀏覽器不支援 GPS 定位'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === 1 ? 'GPS 定位被拒絕，請允許位置存取權限' : 'GPS 定位失敗，請確認裝置已開啟定位')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  })
}

// Get public IP via free API
async function getPublicIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json')
    const data = await res.json()
    return data.ip
  } catch {
    return null
  }
}

// Check if an IP matches a CIDR or exact IP entry
function ipMatchesCIDR(ip, cidr) {
  const ipToNum = (s) => s.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0
  const trimmed = cidr.trim()
  if (trimmed.includes('/')) {
    const [network, bits] = trimmed.split('/')
    const mask = ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0
    return (ipToNum(ip) & mask) === (ipToNum(network) & mask)
  }
  return ip === trimmed
}

/**
 * Main validation entry point.
 * @param {Object|null} store - The store record (with lat, lng, clock_radius, allowed_wifi)
 * @returns {Promise<{lat, lng, ip, method, locationName}>}
 */
export async function validateClockIn(store) {
  // Capture GPS + IP in parallel
  const [geoResult, ip] = await Promise.allSettled([getGeoPosition(), getPublicIP()])

  const geo = geoResult.status === 'fulfilled' ? geoResult.value : null
  const publicIP = ip.status === 'fulfilled' ? ip.value : null

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

  let gpsPass = false
  let wifiPass = false

  // GPS validation
  if (geo && store.lat && store.lng) {
    const dist = haversineMetres(geo.lat, geo.lng, store.lat, store.lng)
    const radius = store.clock_radius || 150
    gpsPass = dist <= radius
  }

  // WiFi IP validation
  if (publicIP && store.allowed_wifi && store.allowed_wifi.length > 0) {
    wifiPass = store.allowed_wifi.some((cidr) => ipMatchesCIDR(publicIP, cidr))
  }

  // Determine result
  const hasGPSConfig = store.lat && store.lng
  const hasWifiConfig = store.allowed_wifi && store.allowed_wifi.length > 0

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

  // Both failed — build descriptive error
  const reasons = []
  if (hasGPSConfig && geo) {
    const dist = haversineMetres(geo.lat, geo.lng, store.lat, store.lng)
    reasons.push(`GPS 距離 ${store.name} ${Math.round(dist)} 公尺（超出 ${store.clock_radius || 150}m 範圍）`)
  } else if (hasGPSConfig && !geo) {
    reasons.push('無法取得 GPS 定位')
  }
  if (hasWifiConfig) {
    reasons.push(`WiFi IP ${publicIP || '未知'} 不在白名單內`)
  }

  // Still record but mark as external
  return {
    lat: geo?.lat || null,
    lng: geo?.lng || null,
    ip: publicIP,
    method: 'failed',
    locationName: '外部位置',
    warning: `打卡位置驗證未通過：${reasons.join('；')}`,
  }
}
