/**
 * WMS Events catalog ??test suite
 *
 * Validates event schemas and payload definitions
 */
import { WMS_EVENTS } from '../catalog/wms.events'

describe('WMS-EVT-01: Event Catalog Schema', () => {
  test('all events have domain=wms, version, payload', () => {
    for (const [key, schema] of Object.entries(WMS_EVENTS)) {
      expect(schema.domain).toBe('wms')
      expect(schema.action).toBeTruthy()
      expect(schema.version).toBeGreaterThanOrEqual(1)
      expect(schema.payload).toBeDefined()
    }
  })

  test('10 WMS events defined', () => {
    expect(Object.keys(WMS_EVENTS)).toHaveLength(12)
  })

  test('all event keys match wms.* pattern', () => {
    for (const key of Object.keys(WMS_EVENTS)) {
      expect(key).toMatch(/^wms\./)
    }
  })

  test('shipment.completed required fields', () => {
    const ev = WMS_EVENTS['wms.shipment.completed']
    expect(ev.payload.shipment_id.required).toBe(true)
    expect(ev.payload.customer.required).toBe(true)
    expect(ev.payload.total_amount.required).toBe(true)
    expect(ev.payload.carrier.required).toBe(false)
  })

  test('stock.adjusted has sku_name required', () => {
    const ev = WMS_EVENTS['wms.stock.adjusted']
    expect(ev.payload.sku_name.required).toBe(true)
    expect(ev.payload.reason.required).toBe(true)
  })

  test('return events have return_id and return_number required', () => {
    for (const key of ['wms.return.received', 'wms.return.restocked', 'wms.return.scrapped']) {
      const ev = WMS_EVENTS[key]
      expect(ev.payload.return_id.required).toBe(true)
      expect(ev.payload.return_number.required).toBe(true)
    }
  })

  test('auto_reorder.triggered has purchase_orders array required', () => {
    const ev = WMS_EVENTS['wms.auto_reorder.triggered']
    expect(ev.payload.purchase_orders.type).toBe('array')
    expect(ev.payload.purchase_orders.required).toBe(true)
    expect(ev.payload.triggered_by.required).toBe(true)
  })

  test('kit events have components array', () => {
    for (const key of ['wms.kit.assembled', 'wms.kit.disassembled']) {
      const ev = WMS_EVENTS[key]
      expect(ev.payload.components.type).toBe('array')
      expect(ev.payload.kit_sku.required).toBe(true)
    }
  })

  test('transfer.completed has from/to warehouse', () => {
    const ev = WMS_EVENTS['wms.transfer.completed']
    expect(ev.payload.from_warehouse.required).toBe(true)
    expect(ev.payload.to_warehouse.required).toBe(true)
    expect(ev.payload.items.required).toBe(true)
  })
})
