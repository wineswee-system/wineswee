import { InMemoryTransport } from './transports/InMemoryTransport.js'
import { tenantContextMiddleware } from './middleware/tenantContext.js'
import { outboxMiddleware } from './middleware/outbox.js'
import { sanitizerMiddleware } from './middleware/sanitizer.js'
import { rateLimitMiddleware } from './middleware/rateLimit.js'
import { idempotencyMiddleware } from './middleware/idempotency.js'
import { validatorMiddleware } from './middleware/validator.js'
import { tracingMiddleware } from './middleware/tracing.js'
import { auditLoggerMiddleware } from './middleware/auditLogger.js'
import { deadLetterQueueMiddleware } from './middleware/deadLetterQueue.js'
import { retryMiddleware } from './middleware/retry.js'

/**
 * Core event bus with publish/subscribe, middleware chain, and pluggable transport.
 *
 * Usage:
 *   const bus = getEventBus()
 *   bus.subscribe('wms.shipment.completed', handler)
 *   bus.publish('wms.shipment.completed', { shipment_id: '123', customer: 'Acme' })
 */
export class EventBus {
  /**
   * @param {import('./transports/TransportInterface.js').TransportInterface} transport
   */
  constructor(transport) {
    this._transport = transport
    this._subscribers = new Map()  // pattern → Set<handler>
    this._middleware = []
  }

  /**
   * Register middleware that runs BEFORE handlers.
   * Signature: async (event, next) => { ... await next() }
   * @param {Function} middlewareFn
   */
  use(middlewareFn) {
    this._middleware.push(middlewareFn)
  }

  /**
   * Publish an event. Builds the envelope, runs middleware chain,
   * then delegates to transport.send().
   * @param {string} type - e.g. 'wms.shipment.completed'
   * @param {object} payload - domain-specific data
   * @param {object} [meta] - optional overrides for metadata fields
   * @returns {Promise<{id: string, ok: boolean}>}
   */
  async publish(type, payload, meta = {}) {
    const dotIndex = type.indexOf('.')
    const domain = dotIndex > -1 ? type.slice(0, dotIndex) : type
    const action = dotIndex > -1 ? type.slice(dotIndex + 1) : type

    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      domain,
      action,
      type,
      version: meta._version || 1,
      payload: payload || {},
      metadata: {
        organization_id: meta.organization_id || null,
        tenant_id: meta.tenant_id || null,
        user_id: meta.user_id || null,
        correlation_id: meta.correlation_id || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        causation_id: meta.causation_id || null,
        source: meta.source || null,
        _replay: meta._replay || false,
        _fromOutbox: meta._fromOutbox || false,  // set by outbox worker on re-publish
      },
    }

    // Run middleware chain, then transport
    const chain = [...this._middleware]
    let index = 0

    const next = async () => {
      if (index < chain.length) {
        const mw = chain[index++]
        await mw(event, next)
      } else {
        // End of middleware — deliver to subscribers
        await this._transport.send(event, this._subscribers)
      }
    }

    try {
      await next()
      return { id: event.id, ok: true }
    } catch (err) {
      console.error(`[EventBus] Publish failed for ${type}:`, err)
      return { id: event.id, ok: false, error: err.message }
    }
  }

  /**
   * Subscribe to events matching a type pattern.
   * Supports exact match ('wms.shipment.completed'), wildcard ('wms.*'), catch-all ('*').
   * @param {string} pattern
   * @param {Function} handler - async (event) => void
   * @returns {Function} unsubscribe function
   */
  subscribe(pattern, handler) {
    if (!this._subscribers.has(pattern)) {
      this._subscribers.set(pattern, new Set())
    }
    this._subscribers.get(pattern).add(handler)

    return () => {
      const handlers = this._subscribers.get(pattern)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          this._subscribers.delete(pattern)
        }
      }
    }
  }

  /** Tear down transport + clear subscriptions */
  async destroy() {
    await this._transport.destroy()
    this._subscribers.clear()
    this._middleware.length = 0
  }
}

// ── Singleton ──

let _instance = null

/**
 * Get the singleton EventBus instance with default middleware pre-wired.
 * @returns {EventBus}
 */
export function getEventBus() {
  if (!_instance) {
    _instance = createDefaultBus()
  }
  return _instance
}

/**
 * Reset the singleton (for testing).
 */
export function resetEventBus() {
  if (_instance) {
    _instance.destroy()
    _instance = null
  }
}

/**
 * Create the default bus with full middleware chain.
 *
 * Middleware execution order (10-layer enterprise pipeline):
 *   1.  tenantContext    — inject tenant_id from localStorage
 *   2.  outbox           — write event to event_outbox for at-least-once durability
 *   3.  sanitizer        — XSS/SQL injection protection, input validation
 *   4.  rateLimit        — per-tenant event throttling (burst protection)
 *   5.  idempotency      — deduplicate events (critical for Kafka at-least-once)
 *   6.  validator        — validate payload against EVENT_CATALOG schema
 *   7.  tracing          — OpenTelemetry-compatible distributed tracing spans
 *   8.  auditLogger      — persist event to business_events table (batched, 250ms flush)
 *   9.  deadLetterQueue  — capture handler errors to DLQ table (runs after retry exhaustion)
 *   10. retry            — retry transport delivery with exponential backoff (LAST — calls
 *                          transport directly; on failure DLQ above captures the final error)
 *
 * Retry + DLQ ordering note:
 *   retry is placed LAST so when it exhausts all attempts and returns, control flows back up
 *   to deadLetterQueue which then checks the final event._handlerErrors state. This means DLQ
 *   only fires for permanently-failed events, not transient failures that retry recovers.
 *
 * Transport swap for Kafka migration:
 *   Replace `new InMemoryTransport()` with `new KafkaTransport(config)`
 *   from './transports/KafkaTransport.js'. All middleware and handlers
 *   remain unchanged — only the transport layer changes.
 */
function createDefaultBus() {
  const transport = new InMemoryTransport()
  const bus = new EventBus(transport)
  bus.use(tenantContextMiddleware)   //  1
  bus.use(outboxMiddleware)          //  2 — NEW: durability guarantee
  bus.use(sanitizerMiddleware)       //  3
  bus.use(rateLimitMiddleware)       //  4
  bus.use(idempotencyMiddleware)     //  5
  bus.use(validatorMiddleware)       //  6
  bus.use(tracingMiddleware)         //  7
  bus.use(auditLoggerMiddleware)     //  8
  bus.use(deadLetterQueueMiddleware) //  9
  bus.use(retryMiddleware)           // 10 — NEW: retry AFTER DLQ wraps it
  return bus
}
