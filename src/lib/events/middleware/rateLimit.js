import { logger } from '../../logger.js'

const log = logger.forModule('events.rateLimit')

const DEFAULT_CONFIG = {
  maxEventsPerWindow: 100,
  windowMs: 10_000,
  domainOverrides: {
    pos: { maxEventsPerWindow: 500 },
    hr: { maxEventsPerWindow: 50 },
  },
  // Per-event-type limits checked in addition to domain limits
  eventTypeOverrides: {
    'pos.transaction.created': { maxEventsPerWindow: 200, windowMs: 10_000 },
    'pos.cart.updated': { maxEventsPerWindow: 1000, windowMs: 10_000 },
  },
}

// Cap on number of tenant:domain counter slots to bound memory usage.
// When full, oldest entry (by insertion order) is evicted.
const MAX_COUNTERS = 1000

// Sliding window counters: Map<key, { count, windowStart }>
const _counters = new Map()

function _getOrCreate(key, now, windowMs) {
  let counter = _counters.get(key)
  if (!counter || (now - counter.windowStart) > windowMs) {
    if (!counter && _counters.size >= MAX_COUNTERS) {
      _counters.delete(_counters.keys().next().value)
    }
    counter = { count: 0, windowStart: now }
    _counters.set(key, counter)
  }
  return counter
}

export function createRateLimitMiddleware(config = {}) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...config,
    domainOverrides: { ...DEFAULT_CONFIG.domainOverrides, ...config.domainOverrides },
    eventTypeOverrides: { ...DEFAULT_CONFIG.eventTypeOverrides, ...config.eventTypeOverrides },
  }

  return async function rateLimitMiddleware(event, next) {
    const tenantId = event.metadata?.organization_id || event.metadata?.tenant_id || 'global'
    const domain = event.domain
    const now = Date.now()

    // ── Per-event-type limit (most specific) ──────────────────
    const typeOverride = cfg.eventTypeOverrides?.[event.type]
    if (typeOverride) {
      const typeKey = `${tenantId}:${domain}:${event.type}`
      const typeWindowMs = typeOverride.windowMs ?? cfg.windowMs
      const tc = _getOrCreate(typeKey, now, typeWindowMs)
      tc.count++
      if (tc.count > typeOverride.maxEventsPerWindow) {
        log.warn('Rate limit exceeded (event-type) — event dropped', {
          tenant_id: tenantId, domain, event_type: event.type,
          count: tc.count, limit: typeOverride.maxEventsPerWindow,
        })
        return
      }
    }

    // ── Per-domain limit ──────────────────────────────────────
    const domainCfg = cfg.domainOverrides?.[domain] || {}
    const maxEvents = domainCfg.maxEventsPerWindow ?? cfg.maxEventsPerWindow
    const windowMs = domainCfg.windowMs ?? cfg.windowMs
    const key = `${tenantId}:${domain}`
    const counter = _getOrCreate(key, now, windowMs)
    counter.count++
    if (counter.count > maxEvents) {
      log.warn('Rate limit exceeded — event dropped', {
        tenant_id: tenantId, domain, event_type: event.type,
        count: counter.count, limit: maxEvents, window_ms: windowMs,
      })
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
