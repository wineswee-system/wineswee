export function calculateAvailability(plannedTime, downtime) {
  if (!plannedTime || plannedTime <= 0) return 0
  const dt = downtime || 0
  const result = (plannedTime - dt) / plannedTime
  return Math.round(Math.max(0, Math.min(1, result)) * 10000) / 10000
}

export function calculatePerformance(idealCycleTime, totalPieces, runTime) {
  if (!runTime || runTime <= 0) return 0
  if (!idealCycleTime || !totalPieces) return 0
  const result = (idealCycleTime * totalPieces) / runTime
  return Math.round(Math.max(0, Math.min(1, result)) * 10000) / 10000
}

export function calculateQuality(totalPieces, defects) {
  if (!totalPieces || totalPieces <= 0) return 0
  const d = defects || 0
  const result = (totalPieces - d) / totalPieces
  return Math.round(Math.max(0, Math.min(1, result)) * 10000) / 10000
}

export function calculateOEE(availability, performance, quality) {
  const a = availability || 0
  const p = performance || 0
  const q = quality || 0
  const oee = Math.round(a * p * q * 10000) / 10000

  return {
    oee,
    oeePercent: Math.round(oee * 10000) / 100,
    availability: a,
    performance: p,
    quality: q,
    category: getOEECategory(oee),
  }
}

export function getOEECategory(oee) {
  if (oee >= 0.85) return 'World Class'
  if (oee >= 0.70) return 'Good'
  return 'Needs Improvement'
}
