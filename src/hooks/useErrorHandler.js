/**
 * useErrorHandler — React hook for consistent error reporting in components.
 *
 * Pre-binds the module name so every catch block in a component produces
 * properly attributed logs without repeating boilerplate.
 *
 * Usage:
 *   const { handleError, warn, safeRun } = useErrorHandler('sales')
 *
 *   try {
 *     await saveOrder(payload)
 *   } catch (err) {
 *     handleError(err, { component: 'SalesOrders', errorCode: 'SAVE_FAILED' })
 *     toast.error('儲存失敗，請稍後再試')
 *   }
 *
 *   // Or as a safe wrapper (never throws):
 *   const { data, error } = await safeRun(
 *     () => supabase.from('orders').insert(payload),
 *     { component: 'SalesOrders', errorCode: 'ORDER_INSERT_FAILED' }
 *   )
 *   if (error) { toast.error('儲存失敗'); return }
 */

import { useCallback } from 'react'
import { reportError, reportWarn, safeRun as _safeRun } from '../lib/errorReporter.js'

/**
 * @param {string} module - The domain module name (e.g. 'hr', 'sales', 'finance')
 * @returns {{ handleError: Function, warn: Function, safeRun: Function }}
 */
export function useErrorHandler(module) {
  // Non-blocking: don't await in event handlers / UI callbacks
  const handleError = useCallback(
    (error, context = {}) => { reportError(error, { module, ...context }) },
    [module],
  )

  const warn = useCallback(
    (message, context = {}) => { reportWarn(message, { module, ...context }) },
    [module],
  )

  const safeRun = useCallback(
    (fn, context = {}) => _safeRun(fn, { module, ...context }),
    [module],
  )

  return { handleError, warn, safeRun }
}
