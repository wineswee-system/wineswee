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

export function getEffectiveBOM(bomVersions, asOfDate) {
  if (!bomVersions || bomVersions.length === 0) return null
  if (!asOfDate) throw new Error('基準日為必填')

  const effective = bomVersions
    .filter(v => v.effectiveDate <= asOfDate)
    .sort((a, b) => (a.effectiveDate > b.effectiveDate ? -1 : 1))

  return effective.length > 0 ? effective[0] : null
}

export function compareBOMVersions(v1, v2) {
  if (!v1 || !v2) throw new Error('兩個 BOM 版本皆為必填')

  const components1 = new Map()
  const components2 = new Map()

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

  for (const [code, qty] of components2) {
    if (!components1.has(code)) {
      added.push({ componentCode: code, qty })
    }
  }

  for (const [code, qty] of components1) {
    if (!components2.has(code)) {
      removed.push({ componentCode: code, qty })
    }
  }

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
