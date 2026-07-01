// 順豐速運 (SF Express) adapter — REST API stub.
// Credentials: {checkword, partner_id, base_url}
export class SFExpressAdapter {
  constructor(credentials = {}) {
    this.checkword = credentials.checkword ?? ''
    this.partnerId = credentials.partner_id ?? ''
    this.baseUrl = credentials.base_url ?? 'https://bspgw.sf-express.com/std/service'
  }

  async createLabel(job) {
    try {
      const res = await fetch(`${this.baseUrl}/order/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerID: this.partnerId,
          checkword: this.checkword,
          j_name: job.shipments?.recipient,
          j_tel: job.shipments?.recipient_phone,
          j_address: job.shipments?.destination,
          cargo_total_weight: job.weight_kg ?? 1,
          express_type: 1,
        }),
      })
      if (!res.ok) throw new Error(`SF API error: ${res.status}`)
      const data = await res.json()
      return { tracking_number: data.mailno, label_url: data.label_url ?? null, carrier_type: 'sfexpress' }
    } catch (err) {
      console.warn('[SFExpressAdapter] createLabel failed:', err.message)
      return { tracking_number: null, label_url: null, carrier_type: 'sfexpress', error: err.message }
    }
  }

  async getTrackingStatus(trackingNumber) {
    try {
      const res = await fetch(`${this.baseUrl}/route/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerID: this.partnerId, checkword: this.checkword, mailno: trackingNumber }),
      })
      if (!res.ok) return null
      const data = await res.json()
      const latest = data?.routes?.[0]
      return { raw_code: latest?.opcode ?? '', description: latest?.remark ?? '', carrier_type: 'sfexpress' }
    } catch { return null }
  }

  normalizeWebhook(payload) {
    return { rawCode: payload.opcode, location: payload.city, description: payload.desc }
  }
}
