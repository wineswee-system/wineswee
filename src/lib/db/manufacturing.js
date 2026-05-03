import { supabase } from '../supabase'

export const getBOMs = () =>
  supabase.from('bom').select('*').order('id')

export const createBOM = (data) =>
  supabase.from('bom').insert(data).select().single()

export const updateBOM = (id, data) =>
  supabase.from('bom').update(data).eq('id', id).select().single()

export const getBOMLines = (bomId) =>
  supabase.from('bom_lines').select('*, skus(id, code, name, unit, cost)').eq('bom_id', bomId).order('id')

export const createBOMLine = (data) =>
  supabase.from('bom_lines').insert(data).select().single()

export const updateBOMLine = (id, data) =>
  supabase.from('bom_lines').update(data).eq('id', id).select().single()

export const deleteBOMLine = (id) =>
  supabase.from('bom_lines').delete().eq('id', id)

export const getMRPResults = () =>
  supabase.from('mrp_results').select('*').order('id', { ascending: false })

export const createMRPResult = (data) =>
  supabase.from('mrp_results').insert(data).select().single()

export const saveMRPResults = (results) =>
  supabase.from('mrp_results').insert(results).select()

export const getQualityInspections = () =>
  supabase.from('quality_inspections').select('*').order('id', { ascending: false })

export const createQualityInspection = (data) =>
  supabase.from('quality_inspections').insert(data).select().single()

export const getManufacturingOrders = () =>
  supabase.from('manufacturing_orders').select('*').order('id', { ascending: false })

export const createManufacturingOrder = (data) =>
  supabase.from('manufacturing_orders').insert(data).select().single()

export const updateManufacturingOrder = (id, data) =>
  supabase.from('manufacturing_orders').update(data).eq('id', id).select().single()

export const getInventoryLots = () =>
  supabase.from('inventory_lots').select('*').order('id', { ascending: false })

export const getStockCounts = () =>
  supabase.from('stock_counts').select('*').order('id', { ascending: false })

export const createStockCount = (data) =>
  supabase.from('stock_counts').insert(data).select().single()

export const getWorkCenters = () =>
  supabase.from('work_centers').select('*').order('code')

export const createWorkCenter = (data) =>
  supabase.from('work_centers').insert(data).select().single()

export const updateWorkCenter = (id, data) =>
  supabase.from('work_centers').update(data).eq('id', id).select().single()

export const deleteWorkCenter = (id) =>
  supabase.from('work_centers').delete().eq('id', id)

export const getRoutings = (bomId) => {
  const q = supabase.from('routings').select('*, work_centers(code, name)').order('step_number')
  return bomId ? q.eq('bom_id', bomId) : q
}

export const createRouting = (data) =>
  supabase.from('routings').insert(data).select().single()

export const updateRouting = (id, data) =>
  supabase.from('routings').update(data).eq('id', id).select().single()

export const deleteRouting = (id) =>
  supabase.from('routings').delete().eq('id', id)
