import { supabase } from '../supabase'

export const getSKUs = () =>
  supabase.from('skus').select('*').order('id')

export const updateSKU = (id, data) =>
  supabase.from('skus').update(data).eq('id', id).select().single()

export const createInventoryAdjustment = (data) =>
  supabase.rpc('secure_create_inventory_adjustment', {
    p_sku_code: data.sku_code,
    p_sku_name: data.sku_name ?? null,
    p_bin_code: data.bin_code ?? null,
    p_quantity: data.quantity,
    p_reason: data.reason,
    p_operator: data.operator,
    p_unit_cost: data.unit_cost ?? 0,
  })

export const getInventoryAdjustments = (orgId, options = {}) => {
  let q = supabase.from('inventory_adjustments').select('*').order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q.limit(options.limit ?? 50)
}

export const getWarehouses = (orgId) => {
  let q = supabase.from('warehouses').select('*').order('code')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createWarehouse = (data) =>
  supabase.from('warehouses').insert(data).select().single()

export const updateWarehouse = (id, data) =>
  supabase.from('warehouses').update(data).eq('id', id).select().single()

export const deleteWarehouse = (id) =>
  supabase.from('warehouses').delete().eq('id', id)

export const getWarehouseZones = (warehouseId) => {
  const q = supabase.from('warehouse_zones').select('*').order('code')
  return warehouseId ? q.eq('warehouse_id', warehouseId) : q
}

export const createWarehouseZone = (data) =>
  supabase.from('warehouse_zones').insert(data).select().single()

export const deleteWarehouseZone = (id) =>
  supabase.from('warehouse_zones').delete().eq('id', id)

export const getWarehouseBins = (zoneId) => {
  const q = supabase.from('warehouse_bins').select('*').order('code')
  return zoneId ? q.eq('zone_id', zoneId) : q
}

export const createWarehouseBin = (data) =>
  supabase.from('warehouse_bins').insert(data).select().single()

export const updateWarehouseBin = (id, data) =>
  supabase.from('warehouse_bins').update(data).eq('id', id).select().single()

export const deleteWarehouseBin = (id) =>
  supabase.from('warehouse_bins').delete().eq('id', id)

export const getWarehouseTransfers = () =>
  supabase.from('warehouse_transfers').select('*').order('id', { ascending: false })

export const createWarehouseTransfer = (data) =>
  supabase.from('warehouse_transfers').insert(data).select().single()

export const updateWarehouseTransfer = (id, data) =>
  supabase.from('warehouse_transfers').update(data).eq('id', id).select().single()

export const getInboundOrders = (orgId) => {
  let q = supabase.from('inbound_orders').select('*').order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getInboundItems = (orderId) =>
  supabase.from('inbound_items').select('*').eq('inbound_order_id', orderId)

export const getOutboundOrders = (orgId) => {
  let q = supabase.from('outbound_orders').select('*').order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getOutboundItems = (orderId) =>
  supabase.from('outbound_items').select('*').eq('outbound_order_id', orderId)

export const getPickLists = () =>
  supabase.from('pick_lists').select('*').order('created_at', { ascending: false })

export const createPickList = (data) =>
  supabase.from('pick_lists').insert(data).select().single()

export const updatePickList = (id, data) =>
  supabase.from('pick_lists').update(data).eq('id', id).select().single()

export const getPackLists = () =>
  supabase.from('pack_lists').select('*, pick_lists(pick_number)').order('created_at', { ascending: false })

export const createPackList = (data) =>
  supabase.from('pack_lists').insert(data).select().single()

export const updatePackList = (id, data) =>
  supabase.from('pack_lists').update(data).eq('id', id).select().single()
