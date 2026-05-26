/**
 * useErrorHandler — React hook for consistent error reporting in components.
 *
 * Pre-binds the module name so every catch block in a component produces
 * properly attributed logs without repeating boilerplate.
 *
 * Usage:
 *   const handleError = useErrorHandler('sales')
 *
 *   try {
 *     await saveOrder(payload)
 *   } catch (err) {
 *     handleError(err, { component: 'SalesOrders', errorCode: 'SAVE_FAILED' })
 *     toast.error('儲存失敗，請稍後再試')
 *   }
 *
 * Or as a safe wrapper (never throws):
 *   const { data, error } = await handleError.safeRun(
 *     () => supabase.from('orders').insert(payload),
 *     { component: 'SalesOrders', errorCode: 'ORDER_INSERT_FAILED' }
 *   )
 *   if (error) { toast.error('儲存失敗'); return }
 */

import { useCallback } from 'react'
import { reportError, reportWarn, safeRun } from '../lib/errorReporter.js'

/**
 * @param {string} module - The domain module name (e.g. 'hr', 'sales', 'finance')
 * @returns {Function} handleError — with .warn() and .safeRun() attached
 */
export function useErrorHandler(module) {
  /**
   * Report an error — fire-and-forget from the caller's perspective.
   * Logs immediately to console; persists to DB asynchronously.
   */
  const handleError = useCallback(
    (error, context = {}) => {
      // Non-blocking: don't await in event handlers / UI callbacks
      reportError(error, { module, ...context })
    },
    [module],
  )

  /**
   * Report a non-fatal warning.
   */
  handleError.warn = useCallback(
    (message, context = {}) => {
      reportWarn(message, { module, ...context })
    },
    [module],
  )

  /**
   * Wrap an async fn — catches, reports, and returns { data, error }.
   * Use when you need the return value of the risky call.
   */
  handleError.safeRun = useCallback(
    (fn, context = {}) => safeRun(fn, { module, ...context }),
    [module],
  )

  return handleError
}
