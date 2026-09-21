import { supabase } from '../../supabase.js'
import { logger } from '../../logger.js'

const log = logger.forModule('events.auditLogger')

/**
 * Middleware: persist every event to the business_events table.
 * Fire-and-forget — does not block handler delivery.
 */
export async function auditLoggerMiddleware(event, next) {
  // Skip replay events to avoid duplicates in the store
  if (!event.metadata._replay) {
    supabase.from('business_events').insert({
      event_id: event.id,
      event_type: event.type,
      domain: event.domain,
      action: event.action,
      version: event.version,
      payload: event.payload,
      metadata: event.metadata,
      timestamp: event.timestamp,
      organization_id: event.metadata?.organization_id || event.metadata?.tenant_id || null,
    }).then(({ error }) => {
      if (error) log.warn('Failed to persist event to business_events', {
        event_id: event.id,
        event_type: event.type,
        error,
      })
    })
  }

  return next()
}
