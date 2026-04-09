import { supabase } from '../../supabase.js'

/**
 * Middleware: runs AFTER handlers. If any handler threw an error,
 * the transport attaches _handlerErrors to the event. This middleware
 * persists those errors to the dead_letter_queue table.
 */
export async function deadLetterQueueMiddleware(event, next) {
  await next()

  if (event._handlerErrors && event._handlerErrors.length > 0) {
    supabase.from('dead_letter_queue').insert({
      event_id: event.id,
      event_type: event.type,
      payload: event.payload,
      metadata: event.metadata,
      errors: event._handlerErrors.map(e => ({
        handler: e.handler,
        message: e.error?.message || String(e.error),
        stack: e.error?.stack,
      })),
      retry_count: 0,
      status: 'pending',
    }).then(({ error }) => {
      if (error) console.warn('[DLQ] Failed to store dead letter:', error.message)
    })
  }
}
