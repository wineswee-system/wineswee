import { supabase } from '../supabase'

// ── Dispatch Jobs ─────────────────────────────────────────────────────────────
export const getDispatchJobs = (orgId, filters = {}) => {
  let q = supabase.from('dispatch_jobs')
    .select('*, carrier_configs(name), dispatch_routes(route_number)')
    .order('created_at', { ascending: false })
  if (orgId) q = q.eq('org_id', orgId)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.priority) q = q.eq('priority', filters.priority)
  if (filters.date) q = q.gte('created_at', filters.date + 'T00:00:00').lte('created_at', filters.date + 'T23:59:59')
  return q
}

export const getDispatchJob = (id) =>
  supabase.from('dispatch_jobs')
    .select('*, carrier_configs(*), dispatch_routes(*), dispatch_driver_profiles(*, employees(name))')
    .eq('id', id).single()

export const createDispatchJob = (data) =>
  supabase.from('dispatch_jobs').insert(data).select().single()

export const updateDispatchJob = (id, data) =>
  supabase.from('dispatch_jobs')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()

export const batchUpdateDispatchJobs = (ids, data) =>
  supabase.from('dispatch_jobs')
    .update({ ...data, updated_at: new Date().toISOString() })
    .in('id', ids).select()

// ── Tracking Events ───────────────────────────────────────────────────────────
export const getTrackingEvents = (jobId) =>
  supabase.from('dispatch_tracking_events').select('*')
    .eq('job_id', jobId).order('created_at', { ascending: true })

export const getTrackingByNumber = (trackingNumber) =>
  supabase.from('dispatch_jobs')
    .select('*, dispatch_tracking_events(*)')
    .eq('tracking_number', trackingNumber).single()

export const appendTrackingEvent = (data) =>
  supabase.from('dispatch_tracking_events').insert(data).select().single()

// ── Routes ────────────────────────────────────────────────────────────────────
export const getDispatchRoutes = (orgId, date) => {
  let q = supabase.from('dispatch_routes')
    .select('*, dispatch_driver_profiles(*, employees(name)), dispatch_vehicles(*)')
    .order('date', { ascending: false })
  if (orgId) q = q.eq('org_id', orgId)
  if (date) q = q.eq('date', date)
  return q
}

export const getDispatchRoute = (id) =>
  supabase.from('dispatch_routes')
    .select('*, dispatch_driver_profiles(*, employees(name)), dispatch_vehicles(*), dispatch_jobs(*)')
    .eq('id', id).single()

export const createDispatchRoute = (data) =>
  supabase.from('dispatch_routes').insert(data).select().single()

export const updateDispatchRoute = (id, data) =>
  supabase.from('dispatch_routes')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()

// ── Driver Locations ──────────────────────────────────────────────────────────
export const recordDriverLocation = (data) =>
  supabase.from('dispatch_driver_locations').insert(data)

export const getLatestDriverLocations = (routeId) =>
  supabase.from('dispatch_driver_locations').select('*')
    .eq('route_id', routeId).order('recorded_at', { ascending: false }).limit(1)

// ── Schedules ─────────────────────────────────────────────────────────────────
export const getDispatchSchedules = (orgId, date) => {
  let q = supabase.from('dispatch_schedules').select('*, carrier_configs(name)').order('date', { ascending: false })
  if (orgId) q = q.eq('org_id', orgId)
  if (date) q = q.eq('date', date)
  return q
}

export const createDispatchSchedule = (data) =>
  supabase.from('dispatch_schedules').insert(data).select().single()

export const updateDispatchSchedule = (id, data) =>
  supabase.from('dispatch_schedules').update(data).eq('id', id).select().single()

// ── Carriers ──────────────────────────────────────────────────────────────────
export const getCarriers = (orgId) => {
  let q = supabase.from('carrier_configs').select('*').order('name')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const updateCarrier = (id, data) =>
  supabase.from('carrier_configs').update(data).eq('id', id).select().single()

// ── Routing Rules ─────────────────────────────────────────────────────────────
export const getRoutingRules = (orgId) =>
  supabase.from('dispatch_routing_rules').select('*')
    .eq('org_id', orgId).eq('is_active', true)
    .order('priority', { ascending: false })

export const createRoutingRule = (data) =>
  supabase.from('dispatch_routing_rules').insert(data).select().single()

export const updateRoutingRule = (id, data) =>
  supabase.from('dispatch_routing_rules').update(data).eq('id', id).select().single()

export const deleteRoutingRule = (id) =>
  supabase.from('dispatch_routing_rules').delete().eq('id', id)

// ── Vehicles ──────────────────────────────────────────────────────────────────
export const getVehicles = (orgId) =>
  supabase.from('dispatch_vehicles').select('*').eq('org_id', orgId).order('plate_number')

export const createVehicle = (data) =>
  supabase.from('dispatch_vehicles').insert(data).select().single()

export const updateVehicle = (id, data) =>
  supabase.from('dispatch_vehicles').update(data).eq('id', id).select().single()

// ── Drivers ───────────────────────────────────────────────────────────────────
export const getDriverProfiles = () =>
  supabase.from('dispatch_driver_profiles')
    .select('*, employees(name, phone), dispatch_vehicles(plate_number, type)')
    .eq('is_active', true)

export const createDriverProfile = (data) =>
  supabase.from('dispatch_driver_profiles').insert(data).select().single()

export const updateDriverProfile = (id, data) =>
  supabase.from('dispatch_driver_profiles').update(data).eq('id', id).select().single()

export const getDriverAvailability = (driverId, dateFrom, dateTo) => {
  let q = supabase.from('dispatch_driver_availability').select('*').eq('driver_id', driverId)
  if (dateFrom) q = q.gte('date', dateFrom)
  if (dateTo) q = q.lte('date', dateTo)
  return q.order('date')
}

export const upsertDriverAvailability = (data) =>
  supabase.from('dispatch_driver_availability')
    .upsert(data, { onConflict: 'driver_id,date' }).select().single()

// ── Proof of Delivery ─────────────────────────────────────────────────────────
export const getProofOfDelivery = (jobId) =>
  supabase.from('dispatch_proof_of_delivery').select('*').eq('job_id', jobId).single()

export const createProofOfDelivery = (data) =>
  supabase.from('dispatch_proof_of_delivery').insert(data).select().single()

// ── WMS: Pick Lists ───────────────────────────────────────────────────────────
export const getWmsPickLists = (orgId, status) => {
  let q = supabase.from('wms_pick_lists').select('*, employees(name)').order('created_at', { ascending: false })
  if (orgId) q = q.eq('org_id', orgId)
  if (status) q = q.eq('status', status)
  return q
}

export const createWmsPickList = (data) =>
  supabase.from('wms_pick_lists').insert(data).select().single()

export const updateWmsPickList = (id, data) =>
  supabase.from('wms_pick_lists').update(data).eq('id', id).select().single()

// ── WMS: Pack Records ─────────────────────────────────────────────────────────
export const getPackRecord = (jobId) =>
  supabase.from('wms_pack_records')
    .select('*, employees(name), wms_pick_lists(list_number)')
    .eq('job_id', jobId).single()

export const createPackRecord = (data) =>
  supabase.from('wms_pack_records').insert(data).select().single()

// ── WMS: Dock Handoffs ────────────────────────────────────────────────────────
export const getDockHandoffs = (date) => {
  let q = supabase.from('wms_dock_handoffs')
    .select('*, carrier_configs(name), dispatch_schedules(date, dock_door)')
    .order('handoff_at', { ascending: false })
  if (date) q = q.gte('handoff_at', date + 'T00:00:00').lte('handoff_at', date + 'T23:59:59')
  return q
}

export const createDockHandoff = (data) =>
  supabase.from('wms_dock_handoffs').insert(data).select().single()

export const updateDockHandoff = (id, data) =>
  supabase.from('wms_dock_handoffs').update(data).eq('id', id).select().single()

// ── Analytics ─────────────────────────────────────────────────────────────────
export const getDispatchKPIs = async (orgId, dateFrom, dateTo) => {
  const { data } = await supabase.from('dispatch_jobs')
    .select('status, sla_status, delivered_at, picked_up_at, failed_attempts')
    .eq('org_id', orgId)
    .gte('created_at', dateFrom).lte('created_at', dateTo)

  if (!data) return null
  const total = data.length
  const delivered = data.filter(j => j.status === 'delivered').length
  const onTime = data.filter(j => j.status === 'delivered' && j.sla_status !== 'breached').length
  const firstAttempt = data.filter(j => j.status === 'delivered' && j.failed_attempts === 0).length
  const exceptions = data.filter(j => j.status === 'exception').length

  const transitTimes = data
    .filter(j => j.delivered_at && j.picked_up_at)
    .map(j => (new Date(j.delivered_at) - new Date(j.picked_up_at)) / 3600000)
  const avgTransitHours = transitTimes.length
    ? transitTimes.reduce((a, b) => a + b, 0) / transitTimes.length : 0

  return {
    total, delivered,
    otdRate: delivered > 0 ? Math.round((onTime / delivered) * 100) : 0,
    firstAttemptRate: delivered > 0 ? Math.round((firstAttempt / delivered) * 100) : 0,
    avgTransitHours: Math.round(avgTransitHours * 10) / 10,
    exceptionRate: total > 0 ? Math.round((exceptions / total) * 100) : 0,
  }
}
