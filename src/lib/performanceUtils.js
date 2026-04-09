import { useMemo, useCallback, useRef, useEffect, useState } from 'react'

/**
 * Performance Utilities
 *
 * React hooks and helpers for enterprise-level UI performance.
 * Designed to prevent unnecessary re-renders in complex dashboards
 * with many charts, tables, and real-time data.
 */

/**
 * useStableCallback — memoize a callback that always has fresh closure values.
 * Unlike useCallback, this never causes children to re-render when deps change,
 * while still always calling the latest version of the function.
 *
 * Usage:
 *   const handleClick = useStableCallback((id) => {
 *     doSomethingWith(currentState, id) // always has latest state
 *   })
 */
export function useStableCallback(callback) {
  const ref = useRef(callback)
  ref.current = callback
  return useCallback((...args) => ref.current(...args), [])
}

/**
 * useDebouncedValue — debounce a rapidly changing value.
 * Useful for search inputs, filter changes, and live data.
 *
 * Usage:
 *   const [search, setSearch] = useState('')
 *   const debouncedSearch = useDebouncedValue(search, 300)
 *   // debouncedSearch updates 300ms after last setSearch call
 */
export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

/**
 * useMemoCompare — like useMemo but with custom equality check.
 * Prevents re-computation when data is structurally equal but referentially different
 * (common with Supabase query results).
 *
 * Usage:
 *   const memoData = useMemoCompare(queryResult, (prev, next) =>
 *     JSON.stringify(prev) === JSON.stringify(next)
 *   )
 */
export function useMemoCompare(value, compare) {
  const ref = useRef(value)

  if (!compare(ref.current, value)) {
    ref.current = value
  }

  return ref.current
}

/**
 * useThrottle — throttle a callback to max once per interval.
 * Useful for scroll handlers, resize events, real-time updates.
 *
 * Usage:
 *   const throttledScroll = useThrottle((e) => handleScroll(e), 100)
 */
export function useThrottle(callback, intervalMs = 100) {
  const lastRun = useRef(0)
  const timer = useRef(null)

  return useCallback((...args) => {
    const now = Date.now()
    const remaining = intervalMs - (now - lastRun.current)

    if (remaining <= 0) {
      lastRun.current = now
      callback(...args)
    } else {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        lastRun.current = Date.now()
        callback(...args)
      }, remaining)
    }
  }, [callback, intervalMs])
}

/**
 * usePrevious — track the previous value of a prop or state.
 *
 * Usage:
 *   const prevCount = usePrevious(count)
 *   if (prevCount !== count) { ... }
 */
export function usePrevious(value) {
  const ref = useRef()
  useEffect(() => { ref.current = value }, [value])
  return ref.current
}

/**
 * useIntersectionObserver — lazy-load components when they scroll into view.
 * Ideal for below-the-fold charts and heavy widgets.
 *
 * Usage:
 *   const { ref, isInView } = useIntersectionObserver({ threshold: 0.1 })
 *   return (
 *     <div ref={ref}>
 *       {isInView ? <HeavyChart data={data} /> : <Skeleton />}
 *     </div>
 *   )
 */
export function useIntersectionObserver(options = {}) {
  const { threshold = 0, rootMargin = '200px' } = options
  const ref = useRef(null)
  const [isInView, setIsInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.unobserve(el) // Only trigger once
        }
      },
      { threshold, rootMargin }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold, rootMargin])

  return { ref, isInView }
}

/**
 * Chunk large arrays for progressive rendering.
 * Renders items in batches to avoid blocking the main thread.
 *
 * Usage:
 *   const chunks = chunkArray(bigArray, 50)
 *   // Render first chunk immediately, rest with requestIdleCallback
 */
export function chunkArray(arr, chunkSize = 50) {
  const chunks = []
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * Format large numbers for display (avoids expensive toLocaleString in loops).
 * Pre-compiled formatter for zh-TW locale.
 */
const _numberFormatter = new Intl.NumberFormat('zh-TW')
const _currencyFormatter = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  minimumFractionDigits: 0,
})

export function formatNumber(n) {
  if (n === null || n === undefined) return '-'
  return _numberFormatter.format(n)
}

export function formatCurrency(n) {
  if (n === null || n === undefined) return '-'
  return _currencyFormatter.format(n)
}
