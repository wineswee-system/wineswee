/**
 * POS 引擎 — 銷售點系統核心業務邏輯
 * 購物車管理、折扣計算、分帳付款、收銀機管理、Z 報表、含稅切換
 */

// ─── 購物車管理 ────────────────────────────────────────────────

/**
 * 建立新購物車
 * @param {string} terminalId — 終端機 ID
 * @param {string} operatorId — 收銀員 ID
 * @returns {{id: string, terminalId: string, operatorId: string, items: Array, subtotal: number, taxAmount: number, discounts: Array, total: number, payments: Array, status: string, createdAt: string}}
 */
export function createCart(terminalId, operatorId) {
  return {
    id: `CART-${Date.now()}`,
    terminalId,
    operatorId,
    items: [],
    subtotal: 0,
    taxAmount: 0,
    discounts: [],
    total: 0,
    payments: [],
    status: 'open', // open → paid → voided
    createdAt: new Date().toISOString(),
  }
}

/**
 * 新增商品到購物車
 * @param {object} cart — 購物車
 * @param {{sku: string, name: string, price: number, qty: number, taxRate?: number, barcode?: string}} item — 商品
 * @returns {object} 更新後的購物車
 */
export function addItemToCart(cart, item) {
  if (!item.sku || !item.name) throw new Error('商品必須包含 SKU 和名稱')
  if (item.price < 0) throw new Error('商品價格不可為負數')
  if ((item.qty || 1) <= 0) throw new Error('數量必須大於零')

  const existing = cart.items.find(i => i.sku === item.sku)
  if (existing) {
    existing.qty += (item.qty || 1)
    existing.lineTotal = Math.round(existing.qty * existing.price * 100) / 100
  } else {
    const qty = item.qty || 1
    cart.items.push({
      sku: item.sku,
      name: item.name,
      price: item.price,
      qty,
      taxRate: item.taxRate ?? 0.05, // 台灣 5% 營業稅
      barcode: item.barcode || null,
      lineDiscount: 0,
      lineTotal: Math.round(qty * item.price * 100) / 100,
    })
  }

  return recalculateCart(cart)
}

/**
 * 從購物車移除商品
 * @param {object} cart — 購物車
 * @param {string} sku — 商品 SKU
 * @returns {object} 更新後的購物車
 */
export function removeItemFromCart(cart, sku) {
  cart.items = cart.items.filter(i => i.sku !== sku)
  return recalculateCart(cart)
}

/**
 * 修改購物車商品數量
 * @param {object} cart — 購物車
 * @param {string} sku — 商品 SKU
 * @param {number} qty — 新數量
 * @returns {object} 更新後的購物車
 */
export function updateItemQty(cart, sku, qty) {
  if (qty <= 0) return removeItemFromCart(cart, sku)

  const item = cart.items.find(i => i.sku === sku)
  if (!item) throw new Error(`購物車中找不到商品: ${sku}`)

  item.qty = qty
  item.lineTotal = Math.round(qty * item.price * 100) / 100
  return recalculateCart(cart)
}

/**
 * 重新計算購物車合計
 */
function recalculateCart(cart) {
  // 小計（稅前）
  cart.subtotal = Math.round(
    cart.items.reduce((sum, item) => sum + item.lineTotal - item.lineDiscount, 0) * 100
  ) / 100

  // 稅額
  cart.taxAmount = Math.round(
    cart.items.reduce((sum, item) => {
      const taxable = item.lineTotal - item.lineDiscount
      return sum + taxable * (item.taxRate || 0)
    }, 0) * 100
  ) / 100

  // 訂單折扣
  const totalDiscount = Math.round(
    cart.discounts.reduce((sum, d) => sum + (d.amount || 0), 0) * 100
  ) / 100

  // 總計
  cart.total = Math.round((cart.subtotal + cart.taxAmount - totalDiscount) * 100) / 100
  if (cart.total < 0) cart.total = 0

  return cart
}

// ─── 折扣引擎 ──────────────────────────────────────────────────

/**
 * 折扣類型
 */
export const DISCOUNT_TYPES = {
  PERCENTAGE: 'percentage',     // 百分比折扣
  FIXED_AMOUNT: 'fixed_amount', // 固定金額折扣
  BUY_X_GET_Y: 'buy_x_get_y',  // 買 X 送 Y
  MEMBER: 'member',             // 會員折扣
  COUPON: 'coupon',             // 優惠券
}

/**
 * 套用單品折扣
 * @param {object} cart — 購物車
 * @param {string} sku — 商品 SKU
 * @param {string} type — 折扣類型 (percentage | fixed_amount)
 * @param {number} value — 折扣值（百分比或金額）
 * @param {string} [reason] — 折扣原因
 * @returns {object} 更新後的購物車
 */
export function applyItemDiscount(cart, sku, type, value, reason) {
  const item = cart.items.find(i => i.sku === sku)
  if (!item) throw new Error(`購物車中找不到商品: ${sku}`)

  if (type === DISCOUNT_TYPES.PERCENTAGE) {
    if (value < 0 || value > 100) throw new Error('折扣百分比須介於 0-100')
    item.lineDiscount = Math.round(item.lineTotal * (value / 100) * 100) / 100
  } else if (type === DISCOUNT_TYPES.FIXED_AMOUNT) {
    if (value < 0) throw new Error('折扣金額不可為負數')
    item.lineDiscount = Math.min(Math.round(value * 100) / 100, item.lineTotal)
  }

  item.discountReason = reason || ''
  return recalculateCart(cart)
}

/**
 * 套用訂單層級折扣
 * @param {object} cart — 購物車
 * @param {string} type — 折扣類型
 * @param {number} value — 折扣值
 * @param {string} code — 優惠碼或原因
 * @returns {object} 更新後的購物車
 */
export function applyOrderDiscount(cart, type, value, code) {
  let amount = 0

  if (type === DISCOUNT_TYPES.PERCENTAGE) {
    if (value < 0 || value > 100) throw new Error('折扣百分比須介於 0-100')
    amount = Math.round(cart.subtotal * (value / 100) * 100) / 100
  } else if (type === DISCOUNT_TYPES.FIXED_AMOUNT) {
    amount = Math.round(Math.min(value, cart.subtotal) * 100) / 100
  } else if (type === DISCOUNT_TYPES.MEMBER) {
    // 會員折扣依等級
    const memberDiscountRates = { silver: 3, gold: 5, diamond: 10 }
    const rate = memberDiscountRates[value] || 0
    amount = Math.round(cart.subtotal * (rate / 100) * 100) / 100
  }

  cart.discounts.push({
    type,
    value,
    amount,
    code: code || '',
    appliedAt: new Date().toISOString(),
  })

  return recalculateCart(cart)
}

/**
 * 驗證並套用優惠券
 * @param {object} cart — 購物車
 * @param {string} couponCode — 優惠券代碼
 * @param {Array} validCoupons — 有效優惠券列表
 * @returns {{success: boolean, cart?: object, error?: string}}
 */
export function applyCoupon(cart, couponCode, validCoupons) {
  const coupon = validCoupons.find(c =>
    c.code === couponCode && c.active !== false
  )

  if (!coupon) return { success: false, error: '無效的優惠券代碼' }

  const now = new Date()
  if (coupon.expiresAt && new Date(coupon.expiresAt) < now) {
    return { success: false, error: '優惠券已過期' }
  }
  if (coupon.minAmount && cart.subtotal < coupon.minAmount) {
    return { success: false, error: `消費須滿 NT$${coupon.minAmount} 才可使用此優惠券` }
  }
  if (coupon.usedCount >= (coupon.maxUses || Infinity)) {
    return { success: false, error: '優惠券已達使用上限' }
  }

  const alreadyApplied = cart.discounts.some(d => d.code === couponCode)
  if (alreadyApplied) return { success: false, error: '此優惠券已套用' }

  const updatedCart = applyOrderDiscount(cart, coupon.type, coupon.value, couponCode)
  return { success: true, cart: updatedCart }
}

// ─── 分帳付款 ──────────────────────────────────────────────────

/**
 * 處理分帳付款（多種付款方式）
 * @param {object} cart — 購物車
 * @param {{method: string, amount: number, reference?: string}} payment — 付款資訊
 * @returns {{cart: object, remainingBalance: number, isFullyPaid: boolean, change: number}}
 */
export function addPayment(cart, payment) {
  if (!payment.method) throw new Error('必須指定付款方式')
  if (payment.amount <= 0) throw new Error('付款金額必須大於零')

  const totalPaid = cart.payments.reduce((s, p) => s + p.amount, 0)
  const remaining = Math.round((cart.total - totalPaid) * 100) / 100

  if (remaining <= 0) throw new Error('購物車已全額付款')

  const appliedAmount = Math.min(payment.amount, remaining)
  let change = 0

  // 現金可以找零
  if (payment.method === 'cash' && payment.amount > remaining) {
    change = Math.round((payment.amount - remaining) * 100) / 100
  }

  cart.payments.push({
    method: payment.method,
    amount: appliedAmount,
    tendered: payment.amount, // 實際給的金額（現金可能超過）
    change,
    reference: payment.reference || null,
    timestamp: new Date().toISOString(),
  })

  const newTotalPaid = cart.payments.reduce((s, p) => s + p.amount, 0)
  const newRemaining = Math.round((cart.total - newTotalPaid) * 100) / 100
  const isFullyPaid = newRemaining <= 0

  if (isFullyPaid) {
    cart.status = 'paid'
  }

  return {
    cart,
    remainingBalance: Math.max(newRemaining, 0),
    isFullyPaid,
    change,
  }
}

/**
 * 取消付款
 * @param {object} cart — 購物車
 * @param {number} paymentIndex — 付款索引
 * @returns {object} 更新後的購物車
 */
export function removePayment(cart, paymentIndex) {
  if (paymentIndex < 0 || paymentIndex >= cart.payments.length) {
    throw new Error('無效的付款索引')
  }
  cart.payments.splice(paymentIndex, 1)
  cart.status = 'open'
  return cart
}

// ─── 收銀機管理 ────────────────────────────────────────────────

/**
 * 開班（開啟收銀班次）
 * @param {string} terminalId — 終端機 ID
 * @param {string} operatorId — 收銀員 ID
 * @param {number} openingFloat — 開班備用金
 * @returns {object} 班次記錄
 */
export function openShift(terminalId, operatorId, openingFloat) {
  if (openingFloat < 0) throw new Error('開班備用金不可為負數')

  return {
    id: `SHIFT-${Date.now()}`,
    terminalId,
    operatorId,
    openingFloat: Math.round(openingFloat * 100) / 100,
    status: 'open',
    openedAt: new Date().toISOString(),
    closedAt: null,
    transactions: [],
    cashIn: [],  // 額外現金存入
    cashOut: [], // 額外現金取出
    expectedCash: Math.round(openingFloat * 100) / 100,
    actualCash: null,
    variance: null,
  }
}

/**
 * 記錄交易到班次
 * @param {object} shift — 班次
 * @param {object} cart — 已付款的購物車
 * @returns {object} 更新後的班次
 */
export function recordTransaction(shift, cart) {
  if (shift.status !== 'open') throw new Error('班次已結束，無法記錄交易')
  if (cart.status !== 'paid') throw new Error('購物車尚未付款完成')

  shift.transactions.push({
    cartId: cart.id,
    total: cart.total,
    payments: cart.payments.map(p => ({ method: p.method, amount: p.amount })),
    timestamp: new Date().toISOString(),
  })

  // 更新預期現金（只計算現金付款）
  const cashPayments = cart.payments
    .filter(p => p.method === 'cash')
    .reduce((s, p) => s + p.amount, 0)
  const cashChange = cart.payments
    .filter(p => p.method === 'cash')
    .reduce((s, p) => s + (p.change || 0), 0)

  shift.expectedCash = Math.round(
    (shift.expectedCash + cashPayments - cashChange) * 100
  ) / 100

  return shift
}

/**
 * 現金存入/取出
 * @param {object} shift — 班次
 * @param {'in'|'out'} type — 存入或取出
 * @param {number} amount — 金額
 * @param {string} reason — 原因
 * @returns {object} 更新後的班次
 */
export function cashMovement(shift, type, amount, reason) {
  if (shift.status !== 'open') throw new Error('班次已結束')
  if (amount <= 0) throw new Error('金額必須大於零')

  const record = {
    amount: Math.round(amount * 100) / 100,
    reason,
    timestamp: new Date().toISOString(),
  }

  if (type === 'in') {
    shift.cashIn.push(record)
    shift.expectedCash = Math.round((shift.expectedCash + amount) * 100) / 100
  } else {
    shift.cashOut.push(record)
    shift.expectedCash = Math.round((shift.expectedCash - amount) * 100) / 100
  }

  return shift
}

/**
 * 結班（關閉收銀班次）
 * @param {object} shift — 班次
 * @param {number} actualCash — 實際清點現金
 * @returns {object} 結班後的班次（含差異）
 */
export function closeShift(shift, actualCash) {
  if (shift.status !== 'open') throw new Error('班次已結束')

  shift.status = 'closed'
  shift.closedAt = new Date().toISOString()
  shift.actualCash = Math.round(actualCash * 100) / 100
  shift.variance = Math.round((actualCash - shift.expectedCash) * 100) / 100

  return shift
}

/**
 * 取得班次摘要
 * @param {object} shift — 班次
 * @returns {object} 班次摘要
 */
export function getShiftSummary(shift) {
  const transactions = shift.transactions || []
  const totalSales = Math.round(
    transactions.reduce((s, t) => s + t.total, 0) * 100
  ) / 100
  const transactionCount = transactions.length

  // 依付款方式分類
  const paymentBreakdown = {}
  for (const txn of transactions) {
    for (const p of txn.payments) {
      if (!paymentBreakdown[p.method]) paymentBreakdown[p.method] = 0
      paymentBreakdown[p.method] = Math.round(
        (paymentBreakdown[p.method] + p.amount) * 100
      ) / 100
    }
  }

  const totalCashIn = shift.cashIn.reduce((s, c) => s + c.amount, 0)
  const totalCashOut = shift.cashOut.reduce((s, c) => s + c.amount, 0)

  const refundCount = transactions.filter(t => t.total < 0).length
  const refundTotal = Math.round(
    transactions.filter(t => t.total < 0).reduce((s, t) => s + Math.abs(t.total), 0) * 100
  ) / 100

  return {
    shiftId: shift.id,
    terminalId: shift.terminalId,
    operatorId: shift.operatorId,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    status: shift.status,
    transactionCount,
    totalSales,
    refundCount,
    refundTotal,
    netSales: Math.round((totalSales - refundTotal) * 100) / 100,
    paymentBreakdown,
    openingFloat: shift.openingFloat,
    cashIn: totalCashIn,
    cashOut: totalCashOut,
    expectedCash: shift.expectedCash,
    actualCash: shift.actualCash,
    variance: shift.variance,
  }
}

// ─── Z 報表（日結報表）─────────────────────────────────────────

/**
 * 產生 Z 報表（日結報表）
 * @param {Array<object>} shifts — 當日所有班次
 * @param {string} date — 日期 (YYYY-MM-DD)
 * @returns {object} Z 報表
 */
export function generateZReport(shifts, date) {
  const closedShifts = shifts.filter(s => s.status === 'closed')

  const allTransactions = closedShifts.flatMap(s => s.transactions || [])
  const totalSales = Math.round(
    allTransactions.reduce((s, t) => s + Math.max(t.total, 0), 0) * 100
  ) / 100
  const totalRefunds = Math.round(
    allTransactions.filter(t => t.total < 0).reduce((s, t) => s + Math.abs(t.total), 0) * 100
  ) / 100

  // 付款方式彙總
  const paymentSummary = {}
  for (const txn of allTransactions) {
    for (const p of txn.payments) {
      if (!paymentSummary[p.method]) {
        paymentSummary[p.method] = { count: 0, amount: 0 }
      }
      paymentSummary[p.method].count += 1
      paymentSummary[p.method].amount = Math.round(
        (paymentSummary[p.method].amount + p.amount) * 100
      ) / 100
    }
  }

  // 稅額彙總
  const taxSummary = {
    taxableAmount: Math.round(totalSales / 1.05 * 100) / 100, // 反推稅前金額
    taxAmount: Math.round((totalSales - totalSales / 1.05) * 100) / 100,
    totalWithTax: totalSales,
  }

  // 現金差異彙總
  const totalVariance = Math.round(
    closedShifts.reduce((s, shift) => s + (shift.variance || 0), 0) * 100
  ) / 100

  return {
    reportId: `Z-${date}-${Date.now()}`,
    date,
    generatedAt: new Date().toISOString(),
    shiftCount: closedShifts.length,
    transactionCount: allTransactions.length,
    grossSales: totalSales,
    refunds: totalRefunds,
    netSales: Math.round((totalSales - totalRefunds) * 100) / 100,
    paymentSummary,
    taxSummary,
    cashSummary: {
      totalOpening: Math.round(closedShifts.reduce((s, sh) => s + sh.openingFloat, 0) * 100) / 100,
      totalExpected: Math.round(closedShifts.reduce((s, sh) => s + sh.expectedCash, 0) * 100) / 100,
      totalActual: Math.round(closedShifts.reduce((s, sh) => s + (sh.actualCash || 0), 0) * 100) / 100,
      totalVariance,
    },
    averageTransaction: allTransactions.length > 0
      ? Math.round((totalSales / allTransactions.length) * 100) / 100
      : 0,
  }
}

// ─── 含稅 / 未稅切換 ──────────────────────────────────────────

/**
 * 含稅價轉未稅價
 * @param {number} taxInclusivePrice — 含稅價
 * @param {number} [taxRate=0.05] — 稅率
 * @returns {{priceExclTax: number, taxAmount: number, priceInclTax: number}}
 */
export function taxInclusiveToExclusive(taxInclusivePrice, taxRate = 0.05) {
  const priceExclTax = Math.round((taxInclusivePrice / (1 + taxRate)) * 100) / 100
  const taxAmount = Math.round((taxInclusivePrice - priceExclTax) * 100) / 100
  return { priceExclTax, taxAmount, priceInclTax: taxInclusivePrice }
}

/**
 * 未稅價轉含稅價
 * @param {number} priceExclTax — 未稅價
 * @param {number} [taxRate=0.05] — 稅率
 * @returns {{priceExclTax: number, taxAmount: number, priceInclTax: number}}
 */
export function taxExclusiveToInclusive(priceExclTax, taxRate = 0.05) {
  const taxAmount = Math.round(priceExclTax * taxRate * 100) / 100
  const priceInclTax = Math.round((priceExclTax + taxAmount) * 100) / 100
  return { priceExclTax, taxAmount, priceInclTax }
}

/**
 * 切換購物車含稅/未稅顯示模式
 * @param {object} cart — 購物車
 * @param {boolean} taxInclusive — true=含稅 false=未稅
 * @returns {object} 顯示用的購物車資料
 */
export function getCartDisplay(cart, taxInclusive = true) {
  const displayItems = cart.items.map(item => {
    if (taxInclusive) {
      const inclPrice = Math.round(item.price * (1 + (item.taxRate || 0.05)) * 100) / 100
      return {
        ...item,
        displayPrice: inclPrice,
        displayTotal: Math.round(inclPrice * item.qty * 100) / 100,
        priceLabel: '(含稅)',
      }
    }
    return {
      ...item,
      displayPrice: item.price,
      displayTotal: item.lineTotal,
      priceLabel: '(未稅)',
    }
  })

  return {
    items: displayItems,
    subtotal: cart.subtotal,
    taxAmount: cart.taxAmount,
    discountTotal: cart.discounts.reduce((s, d) => s + (d.amount || 0), 0),
    total: cart.total,
    taxInclusive,
  }
}

// ─── 離線模式支援 ──────────────────────────────────────────────

/**
 * 將交易加入離線佇列
 * @param {object} transaction — 交易記錄
 * @returns {object} 佇列項目
 */
export function queueOfflineTransaction(transaction) {
  return {
    id: `OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    transaction,
    queuedAt: new Date().toISOString(),
    synced: false,
    syncAttempts: 0,
    lastSyncAttempt: null,
  }
}

/**
 * 處理離線佇列同步
 * @param {Array<object>} queue — 離線佇列
 * @returns {{pending: Array, synced: Array, failed: Array}}
 */
export function processOfflineQueue(queue) {
  const pending = queue.filter(q => !q.synced && q.syncAttempts < 3)
  const synced = queue.filter(q => q.synced)
  const failed = queue.filter(q => !q.synced && q.syncAttempts >= 3)

  return { pending, synced, failed }
}

/**
 * 標記離線交易為已同步
 * @param {object} queueItem — 佇列項目
 * @returns {object} 更新後的佇列項目
 */
export function markTransactionSynced(queueItem) {
  return {
    ...queueItem,
    synced: true,
    syncedAt: new Date().toISOString(),
  }
}
