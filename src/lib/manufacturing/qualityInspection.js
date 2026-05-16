export const INSPECTION_TYPES = ['incoming', 'in_process', 'final']

export const INSPECTION_RESULTS = ['accept', 'reject', 'rework', 'conditional_accept']

export function createInspection(type, referenceId, items, inspector) {
  if (!INSPECTION_TYPES.includes(type)) {
    throw new Error(`無效的檢驗類型：${type}，允許值為 ${INSPECTION_TYPES.join(', ')}`)
  }
  if (!referenceId) throw new Error('關聯單據 ID 為必填')
  if (!items || items.length === 0) throw new Error('待檢項目不可為空')
  if (!inspector) throw new Error('檢驗人員為必填')

  return {
    id: `INS-${Date.now()}`,
    type,
    referenceId,
    inspector,
    items: items.map(item => ({
      ...item,
      result: null,
      measurements: [],
      notes: '',
    })),
    status: '待檢驗',
    createdAt: new Date().toISOString(),
  }
}

export function recordInspectionResult(inspection, results) {
  if (!inspection) throw new Error('檢驗紀錄為必填')
  if (!results || results.length === 0) throw new Error('檢驗結果不可為空')

  const updatedItems = inspection.items.map(item => {
    const res = results.find(r => r.itemCode === item.itemCode)
    if (!res) return item

    if (!INSPECTION_RESULTS.includes(res.result)) {
      throw new Error(`無效的檢驗結果：${res.result}`)
    }

    return {
      ...item,
      result: res.result,
      measurements: res.measurements || [],
      notes: res.notes || '',
    }
  })

  const allJudged = updatedItems.every(i => i.result !== null)
  const hasReject = updatedItems.some(i => i.result === 'reject')

  return {
    ...inspection,
    items: updatedItems,
    status: allJudged ? (hasReject ? '不合格' : '合格') : '檢驗中',
    completedAt: allJudged ? new Date().toISOString() : null,
  }
}

export function calculateDefectRate(inspections, period) {
  const filtered = (inspections || []).filter(ins => {
    if (!period) return true
    const d = ins.createdAt || ''
    return (!period.from || d >= period.from) && (!period.to || d <= period.to)
  })

  let totalInspected = 0
  let totalDefects = 0

  for (const ins of filtered) {
    for (const item of ins.items || []) {
      if (item.result) {
        totalInspected++
        if (item.result === 'reject' || item.result === 'rework') {
          totalDefects++
        }
      }
    }
  }

  const defectRate = totalInspected > 0
    ? Math.round((totalDefects / totalInspected) * 10000) / 100
    : 0

  return { totalInspected, totalDefects, defectRate }
}

export function evaluateSPC(measurements, spec) {
  if (!measurements || measurements.length < 2) {
    throw new Error('至少需要 2 筆量測值')
  }
  if (!spec || spec.usl == null || spec.lsl == null) {
    throw new Error('需提供上規格界限 (usl) 與下規格界限 (lsl)')
  }

  const n = measurements.length
  const mean = measurements.reduce((s, v) => s + v, 0) / n
  const variance = measurements.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
  const stdDev = Math.sqrt(variance)

  const cp = stdDev > 0
    ? Math.round(((spec.usl - spec.lsl) / (6 * stdDev)) * 100) / 100
    : 0

  const cpk = stdDev > 0
    ? Math.round(
        Math.min(
          (spec.usl - mean) / (3 * stdDev),
          (mean - spec.lsl) / (3 * stdDev)
        ) * 100
      ) / 100
    : 0

  return {
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    cp,
    cpk,
    count: n,
  }
}

export function isInControl(measurements, controlLimits) {
  if (!measurements || measurements.length === 0) return true
  if (!controlLimits || controlLimits.ucl == null || controlLimits.lcl == null) {
    throw new Error('需提供管制上限 (ucl) 與管制下限 (lcl)')
  }

  return measurements.every(
    v => v >= controlLimits.lcl && v <= controlLimits.ucl
  )
}
