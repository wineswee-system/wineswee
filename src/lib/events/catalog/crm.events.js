export const CRM_EVENTS = {
  'crm.lead.scored': {
    domain: 'crm',
    action: 'lead.scored',
    version: 1,
    description: '潛在客戶評分更新',
    payload: {
      customer_id: { type: 'string', required: true },
      customer_name: { type: 'string', required: true },
      old_score: { type: 'number', required: false },
      new_score: { type: 'number', required: true },
    },
  },
  'crm.opportunity.won': {
    domain: 'crm',
    action: 'opportunity.won',
    version: 1,
    description: '商機成交',
    payload: {
      opportunity_id: { type: 'string', required: true },
      customer: { type: 'string', required: true },
      amount: { type: 'number', required: true },
    },
  },
  'crm.segment.changed': {
    domain: 'crm',
    action: 'segment.changed',
    version: 1,
    description: '客戶分群變更',
    payload: {
      customer_id: { type: 'string', required: true },
      old_segment: { type: 'string', required: false },
      new_segment: { type: 'string', required: true },
    },
  },
  'crm.campaign.triggered': {
    domain: 'crm',
    action: 'campaign.triggered',
    version: 1,
    description: '行銷活動觸發',
    payload: {
      campaign_id: { type: 'string', required: true },
      campaign_name: { type: 'string', required: true },
      target_count: { type: 'number', required: false },
    },
  },
}
