import { createDockHandoff, updateDockHandoff, batchUpdateDispatchJobs } from '../db/dispatch'

export async function executeHandoff({ scheduleId, carrierId, jobs, carrierAgentName, bus }) {
  const now = new Date().toISOString()
  const parcels = jobs.map(j => ({ job_id: j.id, job_number: j.job_number, tracking_number: j.tracking_number }))

  const { data: handoff } = await createDockHandoff({
    schedule_id: scheduleId ?? null,
    carrier_id: carrierId ?? null,
    parcels,
    carrier_agent_name: carrierAgentName ?? null,
    handoff_at: now,
    carrier_sign_off: false,
  })

  if (handoff) {
    await batchUpdateDispatchJobs(jobs.map(j => j.id), { status: 'picked_up', picked_up_at: now })
    if (bus) bus.publish('wms.dock.handoff', {
      handoff_id: handoff.id, carrier_id: carrierId, parcel_count: jobs.length,
    }).catch(() => {})
  }

  return handoff
}

export async function signOffHandoff(handoffId) {
  return updateDockHandoff(handoffId, { carrier_sign_off: true })
}
