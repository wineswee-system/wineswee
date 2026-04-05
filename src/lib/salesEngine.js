/**
 * 銷售引擎 — Sales Engine
 *
 * 台灣中小企業 ERP 銷售模組核心邏輯
 * 涵蓋：信用額度、可承諾量(ATP)、缺貨管理、定價引擎、
 *       部分出貨、退貨入庫、報價到期、業務佣金
 *
 * 純函式（不依賴外部狀態），所有金額使用 Math.round(x * 100) / 100
 */

// ══════════════════════════════════════
//  工具函式
// ══════════════════════════════════════

/** 金額四捨五入至小數第二位 */
function round2(x) {
  return Math.round(x * 100) / 100;
}

// ══════════════════════════════════════
//  1. 信用額度檢查 Credit Limit Check
// ══════════════════════════════════════

/**
 * 客戶分級預設信用額度（新台幣）
 * A 級：大型優質客戶、B 級：中型穩定客戶、C 級：小型一般客戶、D 級：新客戶/高風險
 */
export const CREDIT_LIMIT_DEFAULTS = {
  A: { limit: 5000000, label: '大型優質客戶' },
  B: { limit: 2000000, label: '中型穩定客戶' },
  C: { limit: 500000,  label: '小型一般客戶' },
  D: { limit: 100000,  label: '新客戶／高風險' },
};

/**
 * 檢查客戶信用額度是否允許接單
 *
 * @param {Object} customer - 客戶資料 { id, name, tier, creditLimit? }
 * @param {number} orderAmount - 本次訂單金額
 * @param {number} openARBalance - 客戶目前未收帳款餘額
 * @returns {Object} { allowed, availableCredit, overAmount, requiresApproval }
 */
export function checkCreditLimit(customer, orderAmount, openARBalance) {
  const tier = customer.tier || 'D';
  const creditLimit = customer.creditLimit != null
    ? customer.creditLimit
    : (CREDIT_LIMIT_DEFAULTS[tier]?.limit || CREDIT_LIMIT_DEFAULTS.D.limit);

  const usedCredit = round2(openARBalance + orderAmount);
  const availableCredit = round2(creditLimit - openARBalance);
  const overAmount = usedCredit > creditLimit ? round2(usedCredit - creditLimit) : 0;
  const allowed = overAmount === 0;

  // 超額 20% 以內可送主管核准，超過 20% 需高階主管核准
  const overRatio = creditLimit > 0 ? overAmount / creditLimit : 1;
  let requiresApproval = null;
  if (!allowed && overRatio <= 0.2) {
    requiresApproval = '主管核准'; // 超額 ≤ 20%
  } else if (!allowed) {
    requiresApproval = '高階主管核准'; // 超額 > 20%
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

// ══════════════════════════════════════
//  2. 可承諾量 Available-to-Promise (ATP)
// ══════════════════════════════════════

/**
 * 計算單一料號的可承諾量 (ATP)
 *
 * ATP = 現有庫存 - 已保留量 + 在途採購量 + 在途生產量
 *
 * @param {string} sku - 料號
 * @param {number} onHand - 現有庫存數量
 * @param {number} reserved - 已保留（已排訂單但未出貨）數量
 * @param {Array} incomingPO - 在途採購 [{ qty, expectedDate }]
 * @param {Array} incomingMO - 在途製令 [{ qty, expectedDate }]
 * @returns {Object} { sku, atpQty, earliestDate, breakdown }
 */
export function calculateATP(sku, onHand, reserved, incomingPO = [], incomingMO = []) {
  const netOnHand = (onHand || 0) - (reserved || 0);
  const totalIncomingPO = incomingPO.reduce((sum, po) => sum + (po.qty || 0), 0);
  const totalIncomingMO = incomingMO.reduce((sum, mo) => sum + (mo.qty || 0), 0);
  const atpQty = netOnHand + totalIncomingPO + totalIncomingMO;

  // 最早可用日期：若現有淨庫存 > 0 則今天，否則取最早的在途到貨日
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

/**
 * 檢查訂單各行項目的可承諾履行狀況
 *
 * @param {Array} orderLines - 訂單行項目 [{ sku, qty, ... }]
 * @param {Object} inventoryMap - 庫存對照表 { [sku]: { onHand, reserved, incomingPO, incomingMO } }
 * @returns {Object} { fulfillable, backorder, lines }
 */
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

// ══════════════════════════════════════
//  3. 缺貨管理 Backorder Management
// ══════════════════════════════════════

/**
 * 建立缺貨單（將訂單行拆分為已可出貨 + 缺貨）
 *
 * @param {Object} soLine - 銷售訂單行 { soId, lineId, sku, qty, unitPrice, ... }
 * @param {number} availableQty - 目前可出貨數量
 * @returns {Object} { fulfilled, backorder }
 */
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

/**
 * 先進先出補貨處理：以建立時間排序依序補貨
 *
 * @param {Array} backorders - 缺貨單陣列 [{ backorderId, sku, qty, status, createdAt, ... }]
 * @param {Object} newStock - 新到庫存 { [sku]: qty }
 * @returns {Object} { fulfilled, remaining, stockUsed }
 */
export function processBackorderFulfillment(backorders, newStock) {
  // 複製庫存，避免改到原物件
  const stock = { ...newStock };
  const fulfilled = [];
  const remaining = [];

  // 依建立時間排序（FIFO）
  const sorted = [...(backorders || [])]
    .filter(bo => bo.status === '待補貨')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const bo of sorted) {
    const available = stock[bo.sku] || 0;
    if (available >= bo.qty) {
      // 完全補貨
      stock[bo.sku] = available - bo.qty;
      fulfilled.push({
        ...bo,
        fulfilledQty: bo.qty,
        status: '已補貨',
        fulfilledAt: new Date().toISOString(),
      });
    } else if (available > 0) {
      // 部分補貨：拆分
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
      // 無庫存
      remaining.push({ ...bo });
    }
  }

  // 非待補貨的原樣保留
  const nonPending = (backorders || []).filter(bo => bo.status !== '待補貨');

  return {
    fulfilled,
    remaining: [...remaining, ...nonPending],
    stockUsed: Object.fromEntries(
      Object.entries(newStock).map(([sku, qty]) => [sku, qty - (stock[sku] || 0)])
    ),
  };
}

/**
 * 取得缺貨摘要報表（含帳齡與優先順序）
 *
 * @param {Array} backorders - 缺貨單陣列
 * @returns {Object} { totalCount, totalAmount, bySku, aging, byPriority }
 */
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

  // 依料號彙總
  const bySku = {};
  for (const bo of pending) {
    if (!bySku[bo.sku]) bySku[bo.sku] = { sku: bo.sku, totalQty: 0, totalAmount: 0, count: 0 };
    bySku[bo.sku].totalQty += bo.qty;
    bySku[bo.sku].totalAmount = round2(bySku[bo.sku].totalAmount + (bo.amount || 0));
    bySku[bo.sku].count += 1;
  }

  // 依優先順序彙總
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

// ══════════════════════════════════════
//  4. 定價引擎 Pricing Engine
// ══════════════════════════════════════

/**
 * 定價規則結構範例
 *
 * 支援：基本售價、數量折扣階梯、客戶專屬價、期間促銷
 */
export const PRICING_RULES = {
  // 基本售價
  basePrice: {
    // sku -> 單價
    // 'SKU-001': 1200,
  },

  // 數量折扣階梯（各 SKU 可有不同階梯）
  volumeDiscountTiers: {
    // 'SKU-001': [
    //   { minQty: 1,   discount: 0 },
    //   { minQty: 10,  discount: 0.05 },  // 5%
    //   { minQty: 50,  discount: 0.10 },  // 10%
    //   { minQty: 100, discount: 0.15 },  // 15%
    // ],
  },

  // 客戶專屬價
  customerSpecificPrice: {
    // 'CUST-001': { 'SKU-001': 1100 },
  },

  // 期間促銷
  promotions: [
    // {
    //   id: 'PROMO-001',
    //   name: '年終特惠',
    //   sku: 'SKU-001',        // null = 全品項
    //   startDate: '2026-01-01',
    //   endDate: '2026-01-31',
    //   type: 'percentage',    // 'percentage' | 'fixed' | 'price_override'
    //   value: 0.1,            // 10% off | 固定折扣金額 | 覆蓋價
    // },
  ],
};

/**
 * 計算單行售價（套用最優惠價格規則）
 *
 * 優先順序：客戶專屬價 > 促銷價 > 數量折扣 > 基本售價
 * 取其中最低價格回傳
 *
 * @param {string} sku - 料號
 * @param {number} qty - 數量
 * @param {Object} customer - 客戶 { id, tier }
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @param {Object} pricingRules - 定價規則
 * @returns {Object} { unitPrice, appliedRule, originalPrice, discount }
 */
export function calculateLinePrice(sku, qty, customer, date, pricingRules) {
  const rules = pricingRules || PRICING_RULES;
  const basePrice = (rules.basePrice && rules.basePrice[sku]) || 0;
  const candidates = [];

  // 1. 基本售價
  candidates.push({ unitPrice: basePrice, rule: '基本售價' });

  // 2. 數量折扣
  const tiers = rules.volumeDiscountTiers && rules.volumeDiscountTiers[sku];
  if (tiers && tiers.length > 0) {
    // 取符合最大數量門檻的折扣
    const sorted = [...tiers].sort((a, b) => b.minQty - a.minQty);
    const tier = sorted.find(t => qty >= t.minQty);
    if (tier && tier.discount > 0) {
      candidates.push({
        unitPrice: round2(basePrice * (1 - tier.discount)),
        rule: `數量折扣 ${(tier.discount * 100)}%（≥${tier.minQty}）`,
      });
    }
  }

  // 3. 客戶專屬價
  if (customer && customer.id && rules.customerSpecificPrice) {
    const custPrices = rules.customerSpecificPrice[customer.id];
    if (custPrices && custPrices[sku] != null) {
      candidates.push({ unitPrice: custPrices[sku], rule: '客戶專屬價' });
    }
  }

  // 4. 期間促銷
  if (date && rules.promotions) {
    for (const promo of rules.promotions) {
      if (promo.sku && promo.sku !== sku) continue;
      if (promo.startDate && date < promo.startDate) continue;
      if (promo.endDate && date > promo.endDate) continue;

      let promoPrice = basePrice;
      if (promo.type === 'percentage') {
        promoPrice = round2(basePrice * (1 - (promo.value || 0)));
      } else if (promo.type === 'fixed') {
        promoPrice = round2(basePrice - (promo.value || 0));
      } else if (promo.type === 'price_override') {
        promoPrice = promo.value || 0;
      }
      candidates.push({ unitPrice: promoPrice, rule: `促銷：${promo.name || promo.id}` });
    }
  }

  // 取最低價
  const best = candidates.reduce((min, c) => c.unitPrice < min.unitPrice ? c : min, candidates[0]);

  return {
    sku,
    qty,
    unitPrice: round2(best.unitPrice),
    lineTotal: round2(best.unitPrice * qty),
    appliedRule: best.rule,
    originalPrice: basePrice,
    discount: round2(basePrice - best.unitPrice),
  };
}

/**
 * 計算訂單合計（含行折扣 + 訂單級折扣 + 稅額）
 *
 * @param {Array} lines - 行項目 [{ sku, qty, unitPrice, lineTotal }]
 * @param {number} taxRate - 稅率（例如 0.05 表示 5% 營業稅）
 * @param {Object} [discountRules] - 訂單級折扣 { type: 'percentage'|'fixed', value }
 * @returns {Object} { subtotal, orderDiscount, taxableAmount, tax, total, lines }
 */
export function calculateOrderTotal(lines, taxRate = 0.05, discountRules = null) {
  const subtotal = round2((lines || []).reduce((s, l) => s + (l.lineTotal || 0), 0));

  let orderDiscount = 0;
  if (discountRules) {
    if (discountRules.type === 'percentage') {
      orderDiscount = round2(subtotal * (discountRules.value || 0));
    } else if (discountRules.type === 'fixed') {
      orderDiscount = round2(Math.min(discountRules.value || 0, subtotal));
    }
  }

  const taxableAmount = round2(subtotal - orderDiscount);
  const tax = round2(taxableAmount * taxRate);
  const total = round2(taxableAmount + tax);

  return {
    subtotal,
    orderDiscount,
    taxableAmount,
    tax,
    taxRate,
    total,
    lines: lines || [],
  };
}

/**
 * 驗證並套用促銷代碼
 *
 * @param {Object} order - 訂單 { lines, subtotal, ... }
 * @param {string} code - 促銷代碼
 * @param {Array} promotions - 促銷清單 [{ code, name, type, value, minOrderAmount?, startDate?, endDate?, maxUses?, currentUses? }]
 * @returns {Object} { valid, message, discount, updatedOrder }
 */
export function applyPromotionCode(order, code, promotions) {
  if (!code || !promotions) {
    return { valid: false, message: '無效的促銷代碼', discount: 0, updatedOrder: order };
  }

  const promo = promotions.find(p => p.code === code);
  if (!promo) {
    return { valid: false, message: '促銷代碼不存在', discount: 0, updatedOrder: order };
  }

  const now = new Date().toISOString().slice(0, 10);
  if (promo.startDate && now < promo.startDate) {
    return { valid: false, message: '促銷活動尚未開始', discount: 0, updatedOrder: order };
  }
  if (promo.endDate && now > promo.endDate) {
    return { valid: false, message: '促銷活動已結束', discount: 0, updatedOrder: order };
  }
  if (promo.maxUses != null && (promo.currentUses || 0) >= promo.maxUses) {
    return { valid: false, message: '促銷代碼已達使用上限', discount: 0, updatedOrder: order };
  }

  const subtotal = order.subtotal || 0;
  if (promo.minOrderAmount && subtotal < promo.minOrderAmount) {
    return {
      valid: false,
      message: `訂單金額未達最低門檻 ${promo.minOrderAmount}`,
      discount: 0,
      updatedOrder: order,
    };
  }

  let discount = 0;
  if (promo.type === 'percentage') {
    discount = round2(subtotal * (promo.value || 0));
  } else if (promo.type === 'fixed') {
    discount = round2(Math.min(promo.value || 0, subtotal));
  }

  return {
    valid: true,
    message: `已套用促銷：${promo.name || promo.code}`,
    discount,
    promoCode: code,
    updatedOrder: {
      ...order,
      promoCode: code,
      promoDiscount: discount,
      total: round2((order.total || subtotal) - discount),
    },
  };
}

// ══════════════════════════════════════
//  5. 部分出貨 Partial Shipment
// ══════════════════════════════════════

/**
 * 建立部分出貨紀錄，追蹤已出貨 vs 剩餘數量
 *
 * @param {Object} so - 銷售訂單 { soId, lines: [{ lineId, sku, qty, unitPrice }] }
 * @param {Array} shippedItems - 本次出貨項目 [{ lineId, sku, shippedQty }]
 * @returns {Object} { shipmentId, soId, shippedLines, remainingLines, shipDate }
 */
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

/**
 * 取得銷售訂單履行狀態（各行及整體百分比）
 *
 * @param {Object} so - 銷售訂單 { soId, lines: [{ lineId, sku, qty }] }
 * @param {Array} shipments - 出貨紀錄陣列 [{ shippedLines: [{ lineId, shippedQty }] }]
 * @returns {Object} { soId, overallPercent, lines, totalOrdered, totalShipped }
 */
export function getSOFulfillmentStatus(so, shipments) {
  // 彙總各行已出貨數量
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

/**
 * 判斷銷售訂單是否可結案（所有行已出貨至容許範圍內）
 *
 * @param {Object} so - 銷售訂單
 * @param {Array} shipments - 出貨紀錄陣列
 * @param {number} [tolerance=0.02] - 容許短少比率（預設 2%）
 * @returns {Object} { canClose, reason, fulfillmentPercent }
 */
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

// ══════════════════════════════════════
//  6. 退貨入庫 Returns to Inventory
// ══════════════════════════════════════

/**
 * 處理退貨申請，驗證退貨項目是否在原銷售訂單內
 *
 * @param {Object} returnRequest - 退貨申請 { returnId, soId, lines: [{ lineId, sku, qty, reason }] }
 * @param {Object} originalSO - 原銷售訂單 { soId, lines: [{ lineId, sku, qty, unitPrice }] }
 * @returns {Object} { valid, returnId, validatedLines, rejectedLines, totalRefund }
 */
export function processReturn(returnRequest, originalSO) {
  const soLineMap = {};
  for (const line of (originalSO.lines || [])) {
    soLineMap[line.lineId] = line;
  }

  const validatedLines = [];
  const rejectedLines = [];
  let totalRefund = 0;

  for (const rl of (returnRequest.lines || [])) {
    const soLine = soLineMap[rl.lineId];
    if (!soLine) {
      rejectedLines.push({ ...rl, rejectReason: '行項目不存在於原訂單' });
      continue;
    }
    if (rl.sku !== soLine.sku) {
      rejectedLines.push({ ...rl, rejectReason: '料號不符' });
      continue;
    }
    if (rl.qty > soLine.qty) {
      rejectedLines.push({ ...rl, rejectReason: `退貨數量 ${rl.qty} 超過原訂單數量 ${soLine.qty}` });
      continue;
    }

    const refundAmount = round2(rl.qty * (soLine.unitPrice || 0));
    totalRefund = round2(totalRefund + refundAmount);

    validatedLines.push({
      lineId: rl.lineId,
      sku: rl.sku,
      qty: rl.qty,
      unitPrice: soLine.unitPrice || 0,
      refundAmount,
      reason: rl.reason || '未指定',
    });
  }

  return {
    valid: rejectedLines.length === 0,
    returnId: returnRequest.returnId || `RET-${Date.now()}`,
    soId: originalSO.soId,
    validatedLines,
    rejectedLines,
    totalRefund,
  };
}

/**
 * 根據退貨建立折讓單（Credit Note）
 *
 * @param {Object} returnRequest - 已驗證的退貨申請 { returnId, validatedLines }
 * @param {Object} originalInvoice - 原始發票 { invoiceId, taxRate }
 * @returns {Object} { creditNoteId, invoiceId, lines, subtotal, tax, total }
 */
export function createCreditNoteFromReturn(returnRequest, originalInvoice) {
  const taxRate = originalInvoice.taxRate || 0.05;
  const lines = (returnRequest.validatedLines || []).map(vl => ({
    lineId: vl.lineId,
    sku: vl.sku,
    qty: vl.qty,
    unitPrice: vl.unitPrice,
    amount: vl.refundAmount || round2(vl.qty * vl.unitPrice),
    reason: vl.reason,
  }));

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2(subtotal * taxRate);
  const total = round2(subtotal + tax);

  return {
    creditNoteId: `CN-${returnRequest.returnId || Date.now()}`,
    returnId: returnRequest.returnId,
    invoiceId: originalInvoice.invoiceId,
    lines,
    subtotal,
    tax,
    taxRate,
    total,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 退貨品入庫（加回庫存並記錄調整原因）
 *
 * @param {Array} returnItems - 退貨項目 [{ sku, qty, reason, condition? }]
 * @returns {Object} { adjustments, restocked, scrapped }
 */
export function restockReturnedItems(returnItems) {
  const adjustments = [];
  let restocked = 0;
  let scrapped = 0;

  for (const item of (returnItems || [])) {
    const condition = item.condition || '良品'; // 良品, 不良品, 報廢

    if (condition === '報廢') {
      adjustments.push({
        sku: item.sku,
        qty: item.qty,
        type: '報廢',
        reason: item.reason || '退貨報廢',
        adjustedAt: new Date().toISOString(),
      });
      scrapped += item.qty;
    } else if (condition === '不良品') {
      adjustments.push({
        sku: item.sku,
        qty: item.qty,
        type: '不良品入庫',
        reason: item.reason || '退貨不良品',
        location: '不良品區',
        adjustedAt: new Date().toISOString(),
      });
      restocked += item.qty; // 入庫但放不良品區
    } else {
      adjustments.push({
        sku: item.sku,
        qty: item.qty,
        type: '良品入庫',
        reason: item.reason || '退貨入庫',
        location: '良品倉',
        adjustedAt: new Date().toISOString(),
      });
      restocked += item.qty;
    }
  }

  return { adjustments, restocked, scrapped };
}

// ══════════════════════════════════════
//  7. 報價到期 Quote Expiry
// ══════════════════════════════════════

/** 報價單預設有效天數 */
export const QUOTE_VALIDITY_DAYS = 30;

/**
 * 檢查報價單是否到期
 *
 * @param {Object} quote - 報價單 { quoteId, createdAt, validityDays?, expiryDate? }
 * @param {string} currentDate - 當前日期 (YYYY-MM-DD)
 * @returns {Object} { status, quoteId, expiryDate, daysRemaining }
 *   status: '已過期' | '即將到期' | '有效'
 */
export function checkQuoteExpiry(quote, currentDate) {
  const validity = quote.validityDays || QUOTE_VALIDITY_DAYS;
  const created = new Date(quote.createdAt);
  const expiry = quote.expiryDate
    ? new Date(quote.expiryDate)
    : new Date(created.getTime() + validity * 24 * 60 * 60 * 1000);
  const expiryStr = expiry.toISOString().slice(0, 10);

  const current = new Date(currentDate);
  const diffMs = expiry.getTime() - current.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  let status;
  if (daysRemaining < 0) {
    status = '已過期';
  } else if (daysRemaining <= 7) {
    status = '即將到期'; // 7 天內到期
  } else {
    status = '有效';
  }

  return {
    status,
    quoteId: quote.quoteId,
    expiryDate: expiryStr,
    daysRemaining: Math.max(daysRemaining, 0),
  };
}

/**
 * 取得即將到期的報價單清單
 *
 * @param {Array} quotes - 報價單陣列
 * @param {string} currentDate - 當前日期 (YYYY-MM-DD)
 * @param {number} [daysAhead=7] - 未來幾天內到期
 * @returns {Array} 即將到期或已過期的報價單（含到期狀態）
 */
export function getExpiringQuotes(quotes, currentDate, daysAhead = 7) {
  return (quotes || [])
    .map(q => checkQuoteExpiry(q, currentDate))
    .filter(r => r.status === '已過期' || (r.status === '即將到期' && r.daysRemaining <= daysAhead))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

// ══════════════════════════════════════
//  8. 業務佣金 Sales Commission
// ══════════════════════════════════════

/**
 * 佣金規則：依毛利率階梯 × 業務層級
 *
 * 業務層級：junior（初階）、senior（資深）、manager（主管）
 * 毛利率階梯：越高毛利率，佣金比率越高
 */
export const COMMISSION_RULES = {
  tiers: [
    { minMarginPct: 0,   commissionPct: 0.02 }, // 毛利 < 10%：佣金 2%
    { minMarginPct: 0.10, commissionPct: 0.04 }, // 毛利 10-20%：佣金 4%
    { minMarginPct: 0.20, commissionPct: 0.06 }, // 毛利 20-30%：佣金 6%
    { minMarginPct: 0.30, commissionPct: 0.08 }, // 毛利 ≥ 30%：佣金 8%
  ],
  levelMultiplier: {
    junior:  1.0,  // 初階：基本佣金
    senior:  1.15, // 資深：115%
    manager: 1.25, // 主管：125%
  },
};

/**
 * 計算業務佣金
 *
 * @param {number} salesAmount - 銷售金額
 * @param {number} costAmount - 成本金額
 * @param {string} repLevel - 業務層級 ('junior'|'senior'|'manager')
 * @param {Object} [rules] - 佣金規則（預設使用 COMMISSION_RULES）
 * @returns {Object} { commission, marginPct, commissionPct, level, multiplier }
 */
export function calculateCommission(salesAmount, costAmount, repLevel, rules) {
  const r = rules || COMMISSION_RULES;
  const margin = salesAmount - costAmount;
  const marginPct = salesAmount > 0 ? margin / salesAmount : 0;

  // 取毛利率對應的佣金比率（由高到低找第一個符合的階梯）
  const sortedTiers = [...(r.tiers || [])].sort((a, b) => b.minMarginPct - a.minMarginPct);
  const tier = sortedTiers.find(t => marginPct >= t.minMarginPct) || { commissionPct: 0 };

  const multiplier = (r.levelMultiplier && r.levelMultiplier[repLevel]) || 1.0;
  const effectivePct = tier.commissionPct * multiplier;
  const commission = round2(salesAmount * effectivePct);

  return {
    commission,
    marginPct: round2(marginPct * 100) / 100, // 保留小數
    commissionPct: round2(effectivePct * 100) / 100,
    basePct: tier.commissionPct,
    level: repLevel || 'junior',
    multiplier,
    salesAmount,
    costAmount,
    margin: round2(margin),
  };
}

/**
 * 產生佣金報表（依業務人員彙總）
 *
 * @param {Array} reps - 業務人員 [{ repId, name, level }]
 * @param {Array} sales - 銷售紀錄 [{ repId, salesAmount, costAmount, date }]
 * @param {Object} period - 期間 { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 * @returns {Object} { period, summary, details }
 */
export function generateCommissionReport(reps, sales, period) {
  const filteredSales = (sales || []).filter(s => {
    if (period && period.start && s.date < period.start) return false;
    if (period && period.end && s.date > period.end) return false;
    return true;
  });

  const repMap = {};
  for (const rep of (reps || [])) {
    repMap[rep.repId] = rep;
  }

  // 依業務人員彙總
  const byRep = {};
  for (const sale of filteredSales) {
    if (!byRep[sale.repId]) {
      const rep = repMap[sale.repId] || { repId: sale.repId, name: '未知', level: 'junior' };
      byRep[sale.repId] = {
        repId: sale.repId,
        name: rep.name,
        level: rep.level,
        totalSales: 0,
        totalCost: 0,
        totalCommission: 0,
        dealCount: 0,
        details: [],
      };
    }
    const entry = byRep[sale.repId];
    const comm = calculateCommission(
      sale.salesAmount, sale.costAmount, entry.level
    );

    entry.totalSales = round2(entry.totalSales + sale.salesAmount);
    entry.totalCost = round2(entry.totalCost + sale.costAmount);
    entry.totalCommission = round2(entry.totalCommission + comm.commission);
    entry.dealCount += 1;
    entry.details.push({
      date: sale.date,
      salesAmount: sale.salesAmount,
      costAmount: sale.costAmount,
      commission: comm.commission,
      marginPct: comm.marginPct,
    });
  }

  const summary = Object.values(byRep).sort((a, b) => b.totalCommission - a.totalCommission);
  const grandTotalCommission = round2(summary.reduce((s, r) => s + r.totalCommission, 0));
  const grandTotalSales = round2(summary.reduce((s, r) => s + r.totalSales, 0));

  return {
    period: period || { start: null, end: null },
    grandTotalSales,
    grandTotalCommission,
    repCount: summary.length,
    summary,
  };
}
