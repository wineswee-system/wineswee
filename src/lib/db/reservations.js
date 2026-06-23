import { supabase } from '../supabase'

// ─── Reservations ─────────────────────────────────────────────

export const getReservations = (storeId, date) => {
  let q = supabase
    .from('reservations')
    .select('*, res_tables(table_number, capacity)')
    .order('slot_time', { ascending: true })
  if (storeId) q = q.eq('store_id', storeId)
  if (date)    q = q.eq('reserved_date', date)
  return q
}

export const getReservationsByDateRange = (storeId, from, to) =>
  supabase
    .from('reservations')
    .select('*, res_tables(table_number, capacity)')
    .eq('store_id', storeId)
    .gte('reserved_date', from)
    .lte('reserved_date', to)
    .order('reserved_date', { ascending: true })
    .order('slot_time', { ascending: true })

export const getReservationByCode = (code) =>
  supabase.from('reservations').select('*').eq('confirmation_code', code).single()

export const createReservation = (data) =>
  supabase.from('reservations').insert(data).select().single()

export const updateReservation = (id, data) =>
  supabase
    .from('reservations')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

export const updateReservationStatus = (id, status) => {
  const extra = {}
  if (status === 'confirmed') extra.confirmed_at = new Date().toISOString()
  if (status === 'seated')    extra.seated_at    = new Date().toISOString()
  if (status === 'completed') extra.completed_at = new Date().toISOString()
  return supabase
    .from('reservations')
    .update({ status, ...extra, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
}

export const checkInReservation = (id) =>
  supabase
    .from('reservations')
    .update({
      status: 'seated',
      checked_in_at: new Date().toISOString(),
      seated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

export const extendReservation = (id, currentExtended) =>
  supabase
    .from('reservations')
    .update({ extended_hours: currentExtended + 1, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

export const moveReservationTable = (id, newTableId, oldTableId) =>
  supabase
    .from('reservations')
    .update({ table_id: newTableId, original_table_id: oldTableId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

export const assignTable = (id, tableId) =>
  supabase
    .from('reservations')
    .update({ table_id: tableId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

export const getAvailableSlots = (storeId, date, partySize, durationHours) =>
  supabase.rpc('get_available_slots', {
    p_store_id: storeId, p_date: date,
    p_party_size: partySize, p_duration_hours: durationHours,
  })

// ─── Reservation Rules ─────────────────────────────────────────

export const getReservationRules = (storeId) =>
  supabase
    .from('reservation_rules')
    .select('*')
    .eq('store_id', storeId)
    .order('day_of_week', { ascending: true, nullsFirst: true })

export const upsertReservationRule = (data) =>
  supabase
    .from('reservation_rules')
    .upsert({ ...data, updated_at: new Date().toISOString() })
    .select()
    .single()

export const deleteReservationRule = (id) =>
  supabase.from('reservation_rules').delete().eq('id', id)

// ─── Restaurant Tables ─────────────────────────────────────────

export const getResTables = (storeId) =>
  supabase
    .from('res_tables')
    .select('*')
    .eq('store_id', storeId)
    .order('table_number', { ascending: true })

export const createResTable = (data) =>
  supabase.from('res_tables').insert(data).select().single()

export const updateResTable = (id, data) =>
  supabase.from('res_tables').update(data).eq('id', id).select().single()

export const deleteResTable = (id) =>
  supabase.from('res_tables').delete().eq('id', id)

// ─── Table Combinations ────────────────────────────────────────

export const getTableCombinations = (storeId) =>
  supabase
    .from('table_combinations')
    .select('*')
    .eq('store_id', storeId)
    .order('name', { ascending: true })

export const createTableCombination = (data) =>
  supabase.from('table_combinations').insert(data).select().single()

export const updateTableCombination = (id, data) =>
  supabase.from('table_combinations').update(data).eq('id', id).select().single()

export const deleteTableCombination = (id) =>
  supabase.from('table_combinations').delete().eq('id', id)
