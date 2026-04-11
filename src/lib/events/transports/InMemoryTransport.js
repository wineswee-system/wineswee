import { TransportInterface } from './TransportInterface.js'

/**
 * In-memory synchronous transport.
 * Iterates over all matching subscribers and invokes handlers directly.
 * Phase 1 transport — will be swapped for KafkaTransport later.
 */
export class InMemoryTransport extends TransportInterface {
  async send(event, subscribers) {
    const errors = []

    for (const [pattern, handlers] of subscribers) {
      if (!matchPattern(pattern, event.type)) continue
      for (const handler of handlers) {
        try {
          await handler(event)
        } catch (err) {
          errors.push({ handler: handler.name || 'anonymous', error: err })
        }
      }
    }

    if (errors.length > 0) {
      event._handlerErrors = errors
    }
  }
}

/**
 * Match a subscription pattern against an event type.
 * Supports: exact match, 'domain.*' wildcard, '*' catch-all.
 */
function matchPattern(pattern, type) {
  if (pattern === '*') return true
  if (pattern === type) return true
  if (pattern.endsWith('.*')) {
    return type.startsWith(pattern.slice(0, -2) + '.')
  }
  return false
}
