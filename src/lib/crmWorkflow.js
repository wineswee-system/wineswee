/**
 * CRM Workflow — 銷售流程、活動紀錄、預測分析、重複偵測、行銷活動 ROI、Web-to-Lead
 * 適用於台灣中小企業 ERP 系統
 */

// ============================================================
// 1. 銷售管線配置 (Pipeline Configuration)
// ============================================================

/** 預設銷售管線階段 */
export const DEFAULT_PIPELINE_STAGES = [
  { id: 'lead', name: '潛在客戶', probability: 10, order: 1 },
  { id: 'qualified', name: '合格線索', probability: 25, order: 2 },
  { id: 'proposal', name: '提案中', probability: 50, order: 3 },
  { id: 'negotiation', name: '議價中', probability: 75, order: 4 },
  { id: 'closed_won', name: '成交', probability: 100, order: 5 },
  { id: 'closed_lost', name: '失敗', probability: 0, order: 6 },
]

/**
 * 驗證並建立銷售管線配置
 * @param {Array<{id: string, name: string, probability: number, order: number}>} stages - 管線階段
 * @returns {{ ok: boolean, pipeline?: object, error?: string }}
 */
export function createPipelineConfig(stages = DEFAULT_PIPELINE_STAGES) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return { ok: false, error: '管線階段不可為空' }
  }

  // 驗證每個階段必填欄位
  for (const s of stages) {
    if (!s.id || !s.name) {
      return { ok: false, error: `階段缺少 id 或 name: ${JSON.stringify(s)}` }
    }
    if (typeof s.probability !== 'number' || s.probability < 0 || s.probability > 100) {
      return { ok: false, error: `階段「${s.name}」機率需介於 0-100` }
    }
    if (typeof s.order !== 'number') {
      return { ok: false, error: `階段「${s.name}」缺少排序 order` }
    }
  }

  // 檢查 id 唯一
  const ids = stages.map(s => s.id)
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: '管線階段 id 不可重複' }
  }

  const sorted = [...stages].sort((a, b) => a.order - b.order)
  return {
    ok: true,
    pipeline: {
      id: `PL-${Date.now()}`,
      stages: sorted,
      stageMap: Object.fromEntries(sorted.map(s => [s.id, s])),
      created_at: new Date().toISOString(),
    },
  }
}

/**
 * 將商機從一個階段移至另一個階段（含驗證）
 * @param {object} opportunity - 商機物件
 * @param {string} fromStage - 來源階段 id
 * @param {string} toStage - 目標階段 id
 * @param {object} pipeline - 由 createPipelineConfig 產生的管線
 * @returns {{ ok: boolean, opportunity?: object, error?: string }}
 */
export function moveOpportunity(opportunity, fromStage, toStage, pipeline) {
  if (!opportunity) return { ok: false, error: '商機不可為空' }
  if (!pipeline || !pipeline.stageMap) return { ok: false, error: '管線配置無效' }

  const from = pipeline.stageMap[fromStage]
  const to = pipeline.stageMap[toStage]

  if (!from) return { ok: false, error: `來源階段「${fromStage}」不存在` }
  if (!to) return { ok: false, error: `目標階段「${toStage}」不存在` }

  // 已結案不可再移動
  if (from.id === 'closed_won' || from.id === 'closed_lost') {
    return { ok: false, error: '已結案的商機不可再移動，請重新開啟' }
  }

  // 同階段不處理
  if (fromStage === toStage) {
    return { ok: false, error: '來源與目標階段相同' }
  }

  const updated = {
    ...opportunity,
    stage: toStage,
    stage_name: to.name,
    probability: to.probability,
    updated_at: new Date().toISOString(),
    history: [
      ...(opportunity.history || []),
      {
        from: fromStage,
        to: toStage,
        moved_at: new Date().toISOString(),
      },
    ],
  }

  return { ok: true, opportunity: updated }
}

/**
 * 計算管線各階段的數量與金額統計
 * @param {Array<object>} opportunities - 商機清單
 * @param {object} pipeline - 管線配置
 * @returns {Array<{ stage: string, name: string, count: number, totalValue: number, avgValue: number, probability: number }>}
 */
export function getPipelineMetrics(opportunities = [], pipeline) {
  if (!pipeline || !pipeline.stages) return []

  return pipeline.stages.map(stage => {
    const items = opportunities.filter(o => o.stage === stage.id)
    const totalValue = items.reduce((sum, o) => sum + (o.value || 0), 0)
    const count = items.length
    return {
      stage: stage.id,
      name: stage.name,
      count,
      totalValue: Math.round(totalValue * 100) / 100,
      avgValue: count > 0 ? Math.round((totalValue / count) * 100) / 100 : 0,
      probability: stage.probability,
    }
  })
}

// ============================================================
// 2. 活動紀錄 (Activity Logging)
// ============================================================

/** 活動類型定義 */
export const ACTIVITY_TYPES = [
  { type: 'call', label: '電話聯繫', icon: 'phone' },
  { type: 'meeting', label: '會議', icon: 'calendar' },
  { type: 'email', label: '電子郵件', icon: 'mail' },
  { type: 'note', label: '備註', icon: 'edit' },
  { type: 'task', label: '待辦事項', icon: 'check' },
  { type: 'visit', label: '拜訪', icon: 'map' },
]

/** 活動類型快速查表 */
const ACTIVITY_TYPE_MAP = Object.fromEntries(ACTIVITY_TYPES.map(a => [a.type, a]))

/**
 * 建立活動紀錄
 * @param {string} type - 活動類型（call, meeting, email, note, task, visit）
 * @param {string} contactId - 聯絡人 ID
 * @param {string} subject - 主旨
 * @param {string} [notes=''] - 備註內容
 * @param {string} [userId=''] - 執行人員 ID
 * @param {number} [duration=0] - 持續時間（分鐘）
 * @returns {{ ok: boolean, activity?: object, error?: string }}
 */
export function logActivity(type, contactId, subject, notes = '', userId = '', duration = 0) {
  if (!type || !ACTIVITY_TYPE_MAP[type]) {
    return { ok: false, error: `無效的活動類型: ${type}` }
  }
  if (!contactId) {
    return { ok: false, error: '聯絡人 ID 不可為空' }
  }
  if (!subject) {
    return { ok: false, error: '主旨不可為空' }
  }

  const meta = ACTIVITY_TYPE_MAP[type]
  return {
    ok: true,
    activity: {
      id: `ACT-${Date.now()}`,
      type,
      label: meta.label,
      icon: meta.icon,
      contact_id: contactId,
      subject,
      notes,
      user_id: userId,
      duration: Math.max(0, Math.round(duration)),
      created_at: new Date().toISOString(),
    },
  }
}

/**
 * 取得某聯絡人的活動時間軸（依時間倒序）
 * @param {Array<object>} activities - 全部活動紀錄
 * @param {string} contactId - 聯絡人 ID
 * @returns {Array<object>}
 */
export function getActivityTimeline(activities = [], contactId) {
  if (!contactId) return []
  return activities
    .filter(a => a.contact_id === contactId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

/**
 * 統計活動摘要（各類型次數、平均持續時間）
 * @param {Array<object>} activities - 活動紀錄
 * @param {{ start: string, end: string }} [period] - 篩選期間（ISO 日期字串）
 * @returns {{ totalCount: number, byType: object, avgDuration: number }}
 */
export function getActivitySummary(activities = [], period) {
  let filtered = activities

  if (period && period.start && period.end) {
    const startMs = new Date(period.start).getTime()
    const endMs = new Date(period.end).getTime()
    filtered = activities.filter(a => {
      const t = new Date(a.created_at).getTime()
      return t >= startMs && t <= endMs
    })
  }

  // 依類型統計
  const byType = {}
  for (const at of ACTIVITY_TYPES) {
    const items = filtered.filter(a => a.type === at.type)
    const totalDuration = items.reduce((sum, a) => sum + (a.duration || 0), 0)
    byType[at.type] = {
      label: at.label,
      count: items.length,
      totalDuration,
      avgDuration: items.length > 0 ? Math.round((totalDuration / items.length) * 100) / 100 : 0,
    }
  }

  const totalDurationAll = filtered.reduce((sum, a) => sum + (a.duration || 0), 0)

  return {
    totalCount: filtered.length,
    byType,
    avgDuration: filtered.length > 0 ? Math.round((totalDurationAll / filtered.length) * 100) / 100 : 0,
  }
}

// ============================================================
// 3. 成交預測 (Deal Forecasting)
// ============================================================

/**
 * 計算加權管線金額（商機金額 × 階段機率）
 * @param {Array<object>} opportunities - 商機清單（含 value, stage）
 * @param {object} pipeline - 管線配置
 * @returns {{ totalWeighted: number, totalUnweighted: number, items: Array<object> }}
 */
export function calculateWeightedPipeline(opportunities = [], pipeline) {
  if (!pipeline || !pipeline.stageMap) {
    return { totalWeighted: 0, totalUnweighted: 0, items: [] }
  }

  let totalWeighted = 0
  let totalUnweighted = 0
  const items = opportunities.map(opp => {
    const stage = pipeline.stageMap[opp.stage]
    const probability = stage ? stage.probability : 0
    const value = opp.value || 0
    const weighted = Math.round(value * probability) / 100
    totalWeighted += weighted
    totalUnweighted += value
    return {
      id: opp.id,
      name: opp.name,
      stage: opp.stage,
      value,
      probability,
      weightedValue: Math.round(weighted * 100) / 100,
    }
  })

  return {
    totalWeighted: Math.round(totalWeighted * 100) / 100,
    totalUnweighted: Math.round(totalUnweighted * 100) / 100,
    items,
  }
}

/**
 * 依月份或季度產生預測報告（最佳 / 最差 / 預期）
 * @param {Array<object>} opportunities - 商機清單（含 value, stage, expected_close）
 * @param {object} pipeline - 管線配置
 * @param {{ type: 'month'|'quarter', year: number }} period - 預測期間
 * @returns {Array<{ period: string, best: number, worst: number, expected: number, count: number }>}
 */
export function generateForecast(opportunities = [], pipeline, period = { type: 'month', year: new Date().getFullYear() }) {
  if (!pipeline || !pipeline.stageMap) return []

  const buckets = {}

  for (const opp of opportunities) {
    if (!opp.expected_close) continue
    const d = new Date(opp.expected_close)
    if (d.getFullYear() !== period.year) continue

    let key
    if (period.type === 'quarter') {
      const q = Math.ceil((d.getMonth() + 1) / 3)
      key = `${period.year}-Q${q}`
    } else {
      key = `${period.year}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }

    if (!buckets[key]) buckets[key] = []
    buckets[key].push(opp)
  }

  // 排序期間 key
  const sortedKeys = Object.keys(buckets).sort()

  return sortedKeys.map(key => {
    const items = buckets[key]
    let best = 0
    let worst = 0
    let expected = 0

    for (const opp of items) {
      const value = opp.value || 0
      const stage = pipeline.stageMap[opp.stage]
      const prob = stage ? stage.probability / 100 : 0

      // 最佳: 全部成交
      best += value
      // 最差: 只計成交階段
      if (stage && stage.id === 'closed_won') worst += value
      // 預期: 加權
      expected += value * prob
    }

    return {
      period: key,
      best: Math.round(best * 100) / 100,
      worst: Math.round(worst * 100) / 100,
      expected: Math.round(expected * 100) / 100,
      count: items.length,
    }
  })
}

/**
 * 計算過去預測的準確度
 * @param {Array<{ period: string, expected: number }>} pastForecasts - 過去預測紀錄
 * @param {Array<{ period: string, actual: number }>} actuals - 實際結果
 * @returns {{ accuracy: number, mape: number, details: Array<object> }}
 */
export function getForecastAccuracy(pastForecasts = [], actuals = []) {
  const actualMap = Object.fromEntries(actuals.map(a => [a.period, a.actual]))
  const details = []
  let totalErrorPct = 0
  let matched = 0

  for (const f of pastForecasts) {
    const actual = actualMap[f.period]
    if (actual === undefined) continue
    matched++

    const error = Math.abs(f.expected - actual)
    // MAPE 分母避免除以零
    const errorPct = actual !== 0 ? (error / Math.abs(actual)) * 100 : (f.expected !== 0 ? 100 : 0)
    totalErrorPct += errorPct

    details.push({
      period: f.period,
      forecasted: Math.round(f.expected * 100) / 100,
      actual: Math.round(actual * 100) / 100,
      error: Math.round(error * 100) / 100,
      errorPct: Math.round(errorPct * 100) / 100,
    })
  }

  const mape = matched > 0 ? Math.round((totalErrorPct / matched) * 100) / 100 : 0
  // 準確度 = 100 - MAPE（最低為 0）
  const accuracy = Math.max(0, Math.round((100 - mape) * 100) / 100)

  return { accuracy, mape, details }
}

// ============================================================
// 4. 重複偵測 (Duplicate Detection)
// ============================================================

/**
 * 字串相似度計算（Levenshtein 距離為基礎，回傳 0-1）
 * @param {string} a - 字串 A
 * @param {string} b - 字串 B
 * @returns {number} 相似度分數 0-1
 */
export function calculateSimilarity(a, b) {
  if (!a && !b) return 1
  if (!a || !b) return 0

  const strA = String(a).toLowerCase().trim()
  const strB = String(b).toLowerCase().trim()

  if (strA === strB) return 1
  if (strA.length === 0 || strB.length === 0) return 0

  const lenA = strA.length
  const lenB = strB.length

  // Levenshtein 距離矩陣
  const matrix = []
  for (let i = 0; i <= lenA; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j
  }
  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = strA[i - 1] === strB[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,       // 刪除
        matrix[i][j - 1] + 1,       // 插入
        matrix[i - 1][j - 1] + cost  // 替換
      )
    }
  }

  const distance = matrix[lenA][lenB]
  const maxLen = Math.max(lenA, lenB)
  return Math.round((1 - distance / maxLen) * 100) / 100
}

/**
 * 偵測重複聯絡人（依姓名相似度、Email、電話）
 * @param {Array<object>} contacts - 聯絡人清單（含 name, email, phone）
 * @param {{ nameThreshold?: number }} [options] - 姓名相似度門檻（預設 0.8）
 * @returns {Array<{ pair: [object, object], reasons: string[], score: number }>}
 */
export function findDuplicateContacts(contacts = [], options = {}) {
  const threshold = options.nameThreshold || 0.8
  const duplicates = []

  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i]
      const b = contacts[j]
      const reasons = []
      let score = 0

      // Email 完全匹配
      if (a.email && b.email && a.email.toLowerCase().trim() === b.email.toLowerCase().trim()) {
        reasons.push('Email 相同')
        score += 0.5
      }

      // 電話匹配（移除空白與破折號比較）
      if (a.phone && b.phone) {
        const phoneA = String(a.phone).replace(/[\s\-()]/g, '')
        const phoneB = String(b.phone).replace(/[\s\-()]/g, '')
        if (phoneA === phoneB) {
          reasons.push('電話相同')
          score += 0.3
        }
      }

      // 姓名相似度
      if (a.name && b.name) {
        const nameSim = calculateSimilarity(a.name, b.name)
        if (nameSim >= threshold) {
          reasons.push(`姓名相似 (${Math.round(nameSim * 100)}%)`)
          score += nameSim * 0.4
        }
      }

      if (reasons.length > 0) {
        duplicates.push({
          pair: [a, b],
          reasons,
          score: Math.round(Math.min(1, score) * 100) / 100,
        })
      }
    }
  }

  // 依分數排序（高→低）
  return duplicates.sort((a, b) => b.score - a.score)
}

/**
 * 對每個欄位建議保留的最佳值
 * @param {Array<object>} records - 要合併的多筆紀錄
 * @returns {object} 每個欄位對應建議值
 */
export function suggestMergeFields(records = []) {
  if (records.length === 0) return {}
  if (records.length === 1) return { ...records[0] }

  // 取得所有欄位
  const allKeys = new Set()
  for (const r of records) {
    Object.keys(r).forEach(k => allKeys.add(k))
  }

  const suggestion = {}

  for (const key of allKeys) {
    // 跳過系統欄位
    if (key === 'id') {
      suggestion[key] = records[0][key]
      continue
    }

    // 優先選非空、最長的值
    const values = records.map(r => r[key]).filter(v => v !== undefined && v !== null && v !== '')

    if (values.length === 0) {
      suggestion[key] = records[0][key] !== undefined ? records[0][key] : ''
      continue
    }

    // 日期欄位取最新
    if (key.endsWith('_at') || key === 'created_at' || key === 'updated_at') {
      suggestion[key] = values.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      continue
    }

    // 數值欄位取最大
    if (typeof values[0] === 'number') {
      suggestion[key] = Math.max(...values)
      continue
    }

    // 字串取最長
    suggestion[key] = values.reduce((best, v) => (String(v).length > String(best).length ? v : best), values[0])
  }

  return suggestion
}

/**
 * 合併重複紀錄（以主紀錄為基礎，填補缺漏欄位）
 * @param {object} primary - 主紀錄
 * @param {Array<object>} duplicates - 重複紀錄
 * @returns {{ merged: object, mergedFrom: string[] }}
 */
export function mergeDuplicates(primary, duplicates = []) {
  if (!primary) return { merged: {}, mergedFrom: [] }

  const allRecords = [primary, ...duplicates]
  const suggestion = suggestMergeFields(allRecords)

  // 以 primary 的 id 為主
  const merged = {
    ...suggestion,
    id: primary.id,
    merged_at: new Date().toISOString(),
    merged_from: duplicates.map(d => d.id).filter(Boolean),
  }

  return {
    merged,
    mergedFrom: duplicates.map(d => d.id).filter(Boolean),
  }
}

// ============================================================
// 5. 行銷活動 ROI (Campaign ROI)
// ============================================================

/**
 * 計算行銷活動投資報酬率
 * @param {{ cost: number, revenue: number }} campaign - 含 cost 和 revenue
 * @returns {number} ROI 百分比
 */
export function calculateCampaignROI(campaign) {
  if (!campaign || !campaign.cost || campaign.cost === 0) return 0
  const roi = ((campaign.revenue || 0) - campaign.cost) / campaign.cost * 100
  return Math.round(roi * 100) / 100
}

/**
 * 計算每筆線索成本
 * @param {{ cost: number, leads_count: number }} campaign
 * @returns {number} 每筆線索成本
 */
export function calculateCostPerLead(campaign) {
  if (!campaign || !campaign.leads_count || campaign.leads_count === 0) return 0
  return Math.round((campaign.cost || 0) / campaign.leads_count * 100) / 100
}

/**
 * 計算每筆客戶獲取成本
 * @param {{ cost: number, customers_acquired: number }} campaign
 * @returns {number} 每筆客戶獲取成本
 */
export function calculateCostPerAcquisition(campaign) {
  if (!campaign || !campaign.customers_acquired || campaign.customers_acquired === 0) return 0
  return Math.round((campaign.cost || 0) / campaign.customers_acquired * 100) / 100
}

/**
 * 產生行銷活動比較報告
 * @param {Array<object>} campaigns - 行銷活動清單（含 name, cost, revenue, leads_count, customers_acquired）
 * @returns {{ campaigns: Array<object>, summary: object }}
 */
export function generateCampaignReport(campaigns = []) {
  const results = campaigns.map(c => ({
    name: c.name || '未命名活動',
    cost: Math.round((c.cost || 0) * 100) / 100,
    revenue: Math.round((c.revenue || 0) * 100) / 100,
    leads_count: c.leads_count || 0,
    customers_acquired: c.customers_acquired || 0,
    roi: calculateCampaignROI(c),
    costPerLead: calculateCostPerLead(c),
    costPerAcquisition: calculateCostPerAcquisition(c),
    conversionRate: c.leads_count > 0
      ? Math.round(((c.customers_acquired || 0) / c.leads_count) * 10000) / 100
      : 0,
  }))

  const totalCost = results.reduce((sum, r) => sum + r.cost, 0)
  const totalRevenue = results.reduce((sum, r) => sum + r.revenue, 0)
  const totalLeads = results.reduce((sum, r) => sum + r.leads_count, 0)
  const totalCustomers = results.reduce((sum, r) => sum + r.customers_acquired, 0)

  return {
    campaigns: results,
    summary: {
      totalCampaigns: results.length,
      totalCost: Math.round(totalCost * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalROI: totalCost > 0 ? Math.round(((totalRevenue - totalCost) / totalCost * 100) * 100) / 100 : 0,
      totalLeads,
      totalCustomers,
      avgCostPerLead: totalLeads > 0 ? Math.round((totalCost / totalLeads) * 100) / 100 : 0,
      avgCostPerAcquisition: totalCustomers > 0 ? Math.round((totalCost / totalCustomers) * 100) / 100 : 0,
    },
  }
}

// ============================================================
// 6. Web-to-Lead（網頁表單轉線索）
// ============================================================

/**
 * 處理網頁表單送出，驗證並建立線索
 * @param {object} formData - 表單資料（name, email, phone, company, message 等）
 * @param {{ requiredFields?: string[], source?: string }} [formConfig] - 表單設定
 * @returns {{ ok: boolean, lead?: object, errors?: string[] }}
 */
export function processWebFormSubmission(formData, formConfig = {}) {
  const requiredFields = formConfig.requiredFields || ['name', 'email']
  const errors = []

  // 必填驗證
  for (const field of requiredFields) {
    if (!formData[field] || String(formData[field]).trim() === '') {
      errors.push(`欄位「${field}」為必填`)
    }
  }

  // Email 格式驗證
  if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    errors.push('Email 格式不正確')
  }

  // 台灣電話格式（寬鬆驗證：允許 02-xxxx-xxxx, 09xx-xxx-xxx, +886 等）
  if (formData.phone) {
    const cleaned = String(formData.phone).replace(/[\s\-()]/g, '')
    if (!/^(\+?886|0)\d{8,10}$/.test(cleaned)) {
      errors.push('電話格式不正確')
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const lead = {
    id: `LEAD-${Date.now()}`,
    name: String(formData.name).trim(),
    email: formData.email ? String(formData.email).trim().toLowerCase() : '',
    phone: formData.phone || '',
    company: formData.company || '',
    message: formData.message || '',
    source: formConfig.source || 'web_form',
    status: 'new',
    assigned_to: null,
    submitted_at: new Date().toISOString(),
    first_contact_at: null,
  }

  return { ok: true, lead }
}

/**
 * 指派線索給業務人員
 * @param {object} lead - 線索物件
 * @param {Array<{ id: string, name: string, territory?: string, active_leads?: number }>} reps - 業務人員
 * @param {'round_robin'|'territory'|'load_balanced'} [method='round_robin'] - 分配方式
 * @param {{ lastAssignedIndex?: number, territory?: string }} [context] - 額外上下文
 * @returns {{ ok: boolean, lead?: object, assignedTo?: object, error?: string }}
 */
export function assignLeadToRep(lead, reps = [], method = 'round_robin', context = {}) {
  if (!lead) return { ok: false, error: '線索不可為空' }
  if (reps.length === 0) return { ok: false, error: '無可用業務人員' }

  const activeReps = reps.filter(r => r.active !== false)
  if (activeReps.length === 0) return { ok: false, error: '無可用業務人員（全部停用）' }

  let selected

  switch (method) {
    case 'round_robin': {
      // 輪流指派
      const idx = ((context.lastAssignedIndex || 0) + 1) % activeReps.length
      selected = activeReps[idx]
      break
    }

    case 'territory': {
      // 依區域指派
      const territory = lead.territory || lead.region || context.territory || ''
      const matched = activeReps.filter(r => r.territory === territory)
      if (matched.length === 0) {
        // 無對應區域，回退至輪流
        const idx = ((context.lastAssignedIndex || 0) + 1) % activeReps.length
        selected = activeReps[idx]
      } else {
        // 區域內選負載最低的
        selected = matched.reduce((min, r) =>
          (r.active_leads || 0) < (min.active_leads || 0) ? r : min
        , matched[0])
      }
      break
    }

    case 'load_balanced': {
      // 負載平衡：選目前線索數最少的
      selected = activeReps.reduce((min, r) =>
        (r.active_leads || 0) < (min.active_leads || 0) ? r : min
      , activeReps[0])
      break
    }

    default:
      return { ok: false, error: `不支援的分配方式: ${method}` }
  }

  const updatedLead = {
    ...lead,
    assigned_to: selected.id,
    assigned_at: new Date().toISOString(),
    status: 'assigned',
  }

  return { ok: true, lead: updatedLead, assignedTo: selected }
}

/**
 * 計算線索回應時間（從送出到首次聯繫）
 * @param {{ submitted_at: string, first_contact_at: string|null }} lead
 * @returns {{ responded: boolean, minutes?: number, hours?: number, withinSLA?: boolean }}
 */
export function calculateLeadResponseTime(lead) {
  if (!lead || !lead.submitted_at) {
    return { responded: false }
  }

  if (!lead.first_contact_at) {
    return { responded: false }
  }

  const submitted = new Date(lead.submitted_at).getTime()
  const contacted = new Date(lead.first_contact_at).getTime()
  const diffMs = contacted - submitted
  const minutes = Math.round((diffMs / (1000 * 60)) * 100) / 100
  const hours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100

  // SLA: 4 小時內回應
  const withinSLA = hours <= 4

  return { responded: true, minutes, hours, withinSLA }
}

/**
 * 計算線索轉換率
 * @param {Array<object>} leads - 線索清單（含 status, submitted_at）
 * @param {{ start: string, end: string }} [period] - 篩選期間
 * @returns {{ total: number, converted: number, rate: number }}
 */
export function getLeadConversionRate(leads = [], period) {
  let filtered = leads

  if (period && period.start && period.end) {
    const startMs = new Date(period.start).getTime()
    const endMs = new Date(period.end).getTime()
    filtered = leads.filter(l => {
      const t = new Date(l.submitted_at).getTime()
      return t >= startMs && t <= endMs
    })
  }

  const total = filtered.length
  // 轉換定義: 狀態為 qualified, proposal, negotiation, closed_won 等進入商機的
  const convertedStatuses = ['qualified', 'proposal', 'negotiation', 'closed_won', 'converted', 'opportunity']
  const converted = filtered.filter(l => convertedStatuses.includes(l.status)).length
  const rate = total > 0 ? Math.round((converted / total) * 10000) / 100 : 0

  return { total, converted, rate }
}
