// Booking Links (Calendly-style) — client service.
//
// Public page reads use the anon-visible RLS policy on booking_pages
// (is_active = true only). Booking writes go through the SECURITY DEFINER
// RPC create_booking_appointment — external bookers are unauthenticated,
// so there is no direct INSERT path.
import { supabase } from '../supabase'

/** Fetch one active booking page by slug (public, anon-safe). */
export async function getBookingPage(slug) {
  const { data, error } = await supabase
    .from('booking_pages')
    .select('id, slug, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, advance_notice_hours, booking_window_days, location_type, questions, confirmation_message, allow_cancellation, allow_reschedule')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Book a slot on a public page (anon-safe RPC).
 * startAt: ISO-8601 string, e.g. '2026-07-10T09:00:00+07:00'
 * Returns the new appointment id (uuid).
 */
export async function bookSlot({ slug, startAt, bookerName, bookerEmail, bookerPhone, answers }) {
  const { data, error } = await supabase.rpc('create_booking_appointment', {
    p_slug: slug,
    p_start_at: startAt,
    p_booker_name: bookerName,
    p_booker_email: bookerEmail,
    p_booker_phone: bookerPhone ?? null,
    p_answers: answers ?? {},
  })
  if (error) throw error
  return data
}

/** List booking pages owned by the signed-in employee (management UI). */
export async function listMyPages(employeeId) {
  const { data, error } = await supabase
    .from('booking_pages')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Create or update a booking page (management UI). */
export async function savePage(page) {
  const { data, error } = await supabase
    .from('booking_pages')
    .upsert(page)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Compute available slots for a page on a given date.
 * Placeholder until Phase 9: real availability merges working hours
 * (hr.attendance schedule), existing calendar_events, public.holidays,
 * buffers, and the max_bookings_per_day cap — computed in the
 * comms-booking edge function so external bookers never see raw calendars.
 */
export async function getAvailableSlots(_slug, _dateISO) {
  return []
}
