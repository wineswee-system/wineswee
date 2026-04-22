import { supabase } from '../../supabase.js'

// stock_levels 只有 sku_code（不是 sku_name），事件 payload 給的是品項名 → 先到 skus 表查 code
async function resolveStockByName(itemName) {
  if (!itemName) return null
  const { data: sku } = await supabase.from('skus').select('code').eq('name', itemName).maybeSingle()
  if (!sku?.code) return null
  const { data: stock } = await supabase.from('stock_levels').select('*').eq('sku_code', sku.code).maybeSingle()
  return stock
}

/**
 * WMS event handlers.
 * Subscribes to cross-module events that affect inventory and warehouse operations.
 */
export function registerWMSHandlers(bus) {
  // ── Sales order created → reserve stock for order items ──
  // NOTE: stock_levels 沒有 reserved_qty 欄位；預留邏輯暫以事件記錄，等 schema 補欄位再持久化
  bus.subscribe('sales.order.confirmed', async function onOrderConfirmedReserveStock(event) {
    const { order_id, order_number, items } = event.payload
    if (!items || items.length === 0) return

    // 僅發 wms.stock.reserved 事件讓下游知道（DB 沒欄位可記，跳過更新）
    await bus.publish('wms.stock.reserved', {
      order_id,
      order_number,
      items: items.map(i => ({ name: i.name, qty: i.qty })),
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── POS transaction completed → deduct stock ──
  bus.subscribe('pos.transaction.completed', async function onPOSTransactionDeductStock(event) {
    const { transaction_id, items, store } = event.payload
    if (!items || items.length === 0) return

    for (const item of items) {
      const stock = await resolveStockByName(item.name)
      if (!stock) continue

      const newQty = Math.max(0, (stock.quantity || 0) - (item.qty || 0))
      await supabase
        .from('stock_levels')
        .update({ quantity: newQty })
        .eq('id', stock.id)
    }

    await bus.publish('wms.stock.adjusted', {
      reason: 'POS銷售扣減',
      source_type: 'pos_transaction',
      source_id: transaction_id,
      store,
      items: items.map(i => ({ name: i.name, qty: -(i.qty || 0) })),
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── Goods receipt completed → increase stock ──
  bus.subscribe('purchase.goods_receipt.completed', async function onGoodsReceiptIncreaseStock(event) {
    const { items, po_number } = event.payload
    if (!items || items.length === 0) return

    for (const item of items) {
      const stock = await resolveStockByName(item.name)
      if (stock) {
        await supabase
          .from('stock_levels')
          .update({ quantity: (stock.quantity || 0) + (item.qty || 0) })
          .eq('id', stock.id)
      }
    }

    await bus.publish('wms.stock.adjusted', {
      reason: '採購入庫',
      source_type: 'goods_receipt',
      source_id: po_number,
      items: items.map(i => ({ name: i.name, qty: i.qty || 0 })),
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── Manufacturing order completed → receive finished goods ──
  bus.subscribe('manufacturing.mo.state_changed', async function onMOCompletedReceiveFG(event) {
    const { mo_id, mo_number, to_state, product_name, quantity } = event.payload
    if (to_state !== '已完成') return

    if (product_name && quantity) {
      const stock = await resolveStockByName(product_name)
      if (stock) {
        await supabase
          .from('stock_levels')
          .update({ quantity: (stock.quantity || 0) + quantity })
          .eq('id', stock.id)
      }

      await bus.publish('wms.stock.adjusted', {
        reason: '製造完工入庫',
        source_type: 'manufacturing_order',
        source_id: mo_id,
        items: [{ name: product_name, qty: quantity }],
      }, {
        causation_id: event.id,
        correlation_id: event.metadata.correlation_id,
      })
    }
  })

  // ── Return restocked → increase stock for passed items ──
  bus.subscribe('wms.return.restocked', async function onReturnRestocked(event) {
    const { return_id, return_number, items } = event.payload
    if (!items || items.length === 0) return

    for (const item of items) {
      if (!item.pass_qty || item.pass_qty <= 0) continue

      const { data: stock } = await supabase
        .from('stock_levels')
        .select('*')
        .eq('sku_code', item.sku_code)
        .maybeSingle()

      if (stock) {
        await supabase
          .from('stock_levels')
          .update({ quantity: (stock.quantity || 0) + item.pass_qty })
          .eq('id', stock.id)
      }
    }

    await bus.publish('wms.stock.adjusted', {
      reason: '退貨入庫',
      source_type: 'return_order',
      source_id: return_number,
      items: items.filter(i => i.pass_qty > 0).map(i => ({ name: i.sku_code, qty: i.pass_qty })),
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── Auto-reorder triggered → create draft purchase orders ──
  bus.subscribe('wms.auto_reorder.triggered', async function onAutoReorderCreatePOs(event) {
    const { purchase_orders } = event.payload
    if (!purchase_orders || purchase_orders.length === 0) return

    for (const po of purchase_orders) {
      await supabase.from('purchase_orders').insert({
        po_number: po.poNumber,
        supplier: po.supplier,
        items: po.items,
        total_amount: po.totalAmount,
        expected_date: po.expectedDate,
        status: po.status,
      })
    }
  })
}
