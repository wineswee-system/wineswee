/**
 * Unified Error Reporter
 *
 * Bridges the two logging paths into one call:
 *   - logger.js      → structured JSON to console (immediate, synchronous)
 *   - systemLogger.js → persists to Supabase error_logs / system_logs table (async)
 *
 * Use this everywhere instead of calling logger.error() + logError() separately.
 *
 * Usage:
 *   import { reportError, reportWarn, safeRun } from './errorReporter'
 *
 *   // In async functions / try-catch:
 *   try {
 *     await saveOrder(data)
 *   } catch (err) {
 *     await reportError(err, { module: 'sales', component: 'SalesOrders', errorCode: 'SAVE_FAILED' })
 *   }
 *
 *   // Wrap a risky call and get a safe result:
 *   const { data, error } = await safeRun(
 *     () => supabase.from('orders').insert(payload),
 *     { module: 'sales', component: 'SalesOrders', errorCode: 'ORDER_INSERT_FAILED' }
 *   )
 *   if (error) return showToast('儲存失敗')
 */

import { logger } from './logger.js'
import { logError, logWarn } from './systemLogger.js'

const log = logger.forModule('errorReporter')

/**
 * Report an Error to both the structured console log and the DB error_logs table.
 *
 * @param {Error|string} error  - The error object or message string
 * @param {object} context      - { module, component, errorCode, metadata }
 * @returns {Promise<void>}
 */
export async function reportError(error, context = {}) {
  const err = error instanceof Error ? error : new Error(String(error))
  const { module = 'Unknown', component, errorCode, metadata } = context

  // 1. Immediate structured console/JSON output (synchronous)
  log.error(err.message, {
    module,
    component,
    errorCode,
    error: err,
    ...metadata,
  })

  // 2. Persist to DB — fire-and-forget, never throws
  try {
    await logError({
      module,
      errorCode,
      message: err.message,
      stackTrace: err.stack,
      component,
      metadata,
    })
  } catch (dbErr) {
    // Don't let a DB failure mask the original error
    log.warn('Failed to persist error to DB', { module: 'errorReporter', error: dbErr })
  }
}

/**
 * Report a warning (non-fatal) to both logger and system_logs table.
 *
 * @param {string} message
 * @param {object} context  - { module, component, action, metadata }
 */
export async function reportWarn(message, context = {}) {
  const { module = 'Unknown', component, action, metadata } = context

  log.warn(message, { module, component, action, ...metadata })

  try {
    await logWarn({
      module,
      action: action || 'warning',
      message,
      metadata: { component, ...metadata },
    })
  } catch {
    // Best effort
  }
}

/**
 * Wrap an async function call so any thrown error is automatically reported.
 * Returns { data, error } — never throws.
 *
 * @param {Function} fn       - Async function to execute
 * @param {object}   context  - Passed to reportError on failure
 * @returns {Promise<{ data: *, error: Error|null }>}
 *
 * @example
 *   const { data, error } = await safeRun(
 *     () => supabase.from('orders').insert(payload),
 *     { module: 'sales', component: 'SalesOrders', errorCode: 'ORDER_INSERT_FAILED' }
 *   )
 *   if (error) return showToast('儲存失敗')
 */
export async function safeRun(fn, context = {}) {
  try {
    const data = await fn()
    return { data, error: null }
  } catch (err) {
    await reportError(err, context)
    return { data: null, error: err }
  }
}
