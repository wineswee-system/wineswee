// 新竹物流 adapter — REST API stub.
// Credentials in carrier_configs.api_credentials: {api_key, member_id, base_url}
export class XinzhuAdapter {
  constructor(credentials = {}) {
    this.apiKey = credentials.api_key ?? ''
    this.memberId = credentials.member_id ?? ''
    this.baseUrl = credentials.base_url ?? 'https://api.hct.com.tw/v1'
  }

  async createLabel(job) {
    try {
      const res = await fetch(`${this.baseUrl}/orders`, {
        method: 'POST',
        headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: this.memberId,
          receiver_name: job.shipments?.recipient,
          receiver_address: job.shipments?.destination,
          receiver_phone: job.shipments?.recipient_phone,
          weight: job.weight_kg ?? 1,
        }),
      })
      if (!res.ok) throw new Error(`新竹 API error: ${res.status}`)
      const data = await res.json()
      return { tracking_number: data.order_no, label_url: data.label_pdf, carrier_type: 'xinzhu' }
    } catch (err) {
      console.warn('[XinzhuAdapter] createLabel failed:', err.message)
      return { tracking_number: null, label_url: null, carrier_type: 'xinzhu', error: err.message }
    }
  }

  async getTrackingStatus(trackingNumber) {
    try {
      const res = await fetch(`${this.baseUrl}/trace/${trackingNumber}`, {
        headers: { 'x-api-key': this.apiKey },
      })
      if (!res.ok) return null
      const data = await res.json()
      return { raw_code: data.status, description: data.desc, carrier_type: 'xinzhu' }
    } catch { return null }
  }

  normalizeWebhook(payload) {
    return { rawCode: payload.status, location: payload.station, description: payload.desc }
  }
}
