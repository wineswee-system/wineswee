export const PURCHASE_EVENTS = {
  'purchase.pr.created': {
    domain: 'purchase',
    action: 'pr.created',
    version: 1,
    description: '採購申請建立',
    payload: {
      pr_id: { type: 'string', required: true },
      pr_number: { type: 'string', required: true },
      requester: { type: 'string', required: true },
      items: { type: 'array', required: true },
      total_amount: { type: 'number', required: true },
    },
  },
  'purchase.po.approved': {
    domain: 'purchase',
    action: 'po.approved',
    version: 1,
    description: '採購單核准',
    payload: {
      po_id: { type: 'string', required: true },
      po_number: { type: 'string', required: true },
      supplier: { type: 'string', required: true },
      total_amount: { type: 'number', required: true },
    },
  },
  'purchase.goods_receipt.completed': {
    domain: 'purchase',
    action: 'goods_receipt.completed',
    version: 1,
    description: '進貨驗收完成',
    payload: {
      receipt_id: { type: 'string', required: true },
      po_id: { type: 'string', required: true },
      po_number: { type: 'string', required: true },
      supplier: { type: 'string', required: true },
      total_amount: { type: 'number', required: true },
      tax: { type: 'number', required: false },
      shipping: { type: 'number', required: false },
      payment_terms: { type: 'string', required: false },
      items: { type: 'array', required: false },
    },
  },
}
