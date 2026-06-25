import { supabase } from './supabase'

export async function getTable(tableId) {
  return supabase
    .from('res_tables')
    .select('id, table_number, capacity, shape')
    .eq('id', tableId)
    .single()
}

export async function getMenuCategories(storeId) {
  return supabase
    .from('pos_menu_categories')
    .select('id, name, display_order')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('display_order')
}

export async function getMenuItems(storeId, categoryId = null) {
  let q = supabase
    .from('pos_menu_items')
    .select('id, name, description, unit_price, tax_rate, image_url, category_id')
    .eq('store_id', storeId)
    .eq('is_available', true)
    .order('display_order')
  if (categoryId) q = q.eq('category_id', categoryId)
  return q
}

export async function getPosProducts(storeId) {
  return supabase
    .from('pos_products')
    .select('id, name, barcode, retail_price, tax_rate, category, image_url')
    .eq('store_id', storeId)
    .eq('is_available', true)
    .order('name')
}

export async function getPosProductByBarcode(storeId, barcode) {
  return supabase
    .from('pos_products')
    .select('id, name, barcode, retail_price, tax_rate')
    .eq('store_id', storeId)
    .eq('barcode', barcode)
    .maybeSingle()
}

export async function getOrCreateOrder(storeId, orgId, tableId, employeeId) {
  const { data: existing } = await supabase
    .from('pos_orders')
    .select('id, status, order_number, guest_count, note, shift_id, opened_at')
    .eq('store_id', storeId)
    .eq('table_id', tableId)
    .in('status', ['open', 'submitted'])
    .maybeSingle()

  if (existing) return { data: existing, error: null }

  // Find or create the open shift for this store
  let { data: shift } = await supabase
    .from('pos_shifts')
    .select('id, order_counter')
    .eq('store_id', storeId)
    .eq('status', 'open')
    .maybeSingle()

  if (!shift) {
    const { data: newShift } = await supabase
      .from('pos_shifts')
      .insert({ organization_id: orgId, store_id: storeId, employee_id: employeeId, status: 'open' })
      .select('id, order_counter')
      .single()
    shift = newShift
  }

  // Atomic increment via DB function → returns '001', '042', etc.
  let orderNumber = null
  if (shift?.id) {
    const { data: num } = await supabase.rpc('next_order_number', { p_shift_id: shift.id })
    orderNumber = num
  }

  return supabase
    .from('pos_orders')
    .insert({
      organization_id: orgId,
      store_id: storeId,
      table_id: tableId,
      shift_id: shift?.id ?? null,
      order_number: orderNumber,
      opened_by: employeeId,
      status: 'open',
    })
    .select('id, status, order_number, guest_count, note, shift_id, opened_at')
    .single()
}

export async function getOrderItems(orderId) {
  return supabase
    .from('pos_order_items')
    .select('id, item_type, menu_item_id, pos_product_id, name, unit_price, tax_rate, quantity, note, source, sent_to_kitchen, created_at')
    .eq('order_id', orderId)
    .order('created_at')
}

export async function addOrderItem(orderId, { itemType, menuItemId, posProductId, name, unitPrice, taxRate, quantity = 1, note = '' }) {
  return supabase
    .from('pos_order_items')
    .insert({
      order_id: orderId,
      item_type: itemType,
      menu_item_id: menuItemId ?? null,
      pos_product_id: posProductId ?? null,
      name,
      unit_price: unitPrice,
      tax_rate: taxRate ?? 0.05,
      quantity,
      note,
      source: 'staff',
    })
    .select('id, name, unit_price, quantity')
    .single()
}

export async function updateOrderItemQty(itemId, quantity) {
  if (quantity <= 0) {
    return supabase.from('pos_order_items').delete().eq('id', itemId)
  }
  return supabase
    .from('pos_order_items')
    .update({ quantity })
    .eq('id', itemId)
    .select('id, quantity')
    .single()
}

export async function getOrder(orderId) {
  return supabase
    .from('pos_orders')
    .select('id, status, order_number, guest_count, note, table_id, reservation_id, opened_at')
    .eq('id', orderId)
    .single()
}

export async function submitToKitchen(orderId) {
  const { error } = await supabase
    .from('pos_order_items')
    .update({ sent_to_kitchen: true })
    .eq('order_id', orderId)
    .eq('sent_to_kitchen', false)

  if (error) return { error }

  return supabase
    .from('pos_orders')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', orderId)
    .select('id, status')
    .single()
}

export async function cancelOrderItem(itemId) {
  return supabase.from('pos_order_items').delete().eq('id', itemId)
}

export async function voidOrder(orderId) {
  return supabase
    .from('pos_orders')
    .update({ status: 'voided' })
    .eq('id', orderId)
}

// Creates a pos_payments row, marks order paid, invalidates QR session, completes linked reservation,
// then fires complete-order edge function in the background (invoice issuance + inventory deduction).
export async function completePayment({ orderId, storeId, orgId, employeeId, amount, method, carrierType = null, carrierId = null, splitIndex = 1, splitTotal = 1 }) {
  const { data: payment, error: payErr } = await supabase
    .from('pos_payments')
    .insert({
      organization_id: orgId,
      store_id: storeId,
      order_id: orderId,
      amount,
      payment_method: method,
      carrier_type: carrierType || null,
      carrier_number: carrierId || null,
      invoice_status: 'pending',
      split_index: splitIndex,
      split_total: splitTotal,
      employee_id: employeeId,
    })
    .select('id, amount, payment_method, invoice_status, paid_at')
    .single()

  if (payErr) return { error: payErr }

  await supabase
    .from('pos_orders')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', orderId)

  const { data: order } = await supabase
    .from('pos_orders')
    .select('reservation_id')
    .eq('id', orderId)
    .single()

  await supabase
    .from('qr_order_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .is('revoked_at', null)

  if (order?.reservation_id) {
    await supabase
      .from('reservations')
      .update({ status: 'completed' })
      .eq('id', order.reservation_id)
  }

  // Fire-and-forget: invoice issuance + inventory deduction run server-side.
  // Receipt prints immediately; if the edge function fails, invoice_status stays
  // 'pending' and can be retried from the InvoiceList page.
  supabase.functions.invoke('complete-order', { body: { paymentId: payment.id } })
    .catch(() => {})

  return { data: payment }
}

export async function getLastPayment(orderId) {
  return supabase
    .from('pos_payments')
    .select('id, amount, payment_method, carrier_type, carrier_number, invoice_number, invoice_status, paid_at')
    .eq('order_id', orderId)
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle()
}

// Moves all items from sourceOrderId → targetOrderId, voids the source order
export async function mergeOrders(sourceOrderId, targetOrderId) {
  const { error } = await supabase
    .from('pos_order_items')
    .update({ order_id: targetOrderId })
    .eq('order_id', sourceOrderId)

  if (error) return { error }

  await supabase.from('pos_orders').update({ status: 'voided' }).eq('id', sourceOrderId)

  await supabase
    .from('qr_order_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('order_id', sourceOrderId)
    .is('revoked_at', null)

  return { error: null }
}

export async function createQrSession(storeId, orgId, tableId, orderId) {
  return supabase
    .from('qr_order_sessions')
    .insert({ organization_id: orgId, store_id: storeId, table_id: tableId, order_id: orderId })
    .select('id, token, expires_at')
    .single()
}

export async function getOpenOrders(storeId) {
  return supabase
    .from('pos_orders')
    .select('id, order_number, table_id, res_tables(table_number)')
    .eq('store_id', storeId)
    .in('status', ['open', 'submitted'])
    .order('opened_at')
}
