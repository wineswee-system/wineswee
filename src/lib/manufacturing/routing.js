export function createRouting(productCode, operations) {
  if (!productCode) throw new Error('產品代碼為必填')
  if (!operations || operations.length === 0) throw new Error('工序不可為空')

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

    const dailyCap = cap[op.workCenterId] || 480
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

    currentDate = new Date(opEnd)
    currentDate.setDate(currentDate.getDate() + 1)
  }

  return schedule
}

export function backwardSchedule(routing, qty, dueDate, workCenterCapacity) {
  if (!routing || !routing.operations) throw new Error('工藝路線為必填')
  if (!qty || qty <= 0) throw new Error('生產數量必須大於零')
  if (!dueDate) throw new Error('交期為必填')

  const cap = workCenterCapacity || {}
  const schedule = []
  let currentDate = new Date(dueDate)

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

    currentDate = new Date(opStart)
    currentDate.setDate(currentDate.getDate() - 1)
  }

  return schedule
}
