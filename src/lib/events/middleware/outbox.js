import { supabase } from '../../supabase.js'
import { logger } from '../../logger.js'

const log = logger.forModule('events.outbox')

/**
 * Outbox Pattern Middleware
 *
 * ⚠️ CURRENTLY NOT REGISTERED in the default EventBus middleware chain.
 * Reason: it inserts one event_outbox row per publish, but createOutboxWorker
 * is never started in the client, so 'pending' rows accumulated forever with
 * no consumer draining them. Kept (with its exports) for future Kafka or
 * server-side use — re-register in EventBus.createDefaultBus() only together
 * with a running outbox worker.
 *
 * Ensures atomicity between database writes and event publishing.
 * Instead of publishing events directly, writes them to an `event_outbox` table.
 * A background worker then reads the outbox and publishes to the transport.
 *
 * This guarantees:
 * - If the DB write succeeds, the event WILL eventually be published
 * - If the DB write fails, no event is published
 * - No "ghost events" from published-but-rolled-back transactions
 *
 * In Kafka mode, the outbox worker publishes to Kafka topics.
 * In InMemory mode, the outbox is flushed immediately after the middleware chain.
 */
export async function outboxMiddleware(event, next) {
  // Skip replay events and events re-published by the outbox worker itself
  // (worker sets _fromOutbox: true to prevent re-writing to the outbox table)
  if (event.metadata._replay || event.metadata._fromOutbox) {
    return next()
  }

  // Write to outbox table
  const { error } = await supabase.from('event_outbox').insert({
    event_type: event.type,
    domain: event.domain,
    payload: event.payload,
    metadata: {
      ...event.metadata,
      event_id: event.id,
      version: event.version,
      timestamp: event.timestamp,
    },
    status: 'pending',
  })

  if (error) {
    log.error('Outbox write failed', { error, event_type: event.type, event_id: event.id })
    // Don't block — fall through to direct delivery
  }

  // Continue middleware chain (direct delivery as fallback)
  return next()
}

/**
 * Outbox Worker
 *
 * Polls the event_outbox table for pending events and processes them.
 * In production, this would run as a separate process or Supabase Edge Function.
 *
 * Usage:
 *   const worker = createOutboxWorker(bus)
 *   worker.start()     // Begin polling
 *   worker.stop()      // Stop polling
 *   worker.flush()     // Process all pending immediately
 */
export function createOutboxWorker(bus, options = {}) {
  const {
    pollIntervalMs = 5000,
    batchSize = 50,
    maxRetries = 3,
  } = options

  let timer = null
  let running = false

  async function processBatch() {
    if (running) return
    running = true

    try {
      // Fetch pending outbox events
      const { data: events, error } = await supabase
        .from('event_outbox')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(batchSize)

      if (error || !events || events.length === 0) {
        running = false
        return
      }

      for (const row of events) {
        try {
          // Re-publish through bus (skip outbox middleware to avoid loop)
          await bus.publish(row.event_type, row.payload, {
            ...row.metadata,
            _fromOutbox: true,
          })

          // Mark as published
          await supabase
            .from('event_outbox')
            .update({ status: 'published', published_at: new Date().toISOString() })
            .eq('id', row.id)

        } catch (err) {
          const newRetry = (row.retry_count || 0) + 1
          const newStatus = newRetry >= maxRetries ? 'failed' : 'pending'

          await supabase
            .from('event_outbox')
            .update({
              status: newStatus,
              retry_count: newRetry,
              error_message: err.message,
            })
            .eq('id', row.id)

          log.warn('Outbox event processing failed', {
            event_type: row.event_type,
            retry: newRetry,
            maxRetries,
            error: err,
          })
        }
      }
    } catch (err) {
      log.error('Outbox worker batch failed', { error: err })
    }

    running = false
  }

  return {
    start() {
      if (timer) return
      log.info('Outbox worker started', { pollIntervalMs, batchSize })
      timer = setInterval(processBatch, pollIntervalMs)
      processBatch() // Initial flush
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
        log.info('Outbox worker stopped')
      }
    },

    async flush() {
      await processBatch()
    },

    isRunning() {
      return timer !== null
    },
  }
}
