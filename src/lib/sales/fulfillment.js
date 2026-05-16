function round2(x) {
  return Math.round(x * 100) / 100;
}

export function createPartialShipment(so, shippedItems) {
  const shipmentId = `SHP-${so.soId}-${Date.now()}`;
  const shippedMap = {};
  for (const item of (shippedItems || [])) {
    shippedMap[item.lineId] = item.shippedQty || 0;
  }

  const shippedLines = [];
  const remainingLines = [];

  for (const line of (so.lines || [])) {
    const shipped = shippedMap[line.lineId] || 0;
    const actualShipped = Math.min(shipped, line.qty);

    if (actualShipped > 0) {
      shippedLines.push({
        lineId: line.lineId,
        sku: line.sku,
        shippedQty: actualShipped,
        amount: round2(actualShipped * (line.unitPrice || 0)),
      });
    }

    const remaining = line.qty - actualShipped;
    if (remaining > 0) {
      remainingLines.push({
        lineId: line.lineId,
        sku: line.sku,
        remainingQty: remaining,
        amount: round2(remaining * (line.unitPrice || 0)),
      });
    }
  }

  return {
    shipmentId,
    soId: so.soId,
    shippedLines,
    remainingLines,
    shipDate: new Date().toISOString(),
  };
}

export function getSOFulfillmentStatus(so, shipments) {
  const shippedByLine = {};
  for (const shipment of (shipments || [])) {
    for (const sl of (shipment.shippedLines || [])) {
      shippedByLine[sl.lineId] = (shippedByLine[sl.lineId] || 0) + sl.shippedQty;
    }
  }

  let totalOrdered = 0;
  let totalShipped = 0;

  const lines = (so.lines || []).map(line => {
    const shipped = Math.min(shippedByLine[line.lineId] || 0, line.qty);
    const percent = line.qty > 0 ? round2((shipped / line.qty) * 100) : 100;
    totalOrdered += line.qty;
    totalShipped += shipped;

    return {
      lineId: line.lineId,
      sku: line.sku,
      orderedQty: line.qty,
      shippedQty: shipped,
      remainingQty: line.qty - shipped,
      fulfillmentPercent: percent,
      status: percent >= 100 ? '已完成' : percent > 0 ? '部分出貨' : '未出貨',
    };
  });

  const overallPercent = totalOrdered > 0
    ? round2((totalShipped / totalOrdered) * 100)
    : 100;

  return {
    soId: so.soId,
    overallPercent,
    status: overallPercent >= 100 ? '已完成' : overallPercent > 0 ? '部分出貨' : '未出貨',
    lines,
    totalOrdered,
    totalShipped,
  };
}

export function canCloseSO(so, shipments, tolerance = 0.02) {
  const status = getSOFulfillmentStatus(so, shipments);
  const minPercent = round2((1 - tolerance) * 100);

  const unmetLines = status.lines.filter(l => l.fulfillmentPercent < minPercent);

  if (unmetLines.length === 0) {
    return {
      canClose: true,
      reason: '所有行項目已出貨完成',
      fulfillmentPercent: status.overallPercent,
    };
  }

  return {
    canClose: false,
    reason: `尚有 ${unmetLines.length} 行未達出貨門檻（${minPercent}%）`,
    fulfillmentPercent: status.overallPercent,
    unmetLines: unmetLines.map(l => ({
      lineId: l.lineId,
      sku: l.sku,
      fulfillmentPercent: l.fulfillmentPercent,
    })),
  };
}
