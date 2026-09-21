/**
 * 需求預測引擎（Demand Forecasting）
 *
 * 支援三種預測方法：
 * 1. 簡單移動平均（SMA）
 * 2. 加權移動平均（WMA）
 * 3. 季節性分解（Seasonal Decomposition）
 *
 * 純函式，不依賴外部狀態
 */

const round2 = (x) => Math.round(x * 100) / 100

/**
 * 將交易紀錄彙整為每期（日/週/月）需求量
 *
 * @param {Array} transactions - [{date, qty, type}] type='OUT' 為出貨
 * @param {'daily'|'weekly'|'monthly'} period - 彙整週期
 * @returns {Array} [{period, demand}] 依時間排序
 */
export function aggregateDemand(transactions, period = 'monthly') {
  const outbound = (transactions || []).filter(t => t.type === 'OUT')
  const buckets = {}

  for (const t of outbound) {
    const d = new Date(t.date)
    let key
    if (period === 'daily') {
      key = d.toISOString().slice(0, 10)
    } else if (period === 'weekly') {
      const jan1 = new Date(d.getFullYear(), 0, 1)
      const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)
      key = `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
    } else {
      key = d.toISOString().slice(0, 7) // YYYY-MM
    }
    buckets[key] = (buckets[key] || 0) + Math.abs(t.qty || 0)
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, demand]) => ({ period, demand: round2(demand) }))
}

/**
 * 簡單移動平均（SMA）
 *
 * @param {Array<number>} data - 歷史需求序列
 * @param {number} windowSize - 移動窗口大小（預設 3 期）
 * @param {number} periodsAhead - 預測幾期（預設 3）
 * @returns {Object} { forecast, confidence, method }
 */
export function simpleMovingAverage(data, windowSize = 3, periodsAhead = 3) {
  if (!data || data.length === 0) {
    return { forecast: Array(periodsAhead).fill(0), confidence: 0, method: 'SMA' }
  }

  const effectiveWindow = Math.min(windowSize, data.length)
  const recent = data.slice(-effectiveWindow)
  const avg = round2(recent.reduce((s, v) => s + v, 0) / recent.length)

  // 標準差作為信賴區間
  const variance = recent.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / recent.length
  const stdDev = round2(Math.sqrt(variance))
  const confidence = data.length >= windowSize ? round2(Math.max(0, 1 - stdDev / (avg || 1))) : 0.3

  return {
    forecast: Array(periodsAhead).fill(avg),
    confidence: Math.min(1, Math.max(0, confidence)),
    stdDev,
    method: 'SMA',
  }
}

/**
 * 加權移動平均（WMA）— 近期權重較高
 *
 * @param {Array<number>} data - 歷史需求序列
 * @param {number} windowSize - 移動窗口大小（預設 3 期）
 * @param {number} periodsAhead - 預測幾期
 * @returns {Object} { forecast, confidence, method }
 */
export function weightedMovingAverage(data, windowSize = 3, periodsAhead = 3) {
  if (!data || data.length === 0) {
    return { forecast: Array(periodsAhead).fill(0), confidence: 0, method: 'WMA' }
  }

  const effectiveWindow = Math.min(windowSize, data.length)
  const recent = data.slice(-effectiveWindow)

  // 權重：最近的期數權重最大（線性遞增）
  const totalWeight = (effectiveWindow * (effectiveWindow + 1)) / 2
  let weightedSum = 0
  for (let i = 0; i < recent.length; i++) {
    weightedSum += recent[i] * (i + 1)
  }
  const avg = round2(weightedSum / totalWeight)

  const variance = recent.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / recent.length
  const stdDev = round2(Math.sqrt(variance))
  const confidence = data.length >= windowSize ? round2(Math.max(0, 1 - stdDev / (avg || 1))) : 0.3

  return {
    forecast: Array(periodsAhead).fill(avg),
    confidence: Math.min(1, Math.max(0, confidence)),
    stdDev,
    method: 'WMA',
  }
}

/**
 * 季節性分解預測
 *
 * 偵測週期性模式（週/月），將需求分解為趨勢 + 季節指數。
 * 適合餐飲/零售業的週末/月份波動。
 *
 * @param {Array<number>} data - 歷史需求序列（至少需要 2 個完整週期）
 * @param {number} seasonLength - 季節週期長度（7=週, 12=月）
 * @param {number} periodsAhead - 預測幾期
 * @returns {Object} { forecast, seasonalIndices, trend, confidence, method }
 */
export function seasonalDecomposition(data, seasonLength = 12, periodsAhead = 3) {
  if (!data || data.length < seasonLength) {
    // 資料不足，降級為 WMA
    return { ...weightedMovingAverage(data, 3, periodsAhead), method: 'SEASONAL (fallback WMA)' }
  }

  // 1. 計算趨勢（移動平均）
  const trend = []
  const halfWindow = Math.floor(seasonLength / 2)
  for (let i = halfWindow; i < data.length - halfWindow; i++) {
    let sum = 0
    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      sum += data[j]
    }
    trend.push(round2(sum / seasonLength))
  }

  // 2. 去趨勢，得到季節成分
  const detrended = []
  for (let i = halfWindow; i < data.length - halfWindow; i++) {
    const trendVal = trend[i - halfWindow]
    detrended.push(trendVal > 0 ? round2(data[i] / trendVal) : 1)
  }

  // 3. 計算平均季節指數
  const seasonalIndices = Array(seasonLength).fill(0)
  const seasonCounts = Array(seasonLength).fill(0)
  for (let i = 0; i < detrended.length; i++) {
    const seasonPos = (i + halfWindow) % seasonLength
    seasonalIndices[seasonPos] += detrended[i]
    seasonCounts[seasonPos]++
  }
  for (let i = 0; i < seasonLength; i++) {
    seasonalIndices[i] = seasonCounts[i] > 0 ? round2(seasonalIndices[i] / seasonCounts[i]) : 1
  }

  // 正規化季節指數（平均 = 1）
  const avgIndex = seasonalIndices.reduce((s, v) => s + v, 0) / seasonLength
  for (let i = 0; i < seasonLength; i++) {
    seasonalIndices[i] = round2(seasonalIndices[i] / avgIndex)
  }

  // 4. 趨勢外推（線性迴歸取最後 N 期趨勢）
  const recentTrend = trend.slice(-Math.min(6, trend.length))
  let trendSlope = 0
  if (recentTrend.length >= 2) {
    const n = recentTrend.length
    const xMean = (n - 1) / 2
    const yMean = recentTrend.reduce((s, v) => s + v, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (recentTrend[i] - yMean)
      den += (i - xMean) * (i - xMean)
    }
    trendSlope = den !== 0 ? round2(num / den) : 0
  }

  const lastTrend = trend[trend.length - 1] || data[data.length - 1]

  // 5. 預測
  const forecast = []
  const startSeason = data.length % seasonLength
  for (let i = 0; i < periodsAhead; i++) {
    const projectedTrend = round2(lastTrend + trendSlope * (i + 1))
    const seasonPos = (startSeason + i) % seasonLength
    forecast.push(round2(Math.max(0, projectedTrend * seasonalIndices[seasonPos])))
  }

  const confidence = data.length >= seasonLength * 2 ? 0.75 : 0.5

  return {
    forecast,
    seasonalIndices,
    trend: { lastValue: lastTrend, slope: trendSlope },
    confidence,
    method: 'SEASONAL',
  }
}

/**
 * 自動選擇最佳預測方法
 *
 * @param {Array<number>} data - 歷史需求序列
 * @param {number} seasonLength - 季節週期長度
 * @param {number} periodsAhead - 預測幾期
 * @returns {Object} 最佳預測結果
 */
export function autoForecast(data, seasonLength = 12, periodsAhead = 3) {
  if (!data || data.length === 0) {
    return { forecast: Array(periodsAhead).fill(0), confidence: 0, method: 'NONE' }
  }

  // 資料不足 → SMA
  if (data.length < 6) {
    return simpleMovingAverage(data, Math.min(3, data.length), periodsAhead)
  }

  // 偵測季節性：比較 SMA 誤差與 SEASONAL 誤差
  if (data.length >= seasonLength * 2) {
    const seasonal = seasonalDecomposition(data, seasonLength, periodsAhead)
    if (seasonal.confidence >= 0.5) return seasonal
  }

  // 偵測趨勢：如果近期有明顯趨勢，用 WMA
  const recent = data.slice(-6)
  const firstHalf = recent.slice(0, 3).reduce((s, v) => s + v, 0) / 3
  const secondHalf = recent.slice(3).reduce((s, v) => s + v, 0) / 3
  const trendRatio = secondHalf / (firstHalf || 1)

  if (trendRatio > 1.1 || trendRatio < 0.9) {
    return weightedMovingAverage(data, 4, periodsAhead)
  }

  return simpleMovingAverage(data, 4, periodsAhead)
}

/**
 * 計算安全庫存建議量
 *
 * 公式：Z × σ × √(前置時間)
 * Z = 1.65（95% 服務水準）
 *
 * @param {number} stdDev - 需求標準差
 * @param {number} leadTimeDays - 前置時間（天）
 * @param {number} serviceLevelZ - Z 值（預設 1.65 = 95%）
 * @returns {number} 安全庫存量
 */
export function calculateSafetyStock(stdDev, leadTimeDays, serviceLevelZ = 1.65) {
  if (stdDev <= 0 || leadTimeDays <= 0) return 0
  return round2(serviceLevelZ * stdDev * Math.sqrt(leadTimeDays))
}

/**
 * 計算建議再訂購點
 *
 * 公式：平均日需求 × 前置時間 + 安全庫存
 *
 * @param {number} avgDailyDemand - 平均日需求
 * @param {number} leadTimeDays - 前置時間（天）
 * @param {number} safetyStock - 安全庫存
 * @returns {number} 再訂購點
 */
export function calculateReorderPoint(avgDailyDemand, leadTimeDays, safetyStock) {
  return round2(avgDailyDemand * leadTimeDays + safetyStock)
}
