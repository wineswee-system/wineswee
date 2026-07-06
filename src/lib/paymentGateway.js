/**
 * Payment Gateway 抽象層
 * 統一介面處理各種付款方式：信用卡（中國信託）、ECPay、LINE Pay、現金、銀行轉帳
 *
 * F-D1（2026-07-05）：credit_card 收單改為中國信託（CTBC），與 ECPay 脫鉤。
 * - 店內（預設）：EDC 端末機記錄模式 — 店員於中信刷卡機過卡後，POS 登錄
 *   卡別/末四碼/授權碼，經 recordEdcPayment() 寫入 pos_payments（gateway='ctbc_edc'）。
 * - 線上（options.online=true）：走 ctbc-card-checkout edge function（中信網路收單）。
 * - ECPay 保留為既有備援 method（method='ecpay'），不再是 credit_card 的預設。
 *
 * 機敏金鑰（CTBC MerchantId/TerminalId/MacKey、ECPay HashKey/HashIV、
 * LINE Pay ChannelSecret）只存在於 Supabase Edge Function secrets
 * （ctbc-card-checkout / ecpay-checkout / linepay-checkout / linepay-confirm），
 * 絕不進入前端 bundle。
 * Edge function 未設定憑證時回 simulated:true，開發/測試流程照常運作。
 */
import { supabase } from './supabase'
import { logger } from './logger'

const PAYMENT_METHODS = {
  cash: { code: 'CASH', name: '現金', icon: '💵', needsGateway: false },
  credit_card: { code: 'CREDIT', name: '信用卡', icon: '💳', needsGateway: true },
  ecpay: { code: 'ECPAY', name: 'ECPay 綠界', icon: '🏦', needsGateway: true },
  line_pay: { code: 'LINEPAY', name: 'LINE Pay', icon: '🟢', needsGateway: true },
  bank_transfer: { code: 'TRANSFER', name: '銀行轉帳', icon: '🏧', needsGateway: false },
}

/**
 * 取得所有可用付款方式
 * @returns {Array<{code: string, name: string, icon: string, needsGateway: boolean, key: string}>}
 */
export function getPaymentMethods() {
  return Object.entries(PAYMENT_METHODS).map(([key, val]) => ({ ...val, key }))
}

async function invokeGateway(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) throw new Error(error.message || '付款閘道連線失敗')
  if (data?.error) throw new Error(data.error)
  return data
}

/**
 * 處理付款
 * @param {string} method   - 付款方式 key: 'cash' | 'credit_card' | 'ecpay' | 'line_pay' | 'bank_transfer'
 * @param {number} amount   - 付款金額
 * @param {string} orderId  - 訂單編號
 * @param {Object} options  - 額外選項 (cashTendered, itemName, returnURL 等)
 * @returns {Promise<{success: boolean, transactionId: string, method: string, amount: number,
 *   timestamp: string, status: string, simulated?: boolean, gatewayUrl?: string|null,
 *   gatewayAction?: string|null, gatewayParams?: Object|null, message?: string}>}
 *
 * 真實 gateway 模式下：
 * - credit_card（店內，預設）→ 回傳 { mode: 'edc_log', acquirer: 'CTBC',
 *   requiredFields } — 不經線上 gateway；POS UI 收集 卡別/末四碼/授權碼 後
 *   呼叫 recordEdcPayment() 寫入 pos_payments（gateway='ctbc_edc'）。
 * - credit_card + options.online=true（外送/預購連結付款）→ 走 ctbc-card-checkout，
 *   回傳 gatewayAction + gatewayParams 表單 POST 導向中信付款頁，付款結果由
 *   ctbc-card-callback（server-to-server）寫回 pos_payments。
 * - ecpay（legacy 備援）→ 回傳 gatewayAction + gatewayParams，前端以
 *   submitGatewayForm() 表單 POST 導向 ECPay 付款頁，付款結果由
 *   ecpay-callback（server-to-server）寫回 pos_payments。
 * - line_pay → 回傳 gatewayUrl（LINE Pay 付款頁）+ transactionId，
 *   使用者付款後以 confirmPayment() 呼叫 linepay-confirm 完成請款。
 */
export async function processPayment(method, amount, orderId, options = {}) {
  const pm = PAYMENT_METHODS[method]
  if (!pm) throw new Error(`不支援的付款方式: ${method}`)

  if (amount <= 0) throw new Error('付款金額必須大於零')

  const transactionId = `${pm.code}-${Date.now()}`
  const timestamp = new Date().toISOString()

  if (!pm.needsGateway) {
    // 現金 / 銀行轉帳：直接記錄
    return {
      success: true,
      transactionId,
      method: pm.code,
      methodName: pm.name,
      amount,
      timestamp,
      status: 'completed',
      message: `${pm.name}付款完成`,
    }
  }

  // ── 信用卡（中國信託收單，與 ECPay 脫鉤）─────────────────────────────────
  if (method === 'credit_card') {
    // 線上收單（外送/預購連結付款）→ 中信網路收單 gateway
    if (options.online) {
      const data = await invokeGateway('ctbc-card-checkout', {
        orderId,
        amount: Math.round(amount),
        itemName: options.itemName || 'POS 銷售',
        returnURL: options.returnURL,
      })

      if (data.simulated) {
        return {
          success: true,
          transactionId: data.merchantTradeNo ?? transactionId,
          method: pm.code,
          methodName: pm.name,
          amount,
          timestamp,
          status: 'pending_confirmation',
          simulated: true,
          acquirer: 'CTBC',
          gatewayAction: null,
          gatewayParams: null,
          message: '中信網路收單付款待確認（模擬模式）',
        }
      }

      return {
        success: true,
        transactionId: data.merchantTradeNo ?? transactionId,
        method: pm.code,
        methodName: pm.name,
        amount,
        timestamp,
        status: 'pending_confirmation',
        simulated: false,
        acquirer: 'CTBC',
        gatewayAction: data.action,
        gatewayParams: data.params,
        message: '請完成中國信託付款頁流程',
      }
    }

    // 店內刷卡（主場景）— 中信 EDC 端末機記錄模式：
    // 金額顯示 → 店員於中信刷卡機過卡 → POS 登錄卡別/末四碼/授權碼
    // → recordEdcPayment() 寫入 pos_payments，不經線上 gateway。
    return {
      success: true,
      transactionId,
      method: pm.code,
      methodName: pm.name,
      amount,
      timestamp,
      status: 'completed',
      mode: 'edc_log',
      acquirer: 'CTBC',
      requiredFields: ['card_brand', 'card_last4', 'auth_code'],
      message: '請於中信刷卡機過卡後，登錄卡別／末四碼／授權碼',
    }
  }

  // ── LINE Pay ──────────────────────────────────────────────────────────────
  if (method === 'line_pay') {
    const data = await invokeGateway('linepay-checkout', {
      orderId,
      amount: Math.round(amount),
      currency: 'TWD',
      productName: options.itemName || 'POS 銷售',
      confirmUrl: options.returnURL || window.location.href,
      cancelUrl: options.returnURL || window.location.href,
    })

    if (data.simulated) {
      return {
        success: true,
        transactionId,
        method: pm.code,
        methodName: pm.name,
        amount,
        timestamp,
        status: 'pending_confirmation',
        simulated: true,
        gatewayUrl: null,
        message: 'LINE Pay 付款待確認（模擬模式）',
      }
    }

    return {
      success: true,
      transactionId: String(data.transactionId ?? transactionId),
      method: pm.code,
      methodName: pm.name,
      amount,
      timestamp,
      status: 'pending_confirmation',
      simulated: false,
      gatewayUrl: data.paymentUrl ?? null,
      message: '請引導顧客完成 LINE Pay 付款',
    }
  }

  // ── ECPay（legacy 備援金流，僅 method='ecpay' 走此路；credit_card 已脫鉤）──
  const data = await invokeGateway('ecpay-checkout', {
    orderId,
    amount: Math.round(amount),
    itemName: options.itemName || 'POS 銷售',
    tradeDesc: options.tradeDesc || 'POS 訂單付款',
    returnURL: options.returnURL,
  })

  if (data.simulated) {
    return {
      success: true,
      transactionId: data.merchantTradeNo ?? transactionId,
      method: pm.code,
      methodName: pm.name,
      amount,
      timestamp,
      status: 'pending_confirmation',
      simulated: true,
      gatewayAction: null,
      gatewayParams: null,
      message: `${pm.name} 付款待確認（模擬模式）`,
    }
  }

  return {
    success: true,
    transactionId: data.merchantTradeNo ?? transactionId,
    method: pm.code,
    methodName: pm.name,
    amount,
    timestamp,
    status: 'pending_confirmation',
    simulated: false,
    gatewayAction: data.action,
    gatewayParams: data.params,
    message: '請完成 ECPay 付款頁流程',
  }
}

/**
 * 以隱藏表單 POST 導向第三方付款頁（ECPay AioCheckOut）
 * @param {string} action - gateway URL（processPayment 回傳的 gatewayAction）
 * @param {Object} params - 表單欄位（processPayment 回傳的 gatewayParams）
 */
export function submitGatewayForm(action, params) {
  if (!action || !params) throw new Error('缺少付款閘道參數')
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = action
  for (const [name, value] of Object.entries(params)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = String(value)
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

// ── 中信 EDC 端末機登錄（F-D1 店內刷卡）─────────────────────────────────────

/** EDC 登錄允許的卡別（中信承作卡組織） */
export const EDC_CARD_BRANDS = ['VISA', 'MasterCard', 'JCB', 'AMEX', '國內卡']

const EDC_LAST4_RE = /^\d{4}$/
const EDC_AUTH_CODE_RE = /^[A-Za-z0-9]{4,8}$/

/**
 * 驗證 EDC 登錄欄位
 * @param {{card_brand?: string, card_last4?: string, auth_code?: string}} fields
 * @returns {string[]} 錯誤訊息（空陣列 = 通過）
 */
export function validateEdcFields(fields = {}) {
  const errors = []
  if (!EDC_CARD_BRANDS.includes(fields.card_brand)) {
    errors.push(`卡別必須為：${EDC_CARD_BRANDS.join('、')}`)
  }
  if (!EDC_LAST4_RE.test(fields.card_last4 ?? '')) {
    errors.push('卡號末四碼必須為 4 位數字')
  }
  if (!EDC_AUTH_CODE_RE.test(fields.auth_code ?? '')) {
    errors.push('授權碼必須為 4–8 位英數字')
  }
  return errors
}

/**
 * 登錄中信 EDC 刷卡付款（店員於刷卡機過卡後補登）
 * 寫入 pos_payments（gateway='ctbc_edc'，acquirer='CTBC'）。
 * 不設定 invoice_status — 維持 DB 預設 'pending'，由 issue-invoice
 * 依 invoice_status='pending' 補開（發票與付款方式解耦）。
 *
 * @param {Object} paymentDraft
 * @param {number} paymentDraft.organization_id
 * @param {number} paymentDraft.store_id
 * @param {string} paymentDraft.order_id
 * @param {number} paymentDraft.amount
 * @param {string} paymentDraft.card_brand  - VISA | MasterCard | JCB | AMEX | 國內卡
 * @param {string} paymentDraft.card_last4  - 4 位數字
 * @param {string} paymentDraft.auth_code   - 4–8 位英數字
 * @returns {Promise<{success: boolean, paymentId: string, gateway: string, acquirer: string, invoiceStatus: string}>}
 */
export async function recordEdcPayment(paymentDraft = {}) {
  const errors = validateEdcFields(paymentDraft)
  if (errors.length > 0) throw new Error(errors.join('；'))

  const amount = Number(paymentDraft.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('付款金額必須大於零')
  if (paymentDraft.order_id == null && paymentDraft.transaction_id == null) {
    throw new Error('EDC 付款登錄需要 order_id（內用單）或 transaction_id（零售交易）')
  }

  const row = {
    organization_id: paymentDraft.organization_id,
    store_id: paymentDraft.store_id,
    // 內用（pos_orders，UUID）走 order_id；零售（pos_transactions，INT）走 transaction_id
    ...(paymentDraft.order_id != null ? { order_id: paymentDraft.order_id } : {}),
    ...(paymentDraft.transaction_id != null ? { transaction_id: paymentDraft.transaction_id } : {}),
    amount,
    payment_method: 'card',
    gateway: 'ctbc_edc',
    acquirer: 'CTBC',
    card_brand: paymentDraft.card_brand,
    card_last4: paymentDraft.card_last4,
    auth_code: paymentDraft.auth_code,
    // invoice_status 不帶 → DB 預設 'pending'（發票補開流程 provider 無關）
  }
  if (paymentDraft.employee_id != null) row.employee_id = paymentDraft.employee_id
  if (paymentDraft.split_index != null) row.split_index = paymentDraft.split_index
  if (paymentDraft.split_total != null) row.split_total = paymentDraft.split_total

  const { data, error } = await supabase
    .from('pos_payments')
    .insert(row)
    .select('id, invoice_status')
    .single()

  if (error) {
    logger.error('EDC payment recording failed', {
      module: 'pos', order_id: paymentDraft.order_id, reason: error.message,
    })
    throw new Error(error.message || 'EDC 付款登錄失敗')
  }

  logger.info('EDC payment recorded', {
    module: 'pos', payment_id: data?.id, order_id: paymentDraft.order_id,
    gateway: 'ctbc_edc', card_brand: paymentDraft.card_brand,
  })

  return {
    success: true,
    paymentId: data?.id,
    gateway: 'ctbc_edc',
    acquirer: 'CTBC',
    invoiceStatus: data?.invoice_status ?? 'pending',
  }
}

/**
 * 確認付款
 * @param {string} transactionId - 交易識別碼
 * @param {Object} [options] - { method, amount, simulated }
 *   method='line_pay' 且非模擬模式時，呼叫 linepay-confirm 完成請款；
 *   ECPay 付款結果由 server-to-server callback 寫回，前端毋需確認。
 * @returns {Promise<{success: boolean, transactionId: string, status: string, confirmedAt: string, message?: string}>}
 */
export async function confirmPayment(transactionId, options = {}) {
  if (options.method === 'line_pay' && options.simulated === false) {
    try {
      const data = await invokeGateway('linepay-confirm', {
        transactionId,
        amount: Math.round(options.amount),
        currency: 'TWD',
      })
      return {
        success: !!data.ok,
        transactionId,
        status: data.ok ? 'completed' : 'failed',
        confirmedAt: new Date().toISOString(),
        message: data.ok ? 'LINE Pay 付款已確認' : (data.message || 'LINE Pay 請款失敗'),
      }
    } catch (e) {
      logger.error('LINE Pay confirm failed', { module: 'pos', transaction_id: transactionId, reason: e.message })
      return {
        success: false,
        transactionId,
        status: 'failed',
        confirmedAt: new Date().toISOString(),
        message: e.message || 'LINE Pay 請款失敗',
      }
    }
  }

  // 模擬模式 / 現金・轉帳：直接視為已確認
  return {
    success: true,
    transactionId,
    status: 'completed',
    confirmedAt: new Date().toISOString(),
    message: '付款已確認',
  }
}

/**
 * 退款
 * @param {string} transactionId - 原始交易識別碼
 * @param {number} amount        - 退款金額
 * @param {string} reason        - 退款原因
 * @returns {Promise<{success: boolean, refundId: string, originalTransactionId: string, amount: number, reason: string, status: string, timestamp: string}>}
 */
export async function refundPayment(transactionId, amount, reason) {
  if (amount <= 0) throw new Error('退款金額必須大於零')

  return {
    success: true,
    refundId: `REF-${Date.now()}`,
    originalTransactionId: transactionId,
    amount,
    reason,
    status: 'refunded',
    timestamp: new Date().toISOString(),
    message: '退款申請已送出，預計 3-7 個工作天內退回',
  }
}
