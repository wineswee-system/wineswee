import { registerFinanceHandlers } from './financeHandlers.js'
import { registerPurchaseHandlers } from './purchaseHandlers.js'
import { registerWMSHandlers } from './wmsHandlers.js'
import { registerCRMHandlers } from './crmHandlers.js'
import { registerPOSHandlers } from './posHandlers.js'
import { registerHRHandlers } from './hrHandlers.js'
import { registerManufacturingHandlers } from './manufacturingHandlers.js'

/**
 * Wire up all event handlers on the bus.
 * Call once during app initialization (e.g., in main.jsx).
 *
 * Each domain handler subscribes to cross-module events and produces
 * downstream events, forming event chains that span the entire system.
 *
 * When migrating to Kafka, these handlers become Kafka consumers.
 * The handler code itself does not change — only the transport layer.
 */
export function registerAllHandlers(bus) {
  registerFinanceHandlers(bus)
  registerPurchaseHandlers(bus)
  registerWMSHandlers(bus)
  registerCRMHandlers(bus)
  registerPOSHandlers(bus)
  registerHRHandlers(bus)
  registerManufacturingHandlers(bus)
}
