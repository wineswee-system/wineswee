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
  // ── Sales order confirmed → reserve stock for order items ──
  bus.subscribe('sales.order.confirmed', async function onOrderConfirmedReserveStock(event) {
    const { order_id, order_number, items } = event.payload
    if (!items || items.length === 0) return

    for (const item of items) {
      const stock = await resolveStockByName(item.name)
      if (!stock) continue
      const newReserved = (stock.reserved_qty || 0) + (item.qty || 0)
      await supabase
        .from('stock_levels')
        .update({ reserved_qty: newReserved })
        .eq('id', stock.id)
    }

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

  // ── POS transaction refunded → restore stock ──
  bus.subscribe('pos.transaction.refunded', async function onPOSRefundRestoreStock(event) {
    const { refund_id, items, store } = event.payload
    if (!items || items.length === 0) return

    for (const item of items) {
      const stock = await resolveStockByName(item.name)
      if (!stock) continue

      const newQty = (stock.quantity || 0) + (item.qty || 0)
      await supabase
        .from('stock_levels')
        .update({ quantity: newQty })
        .eq('id', stock.id)
    }

    await bus.publish('wms.stock.adjusted', {
      reason: 'POS退款還庫',
      source_type: 'pos_refund',
      source_id: refund_id,
      store,
      items: items.map(i => ({ name: i.name, qty: i.qty || 0 })),
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

  // ── Stock below reorder point → notify procurement ──
  bus.subscribe('wms.stock.below_reorder', async function onStockBelowReorderNotify(event) {
    const { items } = event.payload
    if (!items || items.length === 0) return

    const itemNames = items.map(i => i.name || i.sku_name || i.sku_code).filter(Boolean).join('、')
    await supabase.from('notifications').insert({
      type: '庫存警示',
      title: `庫存低於再訂購點：${itemNames}`,
      target_role: '採購',
      priority: 'high',
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[WMS] Stock below reorder notification failed:', error.message)
    })
  })

  // ── Transfer completed → notify warehouse manager ──
  bus.subscribe('wms.transfer.completed', async function onTransferCompletedNotify(event) {
    const { from_warehouse, to_warehouse, items } = event.payload

    await supabase.from('notifications').insert({
      type: '調撥完成',
      title: `庫存調撥完成：${from_warehouse} → ${to_warehouse}（${items?.length || 0} 項）`,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[WMS] Transfer notification failed:', error.message)
    })
  })

  // ── Kit assembled → increase kit stock, decrease component stock ──
  bus.subscribe('wms.kit.assembled', async function onKitAssembledAdjustStock(event) {
    const { kit_sku, quantity, components } = event.payload

    const kitStock = await resolveStockByName(kit_sku)
    if (kitStock) {
      await supabase.from('stock_levels')
        .update({ quantity: (kitStock.quantity || 0) + quantity })
        .eq('id', kitStock.id)
    }

    for (const comp of (components || [])) {
      const compStock = await resolveStockByName(comp.name || comp.sku_code)
      if (compStock) {
        const used = (comp.qty_per_kit || 1) * quantity
        await supabase.from('stock_levels')
          .update({ quantity: Math.max(0, (compStock.quantity || 0) - used) })
          .eq('id', compStock.id)
      }
    }
  })

  // ── Kit disassembled → decrease kit stock, return components to stock ──
  bus.subscribe('wms.kit.disassembled', async function onKitDisassembledAdjustStock(event) {
    const { kit_sku, quantity, components } = event.payload

    const kitStock = await resolveStockByName(kit_sku)
    if (kitStock) {
      await supabase.from('stock_levels')
        .update({ quantity: Math.max(0, (kitStock.quantity || 0) - quantity) })
        .eq('id', kitStock.id)
    }

    for (const comp of (components || [])) {
      const compStock = await resolveStockByName(comp.name || comp.sku_code)
      if (compStock) {
        const returned = (comp.qty_per_kit || 1) * quantity
        await supabase.from('stock_levels')
          .update({ quantity: (compStock.quantity || 0) + returned })
          .eq('id', compStock.id)
      }
    }
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
