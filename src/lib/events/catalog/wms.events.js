export const WMS_EVENTS = {
  'wms.shipment.completed': {
    domain: 'wms',
    action: 'shipment.completed',
    version: 1,
    description: '出貨單完成（已掃描、已出貨）',
    payload: {
      shipment_id: { type: 'string', required: true },
      customer: { type: 'string', required: true },
      order_ref: { type: 'string', required: true },
      total_amount: { type: 'number', required: true },
      items: { type: 'array', required: false },
      carrier: { type: 'string', required: false },
      tracking_number: { type: 'string', required: false },
    },
  },
  'wms.stock.adjusted': {
    domain: 'wms',
    action: 'stock.adjusted',
    version: 1,
    description: '庫存數量調整（盤點差異、損耗等）',
    payload: {
      sku_name: { type: 'string', required: true },
      sku_id: { type: 'string', required: false },
      old_qty: { type: 'number', required: true },
      new_qty: { type: 'number', required: true },
      reason: { type: 'string', required: true },
      warehouse_id: { type: 'string', required: false },
    },
  },
  'wms.stock.below_reorder': {
    domain: 'wms',
    action: 'stock.below_reorder',
    version: 1,
    description: '庫存低於再訂購點',
    payload: {
      items: { type: 'array', required: true },
    },
  },
  'wms.transfer.completed': {
    domain: 'wms',
    action: 'transfer.completed',
    version: 1,
    description: '庫存調撥完成',
    payload: {
      transfer_id: { type: 'string', required: true },
      from_warehouse: { type: 'string', required: true },
      to_warehouse: { type: 'string', required: true },
      items: { type: 'array', required: true },
    },
  },
}
