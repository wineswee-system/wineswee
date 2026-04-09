import { EVENT_CATALOG } from '../catalog/index.js'

/**
 * Middleware: validate event payload against the catalog schema.
 * Warns on missing required fields but does not block delivery.
 */
export async function validatorMiddleware(event, next) {
  const schema = EVENT_CATALOG[event.type]

  if (!schema) {
    console.warn(`[EventBus] Unknown event type: ${event.type} — passing through`)
    return next()
  }

  if (schema.payload) {
    for (const [field, def] of Object.entries(schema.payload)) {
      if (def.required && (event.payload[field] === undefined || event.payload[field] === null)) {
        console.error(`[EventBus] Validation: ${event.type} missing required field "${field}"`)
      }
    }
  }

  return next()
}
