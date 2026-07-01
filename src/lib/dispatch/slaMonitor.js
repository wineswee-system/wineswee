import { supabase } from '../supabase'

const AT_RISK_WINDOW_MS = 2 * 60 * 60 * 1000 // 2 hours before deadline

export async function checkSLADeadlines(bus) {
  const now = new Date()
  const atRiskCutoff = new Date(now.getTime() + AT_RISK_WINDOW_MS)

  const { data: jobs } = await supabase
    .from('dispatch_jobs')
    .select('id, job_number, sla_deadline, sla_status, org_id')
    .not('status', 'in', '("delivered","closed","cancelled")')
    .not('sla_deadline', 'is', null)
    .not('sla_status', 'eq', 'breached')

  if (!jobs?.length) return { checked: 0, atRisk: 0, breached: 0 }

  let atRisk = 0, breached = 0

  for (const job of jobs) {
    const deadline = new Date(job.sla_deadline)

    if (deadline <= now) {
      breached++
      await supabase.from('dispatch_jobs')
        .update({ sla_status: 'breached', updated_at: now.toISOString() })
        .eq('id', job.id)
      if (bus) bus.publish('dispatch.sla.breached', {
        job_id: job.id, job_number: job.job_number,
        sla_deadline: job.sla_deadline, breached_at: now.toISOString(),
      }).catch(() => {})
    } else if (deadline <= atRiskCutoff && job.sla_status === 'on_track') {
      atRisk++
      await supabase.from('dispatch_jobs')
        .update({ sla_status: 'at_risk', updated_at: now.toISOString() })
        .eq('id', job.id)
      if (bus) bus.publish('dispatch.sla.at_risk', {
        job_id: job.id, job_number: job.job_number,
        sla_deadline: job.sla_deadline,
      }).catch(() => {})
    }
  }

  return { checked: jobs.length, atRisk, breached }
}

export async function getSLASummary(orgId) {
  const { data } = await supabase
    .from('dispatch_jobs')
    .select('sla_status')
    .eq('org_id', orgId)
    .not('status', 'in', '("delivered","closed")')

  if (!data) return { on_track: 0, at_risk: 0, breached: 0 }
  return {
    on_track: data.filter(j => j.sla_status === 'on_track').length,
    at_risk: data.filter(j => j.sla_status === 'at_risk').length,
    breached: data.filter(j => j.sla_status === 'breached').length,
  }
}
