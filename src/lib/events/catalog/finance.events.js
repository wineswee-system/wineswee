export const FINANCE_EVENTS = {
  'finance.ar.created': {
    domain: 'finance',
    action: 'ar.created',
    version: 1,
    description: '應收帳款建立',
    payload: {
      ar_id: { type: 'string', required: true },
      invoice_number: { type: 'string', required: true },
      customer: { type: 'string', required: true },
      amount: { type: 'number', required: true },
      source: { type: 'string', required: false },
      source_id: { type: 'string', required: false },
    },
  },
  'finance.ap.created': {
    domain: 'finance',
    action: 'ap.created',
    version: 1,
    description: '應付帳款建立',
    payload: {
      ap_id: { type: 'string', required: true },
      bill_number: { type: 'string', required: true },
      supplier: { type: 'string', required: true },
      amount: { type: 'number', required: true },
      po_ref: { type: 'string', required: false },
    },
  },
  'finance.journal.posted': {
    domain: 'finance',
    action: 'journal.posted',
    version: 1,
    description: '傳票過帳',
    payload: {
      entry_id: { type: 'string', required: true },
      entry_number: { type: 'string', required: true },
      amount: { type: 'number', required: true },
      description: { type: 'string', required: false },
    },
  },
  'finance.payment.recorded': {
    domain: 'finance',
    action: 'payment.recorded',
    version: 1,
    description: '收付款記錄',
    payload: {
      payment_id: { type: 'string', required: true },
      type: { type: 'string', required: true },
      amount: { type: 'number', required: true },
      reference_id: { type: 'string', required: false },
    },
  },
}
