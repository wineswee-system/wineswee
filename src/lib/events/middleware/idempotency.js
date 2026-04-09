/**
 * Middleware: Idempotent event processing.
 *
 * Kafka delivers at-least-once, so the same event may arrive multiple times.
 * This middleware deduplicates by event ID using an in-memory LRU cache
 * (fast path) backed by a Supabase lookup (durable path).
 *
 * When migrating to Kafka, this middleware prevents duplicate side effects
 * from redelivered messages or consumer group rebalances.
 */

const CACHE_MAX_SIZE = 10000
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// In-memory LRU cache for fast dedup
const _processedEvents = new Map()

export async function idempotencyMiddleware(event, next) {
  // Skip replay events — they are intentionally reprocessed
  if (event.metadata._replay) {
    return next()
  }

  const eventId = event.id
  const now = Date.now()

  // Fast path: check in-memory cache
  if (_processedEvents.has(eventId)) {
    const cachedAt = _processedEvents.get(eventId)
    if (now - cachedAt < CACHE_TTL_MS) {
      console.debug(`[Idempotency] Skipping duplicate event: ${eventId}`)
      return // Don't call next() — skip handlers
    }
    _processedEvents.delete(eventId) // Expired, reprocess
  }

  // Durable path: check business_events table
  // (In Kafka mode, this catches duplicates across process restarts)
  try {
    const { supabase } = await import('../../supabase.js')
    const { data } = await supabase
      .from('business_events')
      .select('event_id')
      .eq('event_id', eventId)
      .maybeSingle()

    if (data) {
      console.debug(`[Idempotency] Skipping already-persisted event: ${eventId}`)
      _processedEvents.set(eventId, now)
      return // Already processed
    }
  } catch {
    // If DB check fails, proceed (at-least-once is safer than at-most-once)
  }

  // Mark as processed before running handlers
  _processedEvents.set(eventId, now)

  // Evict oldest entries if cache is full
  if (_processedEvents.size > CACHE_MAX_SIZE) {
    const keysToDelete = []
    for (const [key, timestamp] of _processedEvents) {
      if (now - timestamp > CACHE_TTL_MS || keysToDelete.length < _processedEvents.size - CACHE_MAX_SIZE) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach(k => _processedEvents.delete(k))
  }

  return next()
}

/** Clear the cache (for testing) */
export function clearIdempotencyCache() {
  _processedEvents.clear()
}
