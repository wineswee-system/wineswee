export const MANUFACTURING_EVENTS = {
  'manufacturing.mo.state_changed': {
    domain: 'manufacturing',
    action: 'mo.state_changed',
    version: 1,
    description: '製造工單狀態變更',
    payload: {
      mo_id: { type: 'string', required: true },
      mo_number: { type: 'string', required: true },
      from_state: { type: 'string', required: true },
      to_state: { type: 'string', required: true },
      product_name: { type: 'string', required: false },
    },
  },
  'manufacturing.inspection.completed': {
    domain: 'manufacturing',
    action: 'inspection.completed',
    version: 1,
    description: '品質檢驗完成',
    payload: {
      inspection_id: { type: 'string', required: true },
      type: { type: 'string', required: true },
      result: { type: 'string', required: true },
      pass_rate: { type: 'number', required: false },
    },
  },
}
