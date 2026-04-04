/**
 * 金流整合模組 (Payment Gateway)
 * 支援：信用卡、LINE Pay、ECPay（綠界）、銀行轉帳、現金
 * 結構化設計，預留實際 API 串接介面
 */

// 金流服務商設定
export const GATEWAY_CONFIG = {
  ecpay: {
    name: 'ECPay 綠界',
    // TODO: 替換為正式 MerchantID 與 HashKey/HashIV
    merchantId: '',
    hashKey: '',
    hashIV: '',
    apiUrl: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
    productionUrl: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
    returnUrl: '',
    notifyUrl: '',
    isProduction: false,
  },
  line_pay: {
    name: 'LINE Pay',
    // TODO: 替換為正式 Channel ID 與 Secret
    channelId: '',
    channelSecret: '',
    apiUrl: 'https://sandbox-api-pay.line.me',
    productionUrl: 'https://api-pay.line.me',
    confirmUrl: '',
    cancelUrl: '',
    isProduction: false,
  },
}

// 可用付款方式
export const PAYMENT_METHODS = [
  { code: 'credit_card', label: '信用卡', icon: '💳', gateway: 'ecpay', enabled: true },
  { code: 'line_pay', label: 'LINE Pay', icon: '🟢', gateway: 'line_pay', enabled: true },
  { code: 'ecpay', label: '綠界金流', icon: '🏦', gateway: 'ecpay', enabled: true },
  { code: 'bank_transfer', label: '銀行轉帳', icon: '🏧', gateway: null, enabled: true },
  { code: 'cash', label: '現金', icon: '💵', gateway: null, enabled: true },
]

/**
 * 產生付款識別碼
 */
function generatePaymentId() {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 8)
  return `PAY-${ts}-${rand}`.toUpperCase()
}

/**
 * 建立付款請求
 * @param {Object} order   - 訂單 { orderId, amount, currency, description, customerEmail, customerName }
 * @param {string} method  - 付款方式: 'credit_card' | 'line_pay' | 'ecpay' | 'bank_transfer' | 'cash'
 * @param {string} gateway - 金流商: 'ecpay' | 'line_pay' (可選，依 method 自動判斷)
 * @returns {{ paymentId: string, redirectUrl: string|null, formData: Object|null, method: string, status: string }}
 */
export function createPaymentRequest(order, method, gateway) {
  const paymentId = generatePaymentId()
  const resolvedGateway = gateway || PAYMENT_METHODS.find(m => m.code === method)?.gateway

  // 現金與銀行轉帳不需要第三方金流
  if (method === 'cash') {
    return {
      paymentId,
      redirectUrl: null,
      formData: null,
      method,
      status: 'pending_confirmation',
      message: '現金付款，請確認收款後手動更新狀態',
    }
  }

  if (method === 'bank_transfer') {
    // TODO: 可整合虛擬帳號 API
    return {
      paymentId,
      redirectUrl: null,
      formData: {
        bankCode: '012',
        bankName: '台北富邦銀行',
        accountNumber: `9${String(Date.now()).slice(-12)}`, // 模擬虛擬帳號
        amount: order.amount,
        expireDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
      method,
      status: 'awaiting_transfer',
      message: '請於期限內完成轉帳',
    }
  }

  if (resolvedGateway === 'ecpay') {
    const config = GATEWAY_CONFIG.ecpay
    // TODO: 正式環境需使用 HashKey/HashIV 產生 CheckMacValue
    return {
      paymentId,
      redirectUrl: config.isProduction ? config.productionUrl : config.apiUrl,
      formData: {
        MerchantID: config.merchantId,
        MerchantTradeNo: paymentId.replace(/-/g, '').slice(0, 20),
        MerchantTradeDate: new Date().toISOString().replace('T', ' ').slice(0, 19),
        PaymentType: 'aio',
        TotalAmount: Math.round(order.amount),
        TradeDesc: encodeURIComponent(order.description || '訂單付款'),
        ItemName: order.description || '商品',
        ReturnURL: config.notifyUrl,
        OrderResultURL: config.returnUrl,
        ChoosePayment: method === 'credit_card' ? 'Credit' : 'ALL',
        CheckMacValue: '', // TODO: 實際產生雜湊驗證碼
      },
      method,
      status: 'pending',
      message: '請導向 ECPay 付款頁面',
    }
  }

  if (resolvedGateway === 'line_pay') {
    const config = GATEWAY_CONFIG.line_pay
    // TODO: 正式環境需使用 channelSecret 產生 HMAC 簽章
    return {
      paymentId,
      redirectUrl: `${config.isProduction ? config.productionUrl : config.apiUrl}/v3/payments/request`,
      formData: {
        amount: Math.round(order.amount),
        currency: order.currency || 'TWD',
        orderId: paymentId,
        packages: [{
          id: order.orderId,
          amount: Math.round(order.amount),
          name: order.description || '訂單付款',
        }],
        redirectUrls: {
          confirmUrl: config.confirmUrl,
          cancelUrl: config.cancelUrl,
        },
      },
      method,
      status: 'pending',
      message: '請導向 LINE Pay 付款頁面',
    }
  }

  return {
    paymentId,
    redirectUrl: null,
    formData: null,
    method,
    status: 'error',
    message: `不支援的付款方式: ${method}`,
  }
}

/**
 * 驗證金流回呼資料簽章
 * @param {Object} callbackData - 金流回傳資料
 * @param {string} gateway      - 金流商: 'ecpay' | 'line_pay'
 * @returns {{ verified: boolean, paymentId: string, status: string, error?: string }}
 */
export function verifyPaymentCallback(callbackData, gateway) {
  // TODO: 正式環境需實作各金流商的簽章驗證邏輯

  if (gateway === 'ecpay') {
    // ECPay 回傳：RtnCode=1 表示成功
    const success = callbackData.RtnCode === '1' || callbackData.RtnCode === 1
    return {
      verified: true, // TODO: 驗證 CheckMacValue
      paymentId: callbackData.MerchantTradeNo || '',
      status: success ? 'completed' : 'failed',
      amount: Number(callbackData.TradeAmt || 0),
      transactionId: callbackData.TradeNo || '',
      message: callbackData.RtnMsg || '',
    }
  }

  if (gateway === 'line_pay') {
    const success = callbackData.returnCode === '0000'
    return {
      verified: true, // TODO: 驗證 HMAC 簽章
      paymentId: callbackData.orderId || '',
      status: success ? 'completed' : 'failed',
      transactionId: callbackData.transactionId || '',
      message: callbackData.returnMessage || '',
    }
  }

  return {
    verified: false,
    paymentId: '',
    status: 'unknown',
    error: `未知的金流商: ${gateway}`,
  }
}

/**
 * 建立退款請求
 * @param {string} paymentId - 原始付款編號
 * @param {number} amount    - 退款金額
 * @param {string} reason    - 退款原因
 * @returns {{ success: boolean, refundId: string, paymentId: string, amount: number, status: string }}
 */
export function processRefund(paymentId, amount, reason) {
  // TODO: 實際呼叫金流商退款 API
  const refundId = `REF-${Date.now().toString(36).toUpperCase()}`

  return {
    success: true,
    refundId,
    paymentId,
    amount,
    reason,
    status: 'refund_pending',
    message: '退款申請已送出，預計 3-7 個工作天內退回',
    createdAt: new Date().toISOString(),
  }
}

/**
 * 查詢付款狀態
 * @param {string} paymentId - 付款編號
 * @returns {{ status: string, details: Object }}
 */
export function getPaymentStatus(paymentId) {
  // TODO: 實際查詢金流商 API 或資料庫
  // 模擬回傳
  return {
    paymentId,
    status: 'completed', // 'pending' | 'completed' | 'failed' | 'refunded'
    details: {
      method: 'credit_card',
      amount: 0,
      currency: 'TWD',
      paidAt: new Date().toISOString(),
      transactionId: `TXN-${paymentId}`,
      gateway: 'ecpay',
    },
  }
}
