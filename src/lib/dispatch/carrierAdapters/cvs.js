// CVS 超商取貨 adapter (7-11 / FamilyMart via ECPay Logistics) — API stub.
// Credentials: {merchant_id, hash_key, hash_iv, base_url, cvs_type}
export class CVSAdapter {
  constructor(credentials = {}) {
    this.merchantId = credentials.merchant_id ?? ''
    this.hashKey = credentials.hash_key ?? ''
    this.hashIv = credentials.hash_iv ?? ''
    this.baseUrl = credentials.base_url ?? 'https://logistics.ecpay.com.tw/Express'
    this.cvsType = credentials.cvs_type ?? 'FAMIC2C'
  }

  async createLabel(job) {
    try {
      const params = new URLSearchParams({
        MerchantID: this.merchantId,
        LogisticsType: 'CVS',
        LogisticsSubType: this.cvsType,
        SenderName: '寄件人',
        ReceiverName: job.shipments?.recipient ?? '',
        ReceiverCellPhone: job.shipments?.recipient_phone ?? '',
        GoodsAmount: Math.round(job.order_value ?? 0),
        GoodsName: '商品',
      })
      const res = await fetch(`${this.baseUrl}/Create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      })
      if (!res.ok) throw new Error(`ECPay CVS error: ${res.status}`)
      const text = await res.text()
      const result = Object.fromEntries(new URLSearchParams(text))
      if (result.RtnCode !== '1') throw new Error(result.RtnMsg)
      return {
        tracking_number: result.AllPayLogisticsID,
        cvs_payment_no: result.CVSPaymentNo,
        cvs_validation_no: result.CVSValidationNo,
        label_url: null,
        carrier_type: 'cvs',
      }
    } catch (err) {
      console.warn('[CVSAdapter] createLabel failed:', err.message)
      return { tracking_number: null, label_url: null, carrier_type: 'cvs', error: err.message }
    }
  }

  async getTrackingStatus() {
    return { raw_code: '2', carrier_type: 'cvs' }
  }

  normalizeWebhook(payload) {
    return { rawCode: payload.RtnCode?.toString(), location: payload.CVSStoreID, description: payload.RtnMsg }
  }
}
