import { supabase } from '../../supabase.js'

/**
 * Query persisted business events for replay or audit.
 * @param {object} filters
 * @param {string} [filters.domain] - filter by domain (e.g. 'wms')
 * @param {string} [filters.type] - filter by event type (e.g. 'wms.shipment.completed')
 * @param {string} [filters.since] - ISO timestamp lower bound
 * @param {string} [filters.until] - ISO timestamp upper bound
 * @param {string} [filters.correlationId] - trace a business process
 * @param {number} [filters.limit] - max results (default 100)
 * @returns {Promise<{data: Array, error: object|null}>}
 */
export async function queryEvents({ domain, type, since, until, correlationId, limit = 100 } = {}) {
  let query = supabase
    .from('business_events')
    .select('*')
    .order('timestamp', { ascending: true })
    .limit(limit)

  if (domain) query = query.eq('domain', domain)
  if (type) query = query.eq('event_type', type)
  if (since) query = query.gte('timestamp', since)
  if (until) query = query.lte('timestamp', until)
  if (correlationId) query = query.eq('metadata->>correlation_id', correlationId)

  const { data, error } = await query
  return { data: data || [], error }
}

/**
 * Replay persisted events through the bus.
 * Useful for rebuilding state or debugging event chains.
 * @param {import('../EventBus.js').EventBus} bus
 * @param {object} filters - same as queryEvents
 * @returns {Promise<number>} number of events replayed
 */
export async function replayEvents(bus, filters) {
  const { data } = await queryEvents(filters)
  for (const record of data) {
    await bus.publish(record.event_type, record.payload, {
      ...record.metadata,
      _replay: true,
      _original_id: record.event_id,
    })
  }
  return data.length
}
