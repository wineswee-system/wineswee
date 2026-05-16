export const MO_STATES = {
  PLANNED: '已規劃',
  RELEASED: '已發放',
  IN_PROGRESS: '生產中',
  COMPLETED: '已完成',
  CLOSED: '已結案',
  CANCELLED: '已取消',
}

export const MO_TRANSITIONS = {
  '已規劃': ['已發放', '已取消'],
  '已發放': ['生產中', '已取消'],
  '生產中': ['已完成'],
  '已完成': ['已結案'],
  '已結案': [],
  '已取消': [],
}

export function canTransition(currentState, targetState) {
  const allowed = MO_TRANSITIONS[currentState]
  if (!allowed) return false
  return allowed.includes(targetState)
}

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

export function calculateOperationEfficiency(planned, actual) {
  if (!planned || planned <= 0) return 0
  if (!actual || actual <= 0) return 0
  return Math.round((planned / actual) * 10000) / 100
}

export function getShopFloorStatus(mos, timeEntries) {
  const allMOs = mos || []
  const allEntries = timeEntries || []

  const activeMOs = allMOs.filter(mo => mo.state === MO_STATES.IN_PROGRESS)

  const activeEntries = allEntries.filter(e => e.status === '進行中')
  const operatorAssignments = activeEntries.map(e => ({
    operatorId: e.operatorId,
    moId: e.moId,
    operationId: e.operationId,
    startTime: e.startTime,
  }))

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
