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
    // Store original handler errors for comparison
    const originalErrors = event._handlerErrors ? [...event._handlerErrors] : null

    await next()

    // If no handler errors occurred, nothing to retry
    if (!event._handlerErrors || event._handlerErrors.length === 0) return

    // Retry only the failed handlers
    const failedErrors = event._handlerErrors
    event._retryAttempts = event._retryAttempts || 0

    if (event._retryAttempts >= maxRetries) {
      // Max retries exceeded — let DLQ middleware handle it
      console.warn(
        `[Retry] Event ${event.id} (${event.type}) exceeded ${maxRetries} retries. Sending to DLQ.`
      )
      return
    }

    event._retryAttempts++
    const delay = baseDelayMs * Math.pow(2, event._retryAttempts - 1) + Math.random() * maxJitterMs

    console.debug(
      `[Retry] Event ${event.id} (${event.type}) retry ${event._retryAttempts}/${maxRetries} in ${Math.round(delay)}ms`
    )

    await sleep(delay)

    // Clear errors for retry attempt
    event._handlerErrors = []

    // Re-run transport delivery (next was already called, so we re-trigger)
    // The transport will re-invoke matching handlers
    await next()

    // If still failing after retry, errors remain on event for DLQ
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
