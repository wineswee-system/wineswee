function round2(x) {
  return Math.round(x * 100) / 100;
}

export const CREDIT_LIMIT_DEFAULTS = {
  A: { limit: 5000000, label: '大型優質客戶' },
  B: { limit: 2000000, label: '中型穩定客戶' },
  C: { limit: 500000,  label: '小型一般客戶' },
  D: { limit: 100000,  label: '新客戶／高風險' },
};

export function checkCreditLimit(customer, orderAmount, openARBalance) {
  const tier = customer.tier || 'D';
  const creditLimit = customer.creditLimit != null
    ? customer.creditLimit
    : (CREDIT_LIMIT_DEFAULTS[tier]?.limit || CREDIT_LIMIT_DEFAULTS.D.limit);

  const usedCredit = round2(openARBalance + orderAmount);
  const availableCredit = round2(creditLimit - openARBalance);
  const overAmount = usedCredit > creditLimit ? round2(usedCredit - creditLimit) : 0;
  const allowed = overAmount === 0;

  const overRatio = creditLimit > 0 ? overAmount / creditLimit : 1;
  let requiresApproval = null;
  if (!allowed && overRatio <= 0.2) {
    requiresApproval = '主管核准';
  } else if (!allowed) {
    requiresApproval = '高階主管核准';
  }

  return {
    allowed,
    availableCredit,
    overAmount,
    requiresApproval,
    creditLimit,
    tier,
  };
}

export function calculateATP(sku, onHand, reserved, incomingPO = [], incomingMO = []) {
  const netOnHand = (onHand || 0) - (reserved || 0);
  const totalIncomingPO = incomingPO.reduce((sum, po) => sum + (po.qty || 0), 0);
  const totalIncomingMO = incomingMO.reduce((sum, mo) => sum + (mo.qty || 0), 0);
  const atpQty = netOnHand + totalIncomingPO + totalIncomingMO;

  let earliestDate = null;
  if (netOnHand > 0) {
    earliestDate = new Date().toISOString().slice(0, 10);
  } else {
    const allIncoming = [...incomingPO, ...incomingMO]
      .filter(i => i.qty > 0 && i.expectedDate)
      .sort((a, b) => new Date(a.expectedDate) - new Date(b.expectedDate));
    if (allIncoming.length > 0) {
      earliestDate = allIncoming[0].expectedDate;
    }
  }

  return {
    sku,
    atpQty,
    earliestDate,
    breakdown: {
      onHand: onHand || 0,
      reserved: reserved || 0,
      netOnHand,
      incomingPO: totalIncomingPO,
      incomingMO: totalIncomingMO,
    },
  };
}

export function checkOrderFulfillment(orderLines, inventoryMap) {
  const lines = (orderLines || []).map(line => {
    const inv = inventoryMap[line.sku] || { onHand: 0, reserved: 0, incomingPO: [], incomingMO: [] };
    const atp = calculateATP(line.sku, inv.onHand, inv.reserved, inv.incomingPO || [], inv.incomingMO || []);
    const canFulfill = Math.min(line.qty, Math.max(0, atp.atpQty));
    const backorderQty = Math.max(0, line.qty - canFulfill);

    return {
      ...line,
      requestedQty: line.qty,
      fulfillableQty: canFulfill,
      backorderQty,
      atpQty: atp.atpQty,
      earliestDate: atp.earliestDate,
      status: backorderQty === 0 ? '可出貨' : canFulfill > 0 ? '部分可出' : '缺貨',
    };
  });

  const allFulfillable = lines.every(l => l.backorderQty === 0);

  return {
    fulfillable: allFulfillable,
    backorder: !allFulfillable,
    lines,
  };
}

export function createBackorder(soLine, availableQty) {
  const available = Math.max(0, Math.min(availableQty, soLine.qty));
  const backorderQty = Math.max(0, soLine.qty - available);

  const fulfilled = {
    ...soLine,
    qty: available,
    amount: round2(available * (soLine.unitPrice || 0)),
    status: '可出貨',
  };

  const backorder = backorderQty > 0 ? {
    backorderId: `BO-${soLine.soId}-${soLine.lineId}-${Date.now()}`,
    soId: soLine.soId,
    lineId: soLine.lineId,
    sku: soLine.sku,
    qty: backorderQty,
    unitPrice: soLine.unitPrice || 0,
    amount: round2(backorderQty * (soLine.unitPrice || 0)),
    status: '待補貨',
    priority: soLine.priority || 'normal',
    createdAt: new Date().toISOString(),
  } : null;

  return { fulfilled, backorder };
}

export function processBackorderFulfillment(backorders, newStock) {
  const stock = { ...newStock };
  const fulfilled = [];
  const remaining = [];

  const sorted = [...(backorders || [])]
    .filter(bo => bo.status === '待補貨')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const bo of sorted) {
    const available = stock[bo.sku] || 0;
    if (available >= bo.qty) {
      stock[bo.sku] = available - bo.qty;
      fulfilled.push({
        ...bo,
        fulfilledQty: bo.qty,
        status: '已補貨',
        fulfilledAt: new Date().toISOString(),
      });
    } else if (available > 0) {
      stock[bo.sku] = 0;
      fulfilled.push({
        ...bo,
        fulfilledQty: available,
        status: '部分補貨',
        fulfilledAt: new Date().toISOString(),
      });
      remaining.push({
        ...bo,
        qty: bo.qty - available,
        amount: round2((bo.qty - available) * (bo.unitPrice || 0)),
      });
    } else {
      remaining.push({ ...bo });
    }
  }

  const nonPending = (backorders || []).filter(bo => bo.status !== '待補貨');

  return {
    fulfilled,
    remaining: [...remaining, ...nonPending],
    stockUsed: Object.fromEntries(
      Object.entries(newStock).map(([sku, qty]) => [sku, qty - (stock[sku] || 0)])
    ),
  };
}

export function getBackorderSummary(backorders) {
  const pending = (backorders || []).filter(bo => bo.status === '待補貨');
  const now = new Date();

  const aging = { within7: [], within30: [], over30: [] };
  for (const bo of pending) {
    const days = Math.floor((now - new Date(bo.createdAt)) / (1000 * 60 * 60 * 24));
    const entry = { ...bo, ageDays: days };
    if (days <= 7) aging.within7.push(entry);
    else if (days <= 30) aging.within30.push(entry);
    else aging.over30.push(entry);
  }

  const bySku = {};
  for (const bo of pending) {
    if (!bySku[bo.sku]) bySku[bo.sku] = { sku: bo.sku, totalQty: 0, totalAmount: 0, count: 0 };
    bySku[bo.sku].totalQty += bo.qty;
    bySku[bo.sku].totalAmount = round2(bySku[bo.sku].totalAmount + (bo.amount || 0));
    bySku[bo.sku].count += 1;
  }

  const byPriority = {};
  for (const bo of pending) {
    const p = bo.priority || 'normal';
    if (!byPriority[p]) byPriority[p] = { count: 0, totalQty: 0, totalAmount: 0 };
    byPriority[p].count += 1;
    byPriority[p].totalQty += bo.qty;
    byPriority[p].totalAmount = round2(byPriority[p].totalAmount + (bo.amount || 0));
  }

  return {
    totalCount: pending.length,
    totalAmount: round2(pending.reduce((s, bo) => s + (bo.amount || 0), 0)),
    bySku,
    aging: {
      within7: aging.within7.length,
      within30: aging.within30.length,
      over30: aging.over30.length,
      details: aging,
    },
    byPriority,
  };
}
