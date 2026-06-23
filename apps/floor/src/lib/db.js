import { supabase } from './supabase'

const ts = () => new Date().toISOString()

const logChange = (reservationId, employeeId, action, changes) =>
  supabase.from('reservation_changelogs').insert({
    reservation_id: reservationId,
    employee_id: employeeId ?? null,
    action,
    changes: changes ?? null,
  })

export const getStores = () =>
  supabase.from('stores').select('id, name').eq('is_active', true).order('name')

export const getReservations = (storeId, date) =>
  supabase
    .from('reservations')
    .select('*, res_tables(table_number, capacity, shape, x_pos, y_pos)')
    .eq('store_id', storeId)
    .eq('reservation_date', date)
    .order('reservation_time')

export const getResTables = (storeId) =>
  supabase
    .from('res_tables')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('table_number')

export const getChangelogs = (reservationId) =>
  supabase
    .from('reservation_changelogs')
    .select('*, employees(name)')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false })
    .limit(20)

export const updateReservationStatus = async (id, status, employeeId) => {
  const res = await supabase.from('reservations')
    .update({ status, updated_at: ts() }).eq('id', id)
  await logChange(id, employeeId, 'status_changed', { status })
  return res
}

export const checkInReservation = async (id, employeeId) => {
  const now = ts()
  const res = await supabase.from('reservations').update({
    status: 'seated',
    checked_in_at: now,
    seated_at: now,
    updated_at: now,
  }).eq('id', id)
  await logChange(id, employeeId, 'checked_in', null)
  return res
}

export const extendReservation = async (id, currentExtended, employeeId) => {
  const res = await supabase.from('reservations').update({
    extended_hours: currentExtended + 1,
    updated_at: ts(),
  }).eq('id', id)
  await logChange(id, employeeId, 'extended', { extended_hours: currentExtended + 1 })
  return res
}

export const moveReservationTable = async (id, newTableId, oldTableId, employeeId) => {
  const res = await supabase.from('reservations').update({
    table_id: newTableId,
    original_table_id: oldTableId,
    updated_at: ts(),
  }).eq('id', id)
  await logChange(id, employeeId, 'table_moved', { from: oldTableId, to: newTableId })
  return res
}

export const createReservation = async (data, employeeId) => {
  const res = await supabase.from('reservations')
    .insert({ ...data, created_by: employeeId ?? null })
    .select().single()
  if (res.data?.id) {
    await logChange(res.data.id, employeeId, 'created', {
      source: data.source ?? 'walk_in',
      guest_name: data.guest_name,
    })
  }
  return res
}

export const updateReservation = async (id, data, employeeId) => {
  const res = await supabase.from('reservations')
    .update({ ...data, updated_at: ts() }).eq('id', id)
  await logChange(id, employeeId, 'updated', data)
  return res
}

export const deleteReservation = async (id, employeeId) => {
  await logChange(id, employeeId, 'deleted', null)
  return supabase.from('reservations').delete().eq('id', id)
}

export const getAvailableSlots = (storeId, date, partySize, durationHours) =>
  supabase.rpc('get_available_slots', {
    p_store_id: storeId,
    p_date: date,
    p_party_size: partySize,
    p_duration_hours: durationHours,
  })
