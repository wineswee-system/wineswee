export const POS_EVENTS = {
  'pos.transaction.completed': {
    domain: 'pos',
    action: 'transaction.completed',
    version: 1,
    description: 'POS 交易完成',
    payload: {
      transaction_id: { type: 'string', required: true },
      transaction_number: { type: 'string', required: true },
      store: { type: 'string', required: true },
      cashier: { type: 'string', required: true },
      total: { type: 'number', required: true },
      payment_method: { type: 'string', required: false },
      items: { type: 'array', required: false },
    },
  },
  'pos.shift.opened': {
    domain: 'pos',
    action: 'shift.opened',
    version: 1,
    description: 'POS 班次開始',
    payload: {
      shift_id: { type: 'string', required: true },
      store: { type: 'string', required: true },
      cashier: { type: 'string', required: true },
      opening_cash: { type: 'number', required: true },
    },
  },
  'pos.shift.closed': {
    domain: 'pos',
    action: 'shift.closed',
    version: 1,
    description: 'POS 班次結束',
    payload: {
      shift_id: { type: 'string', required: true },
      store: { type: 'string', required: true },
      cashier: { type: 'string', required: true },
      closing_cash: { type: 'number', required: true },
      cash_difference: { type: 'number', required: false },
    },
  },
}
