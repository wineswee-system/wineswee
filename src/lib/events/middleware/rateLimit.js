import { logger } from '../../logger.js'

const log = logger.forModule('events.rateLimit')

/**
 * Rate Limiting Middleware
 *
 * Prevents event flooding per tenant using a sliding window counter.
 * Protects downstream handlers and Kafka topics from burst traffic.
 *
 * Default: 100 events per tenant per 10-second window.
 * Exceeding the limit logs a warning and drops the event.
 */

const DEFAULT_CONFIG = {
  maxEventsPerWindow: 100,
  windowMs: 10_000,
  // Per-domain overrides (e.g., POS may need higher limits)
  domainOverrides: {
    pos: { maxEventsPerWindow: 500 },
    hr: { maxEventsPerWindow: 50 },
  },
}

// Sliding window counters: Map<tenantKey, { count, windowStart }>
const _counters = new Map()

export function createRateLimitMiddleware(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  return async function rateLimitMiddleware(event, next) {
    const tenantId = event.metadata?.tenant_id || 'global'
    const domain = event.domain
    const key = `${tenantId}:${domain}`
    const now = Date.now()

    // Get domain-specific limits
    const domainConfig = cfg.domainOverrides?.[domain] || {}
    const maxEvents = domainConfig.maxEventsPerWindow || cfg.maxEventsPerWindow
    const windowMs = domainConfig.windowMs || cfg.windowMs

    let counter = _counters.get(key)

    if (!counter || (now - counter.windowStart) > windowMs) {
      // New window
      counter = { count: 0, windowStart: now }
      _counters.set(key, counter)
    }

    counter.count++

    if (counter.count > maxEvents) {
      log.warn('Rate limit exceeded — event dropped', {
        tenant_id: tenantId,
        domain,
        event_type: event.type,
        count: counter.count,
        limit: maxEvents,
        window_ms: windowMs,
      })
      // Don't call next() — event is dropped
      return
    }

    return next()
  }
}

/** Default rate limiter instance */
export const rateLimitMiddleware = createRateLimitMiddleware()

/** Clear all counters (for testing) */
export function clearRateLimitCounters() {
  _counters.clear()
}
