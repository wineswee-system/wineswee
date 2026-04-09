import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'

/**
 * Virtual Scrolling Hook
 *
 * Renders only visible rows for large data tables (1000+ rows).
 * Eliminates DOM bloat and keeps scroll performance smooth.
 *
 * Usage:
 *   const { virtualItems, totalHeight, containerRef, containerStyle } = useVirtualList({
 *     items: allRows,            // Full data array
 *     itemHeight: 48,            // Row height in px
 *     overscan: 5,               // Extra rows to render above/below viewport
 *   })
 *
 *   return (
 *     <div ref={containerRef} style={{ height: 600, overflow: 'auto' }}>
 *       <div style={containerStyle}>
 *         {virtualItems.map(({ item, index, style }) => (
 *           <div key={index} style={style}>{item.name}</div>
 *         ))}
 *       </div>
 *     </div>
 *   )
 */
export function useVirtualList({ items, itemHeight = 48, overscan = 5 }) {
  const containerRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  // Observe container resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height)
    })
    observer.observe(el)
    setContainerHeight(el.clientHeight)

    return () => observer.disconnect()
  }, [])

  // Scroll handler
  const onScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [onScroll])

  // Calculate visible range
  const totalHeight = items.length * itemHeight

  const virtualItems = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    )

    const result = []
    for (let i = startIndex; i <= endIndex; i++) {
      result.push({
        item: items[i],
        index: i,
        style: {
          position: 'absolute',
          top: i * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight,
        },
      })
    }
    return result
  }, [items, itemHeight, scrollTop, containerHeight, overscan])

  const containerStyle = useMemo(() => ({
    position: 'relative',
    height: totalHeight,
    width: '100%',
  }), [totalHeight])

  return {
    virtualItems,
    totalHeight,
    containerRef,
    containerStyle,
    visibleRange: {
      start: virtualItems[0]?.index || 0,
      end: virtualItems[virtualItems.length - 1]?.index || 0,
    },
    totalItems: items.length,
  }
}

/**
 * Memoized table row component wrapper.
 * Prevents re-renders when parent scrolls.
 *
 * Usage:
 *   <VirtualRow key={index} style={style}>
 *     <td>{item.name}</td>
 *   </VirtualRow>
 */
export const VirtualRow = React.memo(function VirtualRow({ style, children, className = '' }) {
  return (
    <div style={style} className={className}>
      {children}
    </div>
  )
})
