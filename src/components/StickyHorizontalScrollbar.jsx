import { useEffect, useRef, useState } from 'react'

/**
 * StickyHorizontalScrollbar — 浮動式橫向滾軸
 *
 * 解決問題：列表頁表格欄位多時，原生橫向滾軸貼在表格容器底邊，
 * 若資料筆數多（容器高度 > viewport），user 要捲到最底才看得到滾軸。
 *
 * 做法：
 * 1. 找出 .main-content 內所有 .data-table-wrapper / div.data-table 中
 *    當前 viewport 內可見、且有橫向 overflow 的容器（target）
 * 2. 在 .main-content 底部 sticky 一條 14px 浮動滾軸
 * 3. 雙向同步 scrollLeft：user 滾 sticky bar → target 跟著動；反之亦然
 *
 * 不動 196 個頁面的 JSX 結構，純 layout 層新增。
 *
 * 邊界處理：
 * - 切換路由 / 動態加 table → MutationObserver 重新偵測
 * - viewport 縮放 / table 內容變動 → ResizeObserver 觸發 update
 * - user 上下捲 main-content → scroll listener 重新選 target
 * - 同步避免 loop → syncingRef 旗標 + rAF
 *
 * Known limit：
 * - Pattern B 純 <table className="data-table"> 沒包 wrapper 的不偵測
 *   (但這類頁面 .main-content overflow-x: hidden 會把超寬內容切掉，仍是現存問題)
 */
export default function StickyHorizontalScrollbar() {
  const [trackWidth, setTrackWidth] = useState(0)
  const targetRef = useRef(null)
  const stickyRef = useRef(null)
  const syncingRef = useRef(false)

  // ── 找 target + 監聽 layout 變動 ──────────────────────────────
  useEffect(() => {
    const main = document.querySelector('.main-content')
    if (!main) return

    function computeInnerWidth(target, sticky) {
      // sticky bar 寬度 ≠ target 寬度（target 在 page-container 內，有 64px padding）
      // 要讓 sticky.maxScrollLeft = target.maxScrollLeft，inner div 寬度必須是：
      //   target.scrollWidth - target.clientWidth + sticky.clientWidth
      // 這樣兩邊都能完整拉到底
      return target.scrollWidth - target.clientWidth + sticky.clientWidth
    }

    function pickTarget() {
      const candidates = main.querySelectorAll(
        '.data-table-wrapper, div.data-table'
      )
      const mainRect = main.getBoundingClientRect()

      let best = null
      let bestVisibleHeight = 0

      for (const el of candidates) {
        // 沒橫向 overflow → 跳過（不需要 sticky bar）
        if (el.scrollWidth <= el.clientWidth + 1) continue

        const rect = el.getBoundingClientRect()
        const visibleTop = Math.max(rect.top, mainRect.top)
        const visibleBottom = Math.min(rect.bottom, mainRect.bottom)
        const visibleHeight = Math.max(0, visibleBottom - visibleTop)

        // 完全在 viewport 外的 target 不選
        if (visibleHeight <= 0) continue

        if (visibleHeight > bestVisibleHeight) {
          best = el
          bestVisibleHeight = visibleHeight
        }
      }

      const prevTarget = targetRef.current
      targetRef.current = best

      if (best && stickyRef.current) {
        const newWidth = computeInnerWidth(best, stickyRef.current)
        if (newWidth !== trackWidth) {
          setTrackWidth(newWidth)
        }
        // 同步 sticky bar 的 scrollLeft 跟新 target 對齊
        if (best !== prevTarget) {
          syncingRef.current = true
          stickyRef.current.scrollLeft = best.scrollLeft
          requestAnimationFrame(() => { syncingRef.current = false })
        }
      } else if (!best && trackWidth !== 0) {
        setTrackWidth(0)
      }
    }

    pickTarget()

    // 1. main-content 滾動 → 可能切換 target
    main.addEventListener('scroll', pickTarget, { passive: true })

    // 2. window resize → viewport 變化
    window.addEventListener('resize', pickTarget)

    // 3. MutationObserver：DOM 變動（換頁、modal 開關、table 內容變）
    let mutationTimer = null
    const mo = new MutationObserver(() => {
      // debounce 避免高頻變動
      if (mutationTimer) clearTimeout(mutationTimer)
      mutationTimer = setTimeout(pickTarget, 100)
    })
    mo.observe(main, { childList: true, subtree: true })

    // 4. ResizeObserver：main-content 自己或 candidate 尺寸變
    const ro = new ResizeObserver(() => pickTarget())
    ro.observe(main)

    return () => {
      main.removeEventListener('scroll', pickTarget)
      window.removeEventListener('resize', pickTarget)
      mo.disconnect()
      ro.disconnect()
      if (mutationTimer) clearTimeout(mutationTimer)
    }
    // trackWidth 故意不放 dep — 在 pickTarget 內 setTrackWidth 會引發重 effect
    // 但這 effect 只負責「找 target + 監聽」，沒必要每次 trackWidth 變就重 mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 雙向同步 scrollLeft ──────────────────────────────────────
  useEffect(() => {
    if (trackWidth === 0) return
    const target = targetRef.current
    const sticky = stickyRef.current
    if (!target || !sticky) return

    function onTargetScroll() {
      if (syncingRef.current) return
      syncingRef.current = true
      sticky.scrollLeft = target.scrollLeft
      requestAnimationFrame(() => { syncingRef.current = false })
    }
    function onStickyScroll() {
      if (syncingRef.current) return
      syncingRef.current = true
      target.scrollLeft = sticky.scrollLeft
      requestAnimationFrame(() => { syncingRef.current = false })
    }

    target.addEventListener('scroll', onTargetScroll, { passive: true })
    sticky.addEventListener('scroll', onStickyScroll, { passive: true })

    return () => {
      target.removeEventListener('scroll', onTargetScroll)
      sticky.removeEventListener('scroll', onStickyScroll)
    }
  }, [trackWidth])

  // 注意：sticky bar always mount — 不能 return null（會破壞 ref，
  // 害 pickTarget 算不出 inner width，trackWidth 永遠卡 0）。
  // 沒 target 時 inner div 寬度 0，native 不出滾軸，視覺上是 14px 同色背景條
  return (
    <div
      ref={stickyRef}
      aria-hidden="true"
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        height: trackWidth > 0 ? 21 : 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        background: 'var(--bg-secondary)',
        borderTop: trackWidth > 0 ? '1px solid var(--border-subtle)' : 'none',
        zIndex: 10,
        transition: 'height 0.15s ease',
      }}
    >
      <div style={{ width: trackWidth, height: 1 }} />
    </div>
  )
}
