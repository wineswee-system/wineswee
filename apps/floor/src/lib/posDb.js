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
    .select('id, status, order_number, guest_count, note, opened_at')
    .eq('store_id', storeId)
    .eq('table_id', tableId)
    .in('status', ['open', 'submitted'])
    .maybeSingle()

  if (existing) return { data: existing, error: null }

  return supabase
    .from('pos_orders')
    .insert({
      organization_id: orgId,
      store_id: storeId,
      table_id: tableId,
      opened_by: employeeId,
      status: 'open',
    })
    .select('id, status, order_number, guest_count, note, opened_at')
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
