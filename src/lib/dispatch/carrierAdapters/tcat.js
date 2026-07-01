// 黑貓宅急便 (T-Cat) adapter — REST API stub.
// Populate credentials in carrier_configs.api_credentials: {api_key, customer_id, base_url}
export class TCatAdapter {
  constructor(credentials = {}) {
    this.apiKey = credentials.api_key ?? ''
    this.customerId = credentials.customer_id ?? ''
    this.baseUrl = credentials.base_url ?? 'https://api.tcat.com.tw/v1'
  }

  async createLabel(job) {
    try {
      const res = await fetch(`${this.baseUrl}/shipments`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: this.customerId,
          recipient: job.shipments?.recipient,
          address: job.shipments?.destination,
          phone: job.shipments?.recipient_phone,
          weight: job.weight_kg ?? 1,
        }),
      })
      if (!res.ok) throw new Error(`T-Cat API error: ${res.status}`)
      const data = await res.json()
      return { tracking_number: data.tracking_no, label_url: data.label_url, carrier_type: 'tcat' }
    } catch (err) {
      console.warn('[TCatAdapter] createLabel failed:', err.message)
      return { tracking_number: null, label_url: null, carrier_type: 'tcat', error: err.message }
    }
  }

  async getTrackingStatus(trackingNumber) {
    try {
      const res = await fetch(`${this.baseUrl}/tracking/${trackingNumber}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      })
      if (!res.ok) throw new Error(`T-Cat tracking error: ${res.status}`)
      const data = await res.json()
      return { raw_code: data.status_code, description: data.status_desc, carrier_type: 'tcat' }
    } catch {
      return null
    }
  }

  async cancelShipment(trackingNumber) {
    try {
      const res = await fetch(`${this.baseUrl}/shipments/${trackingNumber}/cancel`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${this.apiKey}` },
      })
      return { success: res.ok }
    } catch { return { success: false } }
  }

  normalizeWebhook(payload) {
    return { rawCode: payload.status_code, location: payload.location, description: payload.status_desc }
  }
}
