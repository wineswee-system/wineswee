import { appendTrackingEvent, updateDispatchJob } from '../db/dispatch'

const CARRIER_STATUS_MAP = {
  tcat: { '10': 'picked_up', '20': 'in_transit', '30': 'out_for_delivery', '40': 'delivered', '50': 'failed', '60': 'exception' },
  xinzhu: { 'A': 'picked_up', 'B': 'in_transit', 'C': 'out_for_delivery', 'D': 'delivered', 'E': 'failed', 'F': 'exception' },
  sfexpress: { '50': 'picked_up', '70': 'in_transit', '80': 'out_for_delivery', '90': 'delivered', '91': 'failed', '99': 'exception' },
  cvs: { '1': 'picked_up', '2': 'in_transit', '3': 'delivered', '4': 'failed' },
  post: { '1': 'picked_up', '2': 'in_transit', '3': 'out_for_delivery', '4': 'delivered', '5': 'failed' },
  own_fleet: { 'departed': 'picked_up', 'in_transit': 'in_transit', 'arrived': 'out_for_delivery', 'delivered': 'delivered', 'failed': 'failed' },
}

const STATUS_TO_JOB = {
  picked_up: 'picked_up', in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery', delivered: 'delivered',
  failed: 'failed', exception: 'exception',
}

const STATUS_LABELS = {
  picked_up: '貨物已攬收', in_transit: '運送中', out_for_delivery: '派送中',
  delivered: '已簽收', failed: '派送失敗', exception: '異常',
}

export async function processCarrierUpdate({ jobId, shipmentId, carrierType, rawCode, location, lat, lng, actor = 'carrier_webhook' }) {
  const eventCode = (CARRIER_STATUS_MAP[carrierType] ?? {})[rawCode] ?? 'unknown'
  const description = STATUS_LABELS[eventCode] ?? rawCode

  await appendTrackingEvent({ job_id: jobId, shipment_id: shipmentId, event_code: eventCode, carrier_raw_code: rawCode, description, location: location ?? null, lat: lat ?? null, lng: lng ?? null, actor })

  const newStatus = STATUS_TO_JOB[eventCode]
  if (newStatus) {
    const now = new Date().toISOString()
    await updateDispatchJob(jobId, {
      status: newStatus,
      ...(newStatus === 'delivered' ? { delivered_at: now } : {}),
      ...(newStatus === 'picked_up' ? { picked_up_at: now } : {}),
    })
  }

  return { eventCode, description }
}

export async function appendManualUpdate({ jobId, shipmentId, eventCode, description, actorId }) {
  await appendTrackingEvent({
    job_id: jobId, shipment_id: shipmentId, event_code: eventCode,
    description: description ?? STATUS_LABELS[eventCode] ?? eventCode,
    actor: 'manual', actor_id: actorId ?? null,
  })
  const newStatus = STATUS_TO_JOB[eventCode]
  if (newStatus) await updateDispatchJob(jobId, { status: newStatus })
}
