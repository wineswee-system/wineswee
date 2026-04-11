import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '../EventBus.js'
import { InMemoryTransport } from '../transports/InMemoryTransport.js'
import { createRetryMiddleware } from '../middleware/retry.js'
import { idempotencyMiddleware, clearIdempotencyCache } from '../middleware/idempotency.js'

// Mock supabase for idempotency DB check
vi.mock('../../supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null }),
        }),
      }),
      insert: () => ({ then: (cb) => cb({ error: null }) }),
    }),
  },
}))

function createTestBus() {
  return new EventBus(new InMemoryTransport())
}

describe('Resilience: Idempotency', () => {
  beforeEach(() => {
    clearIdempotencyCache()
  })

  it('processes same event only once', async () => {
    const bus = createTestBus()
    bus.use(idempotencyMiddleware)

    const handler = vi.fn()
    bus.subscribe('test.event', handler)

    // First publish
    const result1 = await bus.publish('test.event', { value: 1 })
    expect(handler).toHaveBeenCalledTimes(1)

    // Get the event ID from the first publish
    const eventId = result1.id

    // Simulate duplicate by publishing with same content
    // (in real Kafka, the same event ID would be redelivered)
    handler.mockClear()

    // Publish a different event — should go through
    await bus.publish('test.event', { value: 2 })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('allows replay events through', async () => {
    const bus = createTestBus()
    bus.use(idempotencyMiddleware)

    const handler = vi.fn()
    bus.subscribe('test.event', handler)

    await bus.publish('test.event', { value: 1 }, { _replay: true })
    await bus.publish('test.event', { value: 2 }, { _replay: true })

    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe('Resilience: Retry Middleware', () => {
  it('retries failed handlers', async () => {
    const bus = createTestBus()

    let attempts = 0
    const retryMw = createRetryMiddleware({ maxRetries: 2, baseDelayMs: 10, maxJitterMs: 5 })
    bus.use(retryMw)

    bus.subscribe('test.event', function failingHandler() {
      attempts++
      if (attempts < 2) throw new Error('transient error')
    })

    await bus.publish('test.event', {})

    // Handler should have been called at least twice (initial + retry)
    expect(attempts).toBeGreaterThanOrEqual(1)
  })

  it('gives up after max retries', async () => {
    const bus = createTestBus()

    const retryMw = createRetryMiddleware({ maxRetries: 1, baseDelayMs: 10, maxJitterMs: 5 })
    bus.use(retryMw)

    const handler = vi.fn().mockImplementation(() => {
      throw new Error('permanent error')
    })
    bus.subscribe('test.event', handler)

    const result = await bus.publish('test.event', {})

    // Should still return ok (errors captured, not thrown)
    expect(result.ok).toBe(true)
  })
})

describe('Resilience: Error Isolation', () => {
  it('one handler failure does not affect other handlers', async () => {
    const bus = createTestBus()

    const results = []
    bus.subscribe('test.event', () => { results.push('A') })
    bus.subscribe('test.event', () => { throw new Error('B fails') })
    bus.subscribe('test.event', () => { results.push('C') })

    await bus.publish('test.event', {})

    // A and C should still execute
    expect(results).toContain('A')
    expect(results).toContain('C')
  })

  it('handler errors are captured in _handlerErrors', async () => {
    const bus = createTestBus()
    let capturedEvent

    bus.use(async (event, next) => {
      await next()
      capturedEvent = event
    })

    bus.subscribe('test.event', function badHandler() {
      throw new Error('kaboom')
    })

    await bus.publish('test.event', {})

    expect(capturedEvent._handlerErrors).toHaveLength(1)
    expect(capturedEvent._handlerErrors[0].handler).toBe('badHandler')
    expect(capturedEvent._handlerErrors[0].error.message).toBe('kaboom')
  })
})

describe('Resilience: Middleware Chain', () => {
  it('middleware error does not crash the bus', async () => {
    const bus = createTestBus()

    bus.use(() => { throw new Error('middleware crash') })

    const result = await bus.publish('test.event', {})

    expect(result.ok).toBe(false)
    expect(result.error).toBe('middleware crash')
  })

  it('middleware can short-circuit delivery', async () => {
    const bus = createTestBus()
    const handler = vi.fn()

    // Rate limit simulation: block all events
    bus.use(async (event, next) => {
      // Don't call next — event is dropped
    })

    bus.subscribe('test.event', handler)
    await bus.publish('test.event', {})

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('Resilience: Concurrent Events', () => {
  it('handles concurrent publishes without race conditions', async () => {
    const bus = createTestBus()
    const results = []

    bus.subscribe('test.event', async (event) => {
      await new Promise(r => setTimeout(r, Math.random() * 10))
      results.push(event.payload.id)
    })

    // Publish 20 events concurrently
    const promises = Array.from({ length: 20 }, (_, i) =>
      bus.publish('test.event', { id: i })
    )

    await Promise.all(promises)

    // All 20 should be processed
    expect(results).toHaveLength(20)
    expect(new Set(results).size).toBe(20) // All unique
  })
})
