/**
 * Middleware: Idempotent event processing.
 *
 * Kafka delivers at-least-once, so the same event may arrive multiple times.
 * This middleware deduplicates by event ID using an in-memory cache.
 *
 * NOTE: today event IDs are randomly generated per publish (EventBus builds a
 * fresh `evt_...` id every time), so the cache never produces a hit in the
 * current in-memory setup. It is kept because it becomes effective once a
 * transport with STABLE envelope IDs exists — e.g. Kafka redelivery or
 * consumer-group rebalances re-deliver the SAME event id, which this cache
 * then correctly skips. The former per-event Supabase lookup against
 * business_events was removed: it cost one DB round-trip per publish and
 * could never match for the same reason.
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

  // Mark as processed before running handlers
  _processedEvents.set(eventId, now)

  // Evict oldest entries (Map preserves insertion order) until back under cap
  while (_processedEvents.size > CACHE_MAX_SIZE) {
    _processedEvents.delete(_processedEvents.keys().next().value)
  }

  return next()
}

/** Clear the cache (for testing) */
export function clearIdempotencyCache() {
  _processedEvents.clear()
}
