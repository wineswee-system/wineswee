export const SALES_EVENTS = {
  'sales.order.created': {
    domain: 'sales',
    action: 'order.created',
    version: 1,
    description: '銷售訂單建立',
    payload: {
      order_id: { type: 'string', required: true },
      order_number: { type: 'string', required: false },
      customer: { type: 'string', required: true },
      items: { type: 'array', required: true },
      total_amount: { type: 'number', required: true },
    },
  },
  'sales.order.confirmed': {
    domain: 'sales',
    action: 'order.confirmed',
    version: 1,
    description: '銷售訂單確認',
    payload: {
      order_id: { type: 'string', required: true },
      order_number: { type: 'string', required: true },
      customer: { type: 'string', required: true },
      total_amount: { type: 'number', required: true },
    },
  },
  'sales.quote.converted': {
    domain: 'sales',
    action: 'quote.converted',
    version: 1,
    description: '報價單轉換為銷售訂單',
    payload: {
      quote_id: { type: 'string', required: true },
      order_id: { type: 'string', required: true },
      customer: { type: 'string', required: true },
      total_amount: { type: 'number', required: true },
    },
  },
}
