import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '../EventBus.js'
import { InMemoryTransport } from '../transports/InMemoryTransport.js'

// Use raw EventBus without default middleware for unit tests
function createTestBus() {
  return new EventBus(new InMemoryTransport())
}

describe('EventBus', () => {
  let bus

  beforeEach(() => {
    bus = createTestBus()
  })

  // ── Publish / Subscribe ──

  it('delivers events to matching subscribers', async () => {
    const handler = vi.fn()
    bus.subscribe('wms.shipment.completed', handler)

    await bus.publish('wms.shipment.completed', { customer: 'Acme' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].payload.customer).toBe('Acme')
  })

  it('does not deliver events to non-matching subscribers', async () => {
    const handler = vi.fn()
    bus.subscribe('finance.ar.created', handler)

    await bus.publish('wms.shipment.completed', { customer: 'Acme' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('supports wildcard domain subscriptions', async () => {
    const handler = vi.fn()
    bus.subscribe('wms.*', handler)

    await bus.publish('wms.shipment.completed', {})
    await bus.publish('wms.stock.adjusted', {})
    await bus.publish('finance.ar.created', {})

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('supports catch-all subscriptions', async () => {
    const handler = vi.fn()
    bus.subscribe('*', handler)

    await bus.publish('wms.shipment.completed', {})
    await bus.publish('finance.ar.created', {})
    await bus.publish('hr.leave.approved', {})

    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('unsubscribe removes the handler', async () => {
    const handler = vi.fn()
    const unsub = bus.subscribe('wms.shipment.completed', handler)

    await bus.publish('wms.shipment.completed', {})
    expect(handler).toHaveBeenCalledTimes(1)

    unsub()
    await bus.publish('wms.shipment.completed', {})
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('supports multiple handlers on the same pattern', async () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    bus.subscribe('wms.shipment.completed', h1)
    bus.subscribe('wms.shipment.completed', h2)

    await bus.publish('wms.shipment.completed', {})

    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
  })

  // ── Event Envelope ──

  it('builds correct event envelope', async () => {
    let captured
    bus.subscribe('sales.order.created', (e) => { captured = e })

    await bus.publish('sales.order.created', { order_id: '123' }, { source: 'test' })

    expect(captured.id).toMatch(/^evt_/)
    expect(captured.domain).toBe('sales')
    expect(captured.action).toBe('order.created')
    expect(captured.type).toBe('sales.order.created')
    expect(captured.version).toBe(1)
    expect(captured.payload.order_id).toBe('123')
    expect(captured.metadata.source).toBe('test')
    expect(captured.metadata.correlation_id).toMatch(/^corr_/)
    expect(captured.timestamp).toBeTruthy()
  })

  it('preserves correlation_id when provided', async () => {
    let captured
    bus.subscribe('test.event', (e) => { captured = e })

    await bus.publish('test.event', {}, { correlation_id: 'my-corr-id' })

    expect(captured.metadata.correlation_id).toBe('my-corr-id')
  })

  // ── Middleware ──

  it('runs middleware in order', async () => {
    const order = []
    bus.use((event, next) => { order.push('A'); return next() })
    bus.use((event, next) => { order.push('B'); return next() })
    bus.subscribe('test.event', () => order.push('handler'))

    await bus.publish('test.event', {})

    expect(order).toEqual(['A', 'B', 'handler'])
  })

  it('middleware can modify events', async () => {
    bus.use((event, next) => {
      event.metadata.tenant_id = 'injected-tenant'
      return next()
    })

    let captured
    bus.subscribe('test.event', (e) => { captured = e })

    await bus.publish('test.event', {})

    expect(captured.metadata.tenant_id).toBe('injected-tenant')
  })

  it('middleware can short-circuit by not calling next', async () => {
    const handler = vi.fn()
    bus.use((event, next) => {
      // Don't call next — event is blocked
    })
    bus.subscribe('test.event', handler)

    await bus.publish('test.event', {})

    expect(handler).not.toHaveBeenCalled()
  })

  // ── Error Handling ──

  it('handler errors are captured, not thrown', async () => {
    bus.subscribe('test.event', () => { throw new Error('boom') })

    const result = await bus.publish('test.event', {})

    expect(result.ok).toBe(true) // publish itself succeeds
  })

  it('handler errors are attached to event as _handlerErrors', async () => {
    let captured
    bus.use(async (event, next) => {
      await next()
      captured = event._handlerErrors
    })

    bus.subscribe('test.event', function failingHandler() {
      throw new Error('test error')
    })

    await bus.publish('test.event', {})

    expect(captured).toHaveLength(1)
    expect(captured[0].handler).toBe('failingHandler')
    expect(captured[0].error.message).toBe('test error')
  })

  // ── Destroy ──

  it('destroy clears all subscribers and middleware', async () => {
    const handler = vi.fn()
    bus.use((e, next) => next())
    bus.subscribe('test.event', handler)

    await bus.destroy()
    const result = await bus.publish('test.event', {})

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('InMemoryTransport', () => {
  it('matchPattern handles exact, wildcard, and catch-all', async () => {
    const transport = new InMemoryTransport()
    const results = []

    const subscribers = new Map()
    subscribers.set('wms.shipment.completed', new Set([() => results.push('exact')]))
    subscribers.set('wms.*', new Set([() => results.push('wildcard')]))
    subscribers.set('*', new Set([() => results.push('catchall')]))

    await transport.send({ type: 'wms.shipment.completed', payload: {} }, subscribers)

    expect(results).toEqual(['exact', 'wildcard', 'catchall'])
  })

  it('wildcard does not match partial domain names', async () => {
    const transport = new InMemoryTransport()
    const handler = vi.fn()

    const subscribers = new Map()
    subscribers.set('wm.*', new Set([handler]))

    await transport.send({ type: 'wms.shipment.completed', payload: {} }, subscribers)

    expect(handler).not.toHaveBeenCalled()
  })
})
