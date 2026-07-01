import { createPackRecord, updateDispatchJob } from '../db/dispatch'

export async function completePack({ jobId, pickListId, packerId, boxCount, totalWeightKg, dimensions, bus }) {
  const { data: pack } = await createPackRecord({
    job_id: jobId,
    pick_list_id: pickListId ?? null,
    packer_id: packerId ?? null,
    box_count: boxCount ?? 1,
    total_weight_kg: totalWeightKg ?? null,
    dimensions: dimensions ?? {},
    packed_at: new Date().toISOString(),
  })

  if (pack) {
    await updateDispatchJob(jobId, { status: 'label_printed' })
    if (bus) bus.publish('wms.pack.completed', {
      job_id: jobId, pack_record_id: pack.id, box_count: boxCount ?? 1,
    }).catch(() => {})
  }

  return pack
}
