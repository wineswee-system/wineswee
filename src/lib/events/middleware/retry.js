/**
 * Middleware: Retry with exponential backoff.
 *
 * When a handler fails, this middleware retries delivery with increasing delays.
 * After max retries, the event falls through to the dead letter queue middleware.
 *
 * This is critical for Kafka consumers where transient failures (DB timeouts,
 * network blips) should be retried before sending to DLQ.
 *
 * Configuration:
 * - maxRetries: 3 (default)
 * - baseDelay: 1000ms (doubles each retry: 1s, 2s, 4s)
 * - jitter: adds random 0-500ms to prevent thundering herd
 */

const DEFAULT_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxJitterMs: 500,
}

export function createRetryMiddleware(config = {}) {
  const { maxRetries, baseDelayMs, maxJitterMs } = { ...DEFAULT_CONFIG, ...config }

  return async function retryMiddleware(event, next) {
    // First attempt: run remaining middleware chain + transport delivery
    await next()

    if (!event._handlerErrors?.length) return

    // After the first next() completes the chain index is exhausted, so
    // subsequent next() calls go directly to transport — intentionally
    // retrying only handler delivery, not audit/idempotency/etc.
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * maxJitterMs
      console.debug(
        `[Retry] ${event.type} (${event.id}) attempt ${attempt}/${maxRetries} in ${Math.round(delay)}ms`
      )
      await sleep(delay)
      event._handlerErrors = []
      event._retryAttempts = attempt
      await next()  // index past chain — calls transport directly
      if (!event._handlerErrors?.length) return
    }

    console.warn(
      `[Retry] ${event.type} (${event.id}) exhausted ${maxRetries} retries. Routing to DLQ.`
    )
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Default retry middleware instance.
 * Use createRetryMiddleware() for custom configuration.
 */
export const retryMiddleware = createRetryMiddleware()
