import { createWmsPickList, updateWmsPickList } from '../db/dispatch'
import { supabase } from '../supabase'

export function generateListNumber() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `PL-${d}-${Math.floor(100 + Math.random() * 900)}`
}

export async function generatePickListFromJobs(orgId, dispatchJobs, bus) {
  const batchId = `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`
  const items = []

  for (const job of dispatchJobs) {
    if (!job.shipment_id) continue
    const { data: shipment } = await supabase.from('shipments').select('items').eq('id', job.shipment_id).single()
    const shipItems = Array.isArray(shipment?.items) ? shipment.items : []
    for (const item of shipItems) {
      items.push({
        sku_id: item.sku_id, sku_code: item.sku_code ?? item.code,
        name: item.name, qty_required: item.qty ?? item.quantity ?? 1,
        qty_picked: 0, location: item.location ?? null,
        job_id: job.id, job_number: job.job_number,
      })
    }
  }

  if (!items.length) return null

  const { data: list } = await createWmsPickList({
    org_id: orgId, list_number: generateListNumber(),
    dispatch_batch_id: batchId, items,
  })

  if (list && bus) {
    bus.publish('wms.picklist.created', {
      list_id: list.id, list_number: list.list_number,
      org_id: orgId, item_count: items.length,
    }).catch(() => {})
  }

  return list
}

export async function assignPicker(listId, pickerId) {
  return updateWmsPickList(listId, { picker_id: pickerId, status: 'in_progress' })
}

export async function updateItemPicked(listId, skuCode, qtyPicked) {
  const { data: list } = await supabase.from('wms_pick_lists').select('items').eq('id', listId).single()
  if (!list) return null

  const updatedItems = (list.items ?? []).map(i =>
    i.sku_code === skuCode ? { ...i, qty_picked: qtyPicked } : i
  )
  const allDone = updatedItems.every(i => i.qty_picked >= i.qty_required)
  const anyShort = updatedItems.some(i => i.qty_picked < i.qty_required)

  return updateWmsPickList(listId, {
    items: updatedItems,
    status: allDone ? 'completed' : anyShort ? 'short_picked' : 'in_progress',
    ...(allDone ? { completed_at: new Date().toISOString() } : {}),
  })
}
