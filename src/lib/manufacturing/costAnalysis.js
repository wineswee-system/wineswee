export function calculateMaterialVariance(standardCost, actualCost, qty) {
  if (!standardCost || !actualCost) throw new Error('標準成本與實際成本皆為必填')

  const stdPrice = standardCost.unitPrice || 0
  const actPrice = actualCost.unitPrice || 0
  const stdQty = (standardCost.qty || 0) * (qty || 1)
  const actQty = actualCost.qty || 0

  const priceVariance = Math.round((actPrice - stdPrice) * actQty * 100) / 100
  const usageVariance = Math.round((actQty - stdQty) * stdPrice * 100) / 100
  const totalVariance = Math.round((priceVariance + usageVariance) * 100) / 100

  return {
    priceVariance,
    usageVariance,
    totalVariance,
    favorable: totalVariance <= 0,
  }
}

export function calculateLaborVariance(standardHours, actualHours, standardRate, actualRate) {
  const sh = standardHours || 0
  const ah = actualHours || 0
  const sr = standardRate || 0
  const ar = actualRate || 0

  const rateVariance = Math.round((ar - sr) * ah * 100) / 100
  const efficiencyVariance = Math.round((ah - sh) * sr * 100) / 100
  const totalVariance = Math.round((rateVariance + efficiencyVariance) * 100) / 100

  return {
    rateVariance,
    efficiencyVariance,
    totalVariance,
    favorable: totalVariance <= 0,
  }
}

export function calculateOverheadVariance(budgetedOH, actualOH, standardHours, actualHours) {
  const boh = budgetedOH || 0
  const aoh = actualOH || 0
  const sh = standardHours || 0
  const ah = actualHours || 0

  const budgetRate = sh > 0 ? boh / sh : 0

  const spendingVariance = Math.round((aoh - boh) * 100) / 100
  const efficiencyVariance = Math.round((ah - sh) * budgetRate * 100) / 100
  const totalVariance = Math.round((spendingVariance + efficiencyVariance) * 100) / 100

  return {
    spendingVariance,
    efficiencyVariance,
    totalVariance,
    favorable: totalVariance <= 0,
  }
}

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
