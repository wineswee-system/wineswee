/**
 * Payment Gateway 抽象層
 * 統一介面處理各種付款方式：ECPay、LINE Pay、現金、信用卡、銀行轉帳
 * 在正式環境中，gateway 付款會導向第三方付款頁面
 */

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

/**
 * 處理付款（抽象層 — 正式環境會呼叫實際 gateway API）
 * @param {string} method   - 付款方式 key: 'cash' | 'credit_card' | 'ecpay' | 'line_pay' | 'bank_transfer'
 * @param {number} amount   - 付款金額
 * @param {string} orderId  - 訂單編號
 * @param {Object} options  - 額外選項 (cashTendered 等)
 * @returns {Promise<{success: boolean, transactionId: string, method: string, amount: number, timestamp: string, status: string, gatewayUrl?: string|null, message?: string}>}
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

  // Gateway 付款：建立待確認記錄
  // 正式環境中這裡會產生導向 ECPay / LINE Pay 的 URL
  return {
    success: true,
    transactionId,
    method: pm.code,
    methodName: pm.name,
    amount,
    timestamp,
    status: 'pending_confirmation',
    gatewayUrl: null, // 正式環境為第三方付款頁面 URL
    message: `${pm.name} 付款待確認（模擬模式）`,
  }
}

/**
 * 確認付款（模擬 gateway 回呼）
 * @param {string} transactionId - 交易識別碼
 * @returns {Promise<{success: boolean, transactionId: string, status: string, confirmedAt: string}>}
 */
export async function confirmPayment(transactionId) {
  // 正式環境：向 gateway API 驗證交易狀態
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

// ECPay 設定（預留正式憑證）
export const ECPAY_CONFIG = {
  merchantId: import.meta.env.VITE_ECPAY_MERCHANT_ID || '',
  hashKey: import.meta.env.VITE_ECPAY_HASH_KEY || '',
  hashIV: import.meta.env.VITE_ECPAY_HASH_IV || '',
  isProduction: false,
  apiUrl: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
  productionUrl: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
}

// LINE Pay 設定（預留正式憑證）
export const LINEPAY_CONFIG = {
  channelId: import.meta.env.VITE_LINEPAY_CHANNEL_ID || '',
  channelSecret: import.meta.env.VITE_LINEPAY_CHANNEL_SECRET || '',
  isProduction: false,
  apiUrl: 'https://sandbox-api-pay.line.me',
  productionUrl: 'https://api-pay.line.me',
}
