// Nearest-neighbor TSP heuristic for own-fleet multi-stop route optimization.
// Stops: [{id, lat, lng, time_window?, weight_kg?}]

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function optimizeRoute(stops, depotLat = 25.0, depotLng = 121.5) {
  if (!stops?.length) return []
  if (stops.length === 1) return [{ ...stops[0], sequence: 1 }]

  const remaining = [...stops]
  const ordered = []
  let curLat = depotLat
  let curLng = depotLng

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i]
      if (!s.lat || !s.lng) { nearestIdx = i; break }
      const d = haversineKm(curLat, curLng, s.lat, s.lng)
      if (d < nearestDist) { nearestDist = d; nearestIdx = i }
    }
    const next = remaining.splice(nearestIdx, 1)[0]
    ordered.push({ ...next, sequence: ordered.length + 1 })
    curLat = next.lat ?? curLat
    curLng = next.lng ?? curLng
  }
  return ordered
}

export function estimateRouteDistance(stops, depotLat = 25.0, depotLng = 121.5) {
  if (!stops?.length) return 0
  let total = 0
  let prevLat = depotLat
  let prevLng = depotLng
  for (const s of stops) {
    if (s.lat && s.lng) {
      total += haversineKm(prevLat, prevLng, s.lat, s.lng)
      prevLat = s.lat
      prevLng = s.lng
    }
  }
  total += haversineKm(prevLat, prevLng, depotLat, depotLng)
  return Math.round(total * 10) / 10
}

// 15 min per stop + 3 min per km travel
export function estimateDuration(stops, distanceKm) {
  return Math.round(stops.length * 15 + distanceKm * 3)
}

export function checkCapacity(stops, maxWeightKg) {
  const total = stops.reduce((s, st) => s + (st.weight_kg ?? 0), 0)
  return { ok: total <= maxWeightKg, totalWeight: total }
}
