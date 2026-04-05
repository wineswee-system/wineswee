/**
 * 製造模組引擎 — Manufacturing Module Engine
 *
 * 核心功能：
 * 1. 製造工單（MO）生命週期管理
 * 2. 現場執行（打卡上下工、效率計算）
 * 3. 品質檢驗引擎（含 SPC 統計製程控制）
 * 4. 工藝路線 / 工序排程
 * 5. BOM 版本控管
 * 6. 生產成本差異分析
 * 7. OEE 設備綜合效率
 *
 * 純函式，JSDoc 於所有匯出。金額/數量統一用 Math.round(x * 100) / 100
 */

// ══════════════════════════════════════
//  常數定義
// ══════════════════════════════════════

/** 製造工單狀態 */
export const MO_STATES = {
  PLANNED: '已規劃',
  RELEASED: '已發放',
  IN_PROGRESS: '生產中',
  COMPLETED: '已完成',
  CLOSED: '已結案',
  CANCELLED: '已取消',
}

/** 製造工單狀態轉換規則 */
export const MO_TRANSITIONS = {
  '已規劃': ['已發放', '已取消'],
  '已發放': ['生產中', '已取消'],
  '生產中': ['已完成'],
  '已完成': ['已結案'],
  '已結案': [],
  '已取消': [],
}

/** 檢驗類型 */
export const INSPECTION_TYPES = ['incoming', 'in_process', 'final']

/** 檢驗結果 */
export const INSPECTION_RESULTS = ['accept', 'reject', 'rework', 'conditional_accept']

// ══════════════════════════════════════
//  1. 製造工單（MO）生命週期
// ══════════════════════════════════════

/**
 * 檢查狀態轉換是否合法
 *
 * @param {string} currentState - 目前狀態（中文）
 * @param {string} targetState  - 目標狀態（中文）
 * @returns {boolean} 是否允許轉換
 */
export function canTransition(currentState, targetState) {
  const allowed = MO_TRANSITIONS[currentState]
  if (!allowed) return false
  return allowed.includes(targetState)
}

/**
 * 建立製造工單
 *
 * @param {string} product  - 產品代碼
 * @param {number} qty      - 計畫生產數量
 * @param {string} bomId    - BOM 編號
 * @param {string} dueDate  - 交期（ISO 日期字串）
 * @param {number} priority - 優先順序（1 最高）
 * @returns {Object} 製造工單物件
 */
export function createMO(product, qty, bomId, dueDate, priority = 5) {
  if (!product) throw new Error('產品代碼為必填')
  if (!qty || qty <= 0) throw new Error('生產數量必須大於零')
  if (!bomId) throw new Error('BOM 編號為必填')
  if (!dueDate) throw new Error('交期為必填')

  return {
    id: `MO-${Date.now()}`,
    product,
    qty: Math.round(qty * 100) / 100,
    bomId,
    dueDate,
    priority,
    state: MO_STATES.PLANNED,
    history: [
      {
        from: null,
        to: MO_STATES.PLANNED,
        at: new Date().toISOString(),
        by: 'system',
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

/**
 * 驗證並執行工單狀態轉換
 *
 * @param {Object} mo        - 製造工單物件
 * @param {string} newState  - 目標狀態（中文）
 * @param {string} userId    - 操作人員 ID
 * @returns {Object} 更新後的製造工單（新物件）
 * @throws {Error} 若轉換不合法
 */
export function transitionMO(mo, newState, userId) {
  if (!mo) throw new Error('製造工單為必填')
  if (!newState) throw new Error('目標狀態為必填')
  if (!userId) throw new Error('操作人員 ID 為必填')

  if (!canTransition(mo.state, newState)) {
    throw new Error(
      `不允許從「${mo.state}」轉換至「${newState}」`
    )
  }

  return {
    ...mo,
    state: newState,
    history: [
      ...mo.history,
      {
        from: mo.state,
        to: newState,
        at: new Date().toISOString(),
        by: userId,
      },
    ],
  }
}

// ══════════════════════════════════════
//  2. 現場執行（Shop Floor Execution）
// ══════════════════════════════════════

/**
 * 工序打卡上工
 *
 * @param {string} moId        - 製造工單 ID
 * @param {string} operationId - 工序 ID
 * @param {string} operatorId  - 操作員 ID
 * @param {string} startTime   - 開始時間（ISO 字串）
 * @returns {Object} 時間紀錄
 */
export function clockOnOperation(moId, operationId, operatorId, startTime) {
  if (!moId) throw new Error('製造工單 ID 為必填')
  if (!operationId) throw new Error('工序 ID 為必填')
  if (!operatorId) throw new Error('操作員 ID 為必填')

  return {
    id: `TE-${Date.now()}`,
    moId,
    operationId,
    operatorId,
    startTime: startTime || new Date().toISOString(),
    endTime: null,
    qtyProduced: 0,
    qtyDefect: 0,
    status: '進行中',
  }
}

/**
 * 工序打卡下工
 *
 * @param {Object} timeEntry   - 上工時建立的時間紀錄
 * @param {string} endTime     - 結束時間（ISO 字串）
 * @param {number} qtyProduced - 生產良品數量
 * @param {number} qtyDefect   - 不良品數量
 * @returns {Object} 完成的時間紀錄（新物件）
 */
export function clockOffOperation(timeEntry, endTime, qtyProduced, qtyDefect = 0) {
  if (!timeEntry) throw new Error('時間紀錄為必填')
  if (!endTime) throw new Error('結束時間為必填')
  if (qtyProduced == null || qtyProduced < 0) throw new Error('生產數量不可為負數')

  const end = new Date(endTime)
  const start = new Date(timeEntry.startTime)
  if (end <= start) throw new Error('結束時間必須晚於開始時間')

  return {
    ...timeEntry,
    endTime,
    qtyProduced: Math.round(qtyProduced * 100) / 100,
    qtyDefect: Math.round((qtyDefect || 0) * 100) / 100,
    status: '已完成',
    durationMinutes: Math.round(((end - start) / 60000) * 100) / 100,
  }
}

/**
 * 計算工序效率
 *
 * 效率 = 標準工時 / 實際工時 × 100%
 *
 * @param {number} planned - 計畫（標準）時間（分鐘）
 * @param {number} actual  - 實際時間（分鐘）
 * @returns {number} 效率百分比（例如 95.5 表示 95.5%）
 */
export function calculateOperationEfficiency(planned, actual) {
  if (!planned || planned <= 0) return 0
  if (!actual || actual <= 0) return 0
  return Math.round((planned / actual) * 10000) / 100
}

/**
 * 取得現場看板資料
 *
 * @param {Array} mos         - 全部製造工單陣列
 * @param {Array} timeEntries - 全部時間紀錄陣列
 * @returns {Object} 現場狀態看板
 *   { activeMOs, operatorAssignments, delayedMOs, summary }
 */
export function getShopFloorStatus(mos, timeEntries) {
  const allMOs = mos || []
  const allEntries = timeEntries || []

  // 進行中的工單
  const activeMOs = allMOs.filter(mo => mo.state === MO_STATES.IN_PROGRESS)

  // 操作員分配：目前進行中的時間紀錄
  const activeEntries = allEntries.filter(e => e.status === '進行中')
  const operatorAssignments = activeEntries.map(e => ({
    operatorId: e.operatorId,
    moId: e.moId,
    operationId: e.operationId,
    startTime: e.startTime,
  }))

  // 逾期工單：交期已過但未完成
  const now = new Date().toISOString()
  const delayedMOs = allMOs.filter(
    mo =>
      mo.dueDate < now &&
      mo.state !== MO_STATES.COMPLETED &&
      mo.state !== MO_STATES.CLOSED &&
      mo.state !== MO_STATES.CANCELLED
  )

  return {
    activeMOs,
    operatorAssignments,
    delayedMOs,
    summary: {
      totalActive: activeMOs.length,
      totalOperators: new Set(activeEntries.map(e => e.operatorId)).size,
      totalDelayed: delayedMOs.length,
    },
  }
}

// ══════════════════════════════════════
//  3. 品質檢驗引擎
// ══════════════════════════════════════

/**
 * 建立檢驗紀錄
 *
 * @param {string} type        - 檢驗類型（incoming / in_process / final）
 * @param {string} referenceId - 關聯單據 ID（採購單、工單等）
 * @param {Array}  items       - 待檢項目 [{ itemCode, itemName, spec, qty }]
 * @param {string} inspector   - 檢驗人員 ID
 * @returns {Object} 檢驗紀錄
 */
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

/**
 * 記錄檢驗結果（逐項）
 *
 * @param {Object} inspection - 檢驗紀錄
 * @param {Array}  results    - 各項結果
 *   [{ itemCode, result: 'accept'|'reject'|'rework'|'conditional_accept', measurements: number[], notes: string }]
 * @returns {Object} 更新後的檢驗紀錄（新物件）
 */
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

  // 全部項目皆已判定 → 檢驗完成
  const allJudged = updatedItems.every(i => i.result !== null)
  const hasReject = updatedItems.some(i => i.result === 'reject')

  return {
    ...inspection,
    items: updatedItems,
    status: allJudged ? (hasReject ? '不合格' : '合格') : '檢驗中',
    completedAt: allJudged ? new Date().toISOString() : null,
  }
}

/**
 * 計算不良率
 *
 * @param {Array}  inspections - 檢驗紀錄陣列
 * @param {Object} period      - 期間 { from: string, to: string }（ISO 日期字串）
 * @returns {Object} { totalInspected, totalDefects, defectRate }
 */
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

/**
 * 統計製程控制（SPC）評估
 *
 * 計算平均值、標準差、Cp、Cpk
 *
 * @param {number[]} measurements - 量測值陣列
 * @param {Object}   spec         - 規格 { usl: 上規格界限, lsl: 下規格界限, target?: 目標值 }
 * @returns {Object} { mean, stdDev, cp, cpk, count }
 */
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

  // Cp = (USL - LSL) / (6σ)
  const cp = stdDev > 0
    ? Math.round(((spec.usl - spec.lsl) / (6 * stdDev)) * 100) / 100
    : 0

  // Cpk = min((USL - μ) / 3σ, (μ - LSL) / 3σ)
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

/**
 * 判斷製程是否在管制狀態內
 *
 * 規則：所有量測值在管制界限 (UCL / LCL) 之間
 *
 * @param {number[]} measurements  - 量測值陣列
 * @param {Object}   controlLimits - { ucl: 管制上限, lcl: 管制下限 }
 * @returns {boolean} true = 製程在管制內
 */
export function isInControl(measurements, controlLimits) {
  if (!measurements || measurements.length === 0) return true
  if (!controlLimits || controlLimits.ucl == null || controlLimits.lcl == null) {
    throw new Error('需提供管制上限 (ucl) 與管制下限 (lcl)')
  }

  return measurements.every(
    v => v >= controlLimits.lcl && v <= controlLimits.ucl
  )
}

// ══════════════════════════════════════
//  4. 工藝路線 / 工序排程（Routing）
// ══════════════════════════════════════

/**
 * 建立工藝路線
 *
 * @param {string} productCode - 產品代碼
 * @param {Array}  operations  - 工序陣列
 *   [{ seq, workCenterId, setupTime, runTimePerUnit, description }]
 * @returns {Object} 工藝路線
 */
export function createRouting(productCode, operations) {
  if (!productCode) throw new Error('產品代碼為必填')
  if (!operations || operations.length === 0) throw new Error('工序不可為空')

  // 依序號排序
  const sorted = [...operations].sort((a, b) => a.seq - b.seq)

  return {
    id: `RTG-${Date.now()}`,
    productCode,
    operations: sorted.map(op => ({
      seq: op.seq,
      workCenterId: op.workCenterId,
      setupTime: Math.round((op.setupTime || 0) * 100) / 100,
      runTimePerUnit: Math.round((op.runTimePerUnit || 0) * 100) / 100,
      description: op.description || '',
    })),
    createdAt: new Date().toISOString(),
  }
}

/**
 * 計算工藝路線總工時
 *
 * 總時間 = Σ(setupTime + runTimePerUnit × qty)
 *
 * @param {Object} routing - 工藝路線
 * @param {number} qty     - 生產數量
 * @returns {Object} { totalTime, breakdown: [{ seq, setupTime, runTime, total }] }
 */
export function calculateRoutingTime(routing, qty) {
  if (!routing || !routing.operations) throw new Error('工藝路線為必填')
  if (!qty || qty <= 0) throw new Error('生產數量必須大於零')

  let totalTime = 0
  const breakdown = []

  for (const op of routing.operations) {
    const setup = op.setupTime || 0
    const run = (op.runTimePerUnit || 0) * qty
    const opTotal = setup + run

    totalTime += opTotal
    breakdown.push({
      seq: op.seq,
      workCenterId: op.workCenterId,
      setupTime: Math.round(setup * 100) / 100,
      runTime: Math.round(run * 100) / 100,
      total: Math.round(opTotal * 100) / 100,
    })
  }

  return {
    totalTime: Math.round(totalTime * 100) / 100,
    breakdown,
  }
}

/**
 * 正向排程：由開工日向後排
 *
 * 每道工序依序安排，並考慮工作中心每日可用產能（分鐘）。
 *
 * @param {Object} routing            - 工藝路線
 * @param {number} qty                - 生產數量
 * @param {string} startDate          - 開工日（ISO 日期字串）
 * @param {Object} workCenterCapacity - 各工作中心每日產能（分鐘）
 *   { [workCenterId]: minutesPerDay }
 * @returns {Array} 排程結果 [{ seq, workCenterId, startDate, endDate, durationMinutes }]
 */
export function scheduleOperations(routing, qty, startDate, workCenterCapacity) {
  if (!routing || !routing.operations) throw new Error('工藝路線為必填')
  if (!qty || qty <= 0) throw new Error('生產數量必須大於零')
  if (!startDate) throw new Error('開工日為必填')

  const cap = workCenterCapacity || {}
  const schedule = []
  let currentDate = new Date(startDate)

  for (const op of routing.operations) {
    const setup = op.setupTime || 0
    const run = (op.runTimePerUnit || 0) * qty
    const totalMinutes = setup + run

    const dailyCap = cap[op.workCenterId] || 480 // 預設 8 小時
    const daysNeeded = Math.ceil(totalMinutes / dailyCap)

    const opStart = new Date(currentDate)
    const opEnd = new Date(currentDate)
    opEnd.setDate(opEnd.getDate() + daysNeeded - 1)

    schedule.push({
      seq: op.seq,
      workCenterId: op.workCenterId,
      startDate: opStart.toISOString().slice(0, 10),
      endDate: opEnd.toISOString().slice(0, 10),
      durationMinutes: Math.round(totalMinutes * 100) / 100,
      daysNeeded,
    })

    // 下一道工序從本道工序完成的隔天開始
    currentDate = new Date(opEnd)
    currentDate.setDate(currentDate.getDate() + 1)
  }

  return schedule
}

/**
 * 逆向排程：由交期向前排
 *
 * 從最後一道工序往前推算，確保在交期前完成。
 *
 * @param {Object} routing            - 工藝路線
 * @param {number} qty                - 生產數量
 * @param {string} dueDate            - 交期（ISO 日期字串）
 * @param {Object} workCenterCapacity - 各工作中心每日產能（分鐘）
 * @returns {Array} 排程結果（同 scheduleOperations 格式）
 */
export function backwardSchedule(routing, qty, dueDate, workCenterCapacity) {
  if (!routing || !routing.operations) throw new Error('工藝路線為必填')
  if (!qty || qty <= 0) throw new Error('生產數量必須大於零')
  if (!dueDate) throw new Error('交期為必填')

  const cap = workCenterCapacity || {}
  const schedule = []
  let currentDate = new Date(dueDate)

  // 從最後一道工序往前排
  const reversed = [...routing.operations].reverse()

  for (const op of reversed) {
    const setup = op.setupTime || 0
    const run = (op.runTimePerUnit || 0) * qty
    const totalMinutes = setup + run

    const dailyCap = cap[op.workCenterId] || 480
    const daysNeeded = Math.ceil(totalMinutes / dailyCap)

    const opEnd = new Date(currentDate)
    const opStart = new Date(currentDate)
    opStart.setDate(opStart.getDate() - daysNeeded + 1)

    schedule.unshift({
      seq: op.seq,
      workCenterId: op.workCenterId,
      startDate: opStart.toISOString().slice(0, 10),
      endDate: opEnd.toISOString().slice(0, 10),
      durationMinutes: Math.round(totalMinutes * 100) / 100,
      daysNeeded,
    })

    // 前一道工序的完成日 = 本道工序開始日的前一天
    currentDate = new Date(opStart)
    currentDate.setDate(currentDate.getDate() - 1)
  }

  return schedule
}

// ══════════════════════════════════════
//  5. BOM 版本控管
// ══════════════════════════════════════

/**
 * 建立 BOM 新版本
 *
 * @param {string} bomId         - BOM 編號
 * @param {string} version       - 版本號（例如 'v2.0'）
 * @param {string} effectiveDate - 生效日（ISO 日期字串）
 * @param {Array}  changes       - 變更內容
 *   [{ componentCode, action: 'add'|'remove'|'modify', oldQty?, newQty?, notes? }]
 * @param {string} changedBy     - 變更人員 ID
 * @returns {Object} BOM 版本紀錄
 */
export function createBOMVersion(bomId, version, effectiveDate, changes, changedBy) {
  if (!bomId) throw new Error('BOM 編號為必填')
  if (!version) throw new Error('版本號為必填')
  if (!effectiveDate) throw new Error('生效日為必填')
  if (!changes || changes.length === 0) throw new Error('變更內容不可為空')
  if (!changedBy) throw new Error('變更人員為必填')

  return {
    id: `BOMV-${Date.now()}`,
    bomId,
    version,
    effectiveDate,
    changes,
    changedBy,
    createdAt: new Date().toISOString(),
  }
}

/**
 * 取得指定日期生效的 BOM 版本
 *
 * 回傳生效日 <= asOfDate 的最新版本。
 *
 * @param {Array}  bomVersions - BOM 版本陣列
 * @param {string} asOfDate    - 基準日（ISO 日期字串）
 * @returns {Object|null} 生效的 BOM 版本，或 null
 */
export function getEffectiveBOM(bomVersions, asOfDate) {
  if (!bomVersions || bomVersions.length === 0) return null
  if (!asOfDate) throw new Error('基準日為必填')

  const effective = bomVersions
    .filter(v => v.effectiveDate <= asOfDate)
    .sort((a, b) => (a.effectiveDate > b.effectiveDate ? -1 : 1))

  return effective.length > 0 ? effective[0] : null
}

/**
 * 比較兩個 BOM 版本差異
 *
 * @param {Object} v1 - BOM 版本 1（含 changes 陣列）
 * @param {Object} v2 - BOM 版本 2（含 changes 陣列）
 * @returns {Object} 差異報告 { added, removed, modified }
 */
export function compareBOMVersions(v1, v2) {
  if (!v1 || !v2) throw new Error('兩個 BOM 版本皆為必填')

  const components1 = new Map()
  const components2 = new Map()

  // 從 changes 中收集元件與數量
  for (const c of v1.changes || []) {
    if (c.action !== 'remove') {
      components1.set(c.componentCode, c.newQty || c.oldQty || 0)
    }
  }
  for (const c of v2.changes || []) {
    if (c.action !== 'remove') {
      components2.set(c.componentCode, c.newQty || c.oldQty || 0)
    }
  }

  const added = []
  const removed = []
  const modified = []

  // v2 有但 v1 沒有 → 新增
  for (const [code, qty] of components2) {
    if (!components1.has(code)) {
      added.push({ componentCode: code, qty })
    }
  }

  // v1 有但 v2 沒有 → 移除
  for (const [code, qty] of components1) {
    if (!components2.has(code)) {
      removed.push({ componentCode: code, qty })
    }
  }

  // 兩邊都有但數量不同 → 修改
  for (const [code, qty2] of components2) {
    if (components1.has(code)) {
      const qty1 = components1.get(code)
      if (qty1 !== qty2) {
        modified.push({
          componentCode: code,
          oldQty: qty1,
          newQty: qty2,
          diff: Math.round((qty2 - qty1) * 100) / 100,
        })
      }
    }
  }

  return { added, removed, modified }
}

// ══════════════════════════════════════
//  6. 生產成本差異分析
// ══════════════════════════════════════

/**
 * 計算材料差異（Material Variance）
 *
 * 價格差異 = (實際單價 - 標準單價) × 實際數量
 * 用量差異 = (實際數量 - 標準數量) × 標準單價
 *
 * @param {Object} standardCost - { unitPrice, qty } 標準成本
 * @param {Object} actualCost   - { unitPrice, qty } 實際成本
 * @param {number} qty          - 生產數量（用於計算標準用量）
 * @returns {Object} { priceVariance, usageVariance, totalVariance }
 */
export function calculateMaterialVariance(standardCost, actualCost, qty) {
  if (!standardCost || !actualCost) throw new Error('標準成本與實際成本皆為必填')

  const stdPrice = standardCost.unitPrice || 0
  const actPrice = actualCost.unitPrice || 0
  const stdQty = (standardCost.qty || 0) * (qty || 1)
  const actQty = actualCost.qty || 0

  // 價格差異 = (AP - SP) × AQ
  const priceVariance = Math.round((actPrice - stdPrice) * actQty * 100) / 100
  // 用量差異 = (AQ - SQ) × SP
  const usageVariance = Math.round((actQty - stdQty) * stdPrice * 100) / 100
  const totalVariance = Math.round((priceVariance + usageVariance) * 100) / 100

  return {
    priceVariance,
    usageVariance,
    totalVariance,
    favorable: totalVariance <= 0,
  }
}

/**
 * 計算人工差異（Labor Variance）
 *
 * 工資率差異 = (實際工資率 - 標準工資率) × 實際工時
 * 效率差異   = (實際工時 - 標準工時) × 標準工資率
 *
 * @param {number} standardHours - 標準工時
 * @param {number} actualHours   - 實際工時
 * @param {number} standardRate  - 標準工資率（每小時）
 * @param {number} actualRate    - 實際工資率（每小時）
 * @returns {Object} { rateVariance, efficiencyVariance, totalVariance }
 */
export function calculateLaborVariance(standardHours, actualHours, standardRate, actualRate) {
  const sh = standardHours || 0
  const ah = actualHours || 0
  const sr = standardRate || 0
  const ar = actualRate || 0

  // 工資率差異 = (AR - SR) × AH
  const rateVariance = Math.round((ar - sr) * ah * 100) / 100
  // 效率差異 = (AH - SH) × SR
  const efficiencyVariance = Math.round((ah - sh) * sr * 100) / 100
  const totalVariance = Math.round((rateVariance + efficiencyVariance) * 100) / 100

  return {
    rateVariance,
    efficiencyVariance,
    totalVariance,
    favorable: totalVariance <= 0,
  }
}

/**
 * 計算製造費用差異（Overhead Variance）
 *
 * 支出差異 = 實際製造費用 - 預算製造費用
 * 效率差異 = (實際工時 - 標準工時) × 預算分攤率
 *
 * @param {number} budgetedOH    - 預算製造費用
 * @param {number} actualOH      - 實際製造費用
 * @param {number} standardHours - 標準工時
 * @param {number} actualHours   - 實際工時
 * @returns {Object} { spendingVariance, efficiencyVariance, totalVariance }
 */
export function calculateOverheadVariance(budgetedOH, actualOH, standardHours, actualHours) {
  const boh = budgetedOH || 0
  const aoh = actualOH || 0
  const sh = standardHours || 0
  const ah = actualHours || 0

  // 預算分攤率 = 預算OH / 標準工時
  const budgetRate = sh > 0 ? boh / sh : 0

  // 支出差異 = 實際OH - 預算OH
  const spendingVariance = Math.round((aoh - boh) * 100) / 100
  // 效率差異 = (AH - SH) × 預算分攤率
  const efficiencyVariance = Math.round((ah - sh) * budgetRate * 100) / 100
  const totalVariance = Math.round((spendingVariance + efficiencyVariance) * 100) / 100

  return {
    spendingVariance,
    efficiencyVariance,
    totalVariance,
    favorable: totalVariance <= 0,
  }
}

/**
 * 產生完整成本差異報告
 *
 * @param {Object} mo       - 製造工單
 * @param {Object} standard - 標準成本
 *   { material: { unitPrice, qty }, laborHours, laborRate, overhead }
 * @param {Object} actual   - 實際成本
 *   { material: { unitPrice, qty }, laborHours, laborRate, overhead }
 * @returns {Object} 完整差異報告
 */
export function generateCostVarianceReport(mo, standard, actual) {
  if (!mo) throw new Error('製造工單為必填')
  if (!standard || !actual) throw new Error('標準成本與實際成本皆為必填')

  const materialVar = calculateMaterialVariance(
    standard.material,
    actual.material,
    mo.qty
  )

  const laborVar = calculateLaborVariance(
    standard.laborHours,
    actual.laborHours,
    standard.laborRate,
    actual.laborRate
  )

  const overheadVar = calculateOverheadVariance(
    standard.overhead,
    actual.overhead,
    standard.laborHours,
    actual.laborHours
  )

  const totalVariance = Math.round(
    (materialVar.totalVariance + laborVar.totalVariance + overheadVar.totalVariance) * 100
  ) / 100

  return {
    moId: mo.id,
    product: mo.product,
    qty: mo.qty,
    material: materialVar,
    labor: laborVar,
    overhead: overheadVar,
    totalVariance,
    favorable: totalVariance <= 0,
    generatedAt: new Date().toISOString(),
  }
}

// ══════════════════════════════════════
//  7. OEE 設備綜合效率
// ══════════════════════════════════════

/**
 * 計算可用率 (Availability)
 *
 * 可用率 = (計畫時間 - 停機時間) / 計畫時間
 *
 * @param {number} plannedTime - 計畫生產時間（分鐘）
 * @param {number} downtime    - 停機時間（分鐘）
 * @returns {number} 可用率（0–1 之間）
 */
export function calculateAvailability(plannedTime, downtime) {
  if (!plannedTime || plannedTime <= 0) return 0
  const dt = downtime || 0
  const result = (plannedTime - dt) / plannedTime
  return Math.round(Math.max(0, Math.min(1, result)) * 10000) / 10000
}

/**
 * 計算表現率 (Performance)
 *
 * 表現率 = (理想週期時間 × 生產數量) / 運轉時間
 *
 * @param {number} idealCycleTime - 理想週期時間（分鐘/件）
 * @param {number} totalPieces    - 生產總數量
 * @param {number} runTime        - 實際運轉時間（分鐘）
 * @returns {number} 表現率（0–1 之間）
 */
export function calculatePerformance(idealCycleTime, totalPieces, runTime) {
  if (!runTime || runTime <= 0) return 0
  if (!idealCycleTime || !totalPieces) return 0
  const result = (idealCycleTime * totalPieces) / runTime
  return Math.round(Math.max(0, Math.min(1, result)) * 10000) / 10000
}

/**
 * 計算品質率 (Quality)
 *
 * 品質率 = (生產總數 - 不良品數) / 生產總數
 *
 * @param {number} totalPieces - 生產總數量
 * @param {number} defects     - 不良品數量
 * @returns {number} 品質率（0–1 之間）
 */
export function calculateQuality(totalPieces, defects) {
  if (!totalPieces || totalPieces <= 0) return 0
  const d = defects || 0
  const result = (totalPieces - d) / totalPieces
  return Math.round(Math.max(0, Math.min(1, result)) * 10000) / 10000
}

/**
 * 計算 OEE 設備綜合效率
 *
 * OEE = 可用率 × 表現率 × 品質率
 *
 * @param {number} availability - 可用率（0–1）
 * @param {number} performance  - 表現率（0–1）
 * @param {number} quality      - 品質率（0–1）
 * @returns {Object} { oee, availability, performance, quality, category }
 */
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

/**
 * OEE 等級分類
 *
 * @param {number} oee - OEE 值（0–1）
 * @returns {string} 等級：World Class / Good / Needs Improvement
 */
export function getOEECategory(oee) {
  if (oee >= 0.85) return 'World Class'
  if (oee >= 0.70) return 'Good'
  return 'Needs Improvement'
}
