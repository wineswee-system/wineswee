// Own-fleet adapter — driver app updates status directly; no external API needed.
export class OwnFleetAdapter {
  constructor() {}

  async createLabel(job) {
    return { tracking_number: job.job_number, label_url: null, carrier_type: 'own_fleet' }
  }

  async getTrackingStatus(jobNumber) {
    return { raw_code: 'in_transit', carrier_type: 'own_fleet' }
  }

  async cancelShipment() {
    return { success: true }
  }

  normalizeStatus(rawCode) {
    const map = {
      departed: '已出發', in_transit: '運送中', arrived: '已抵達',
      delivered: '已簽收', failed: '派送失敗',
    }
    return map[rawCode] ?? rawCode
  }
}
