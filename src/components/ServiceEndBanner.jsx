import { useState, useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export default function ServiceEndBanner() {
  // 純 in-memory 狀態（不寫入 localStorage）：使用者關閉後，重新整理頁面會再次顯示
  const [dismissed, setDismissed] = useState(false)
  const ref = useRef(null)

  // 將實際高度同步進 CSS 變數，讓固定頂欄(topnav/sidebar/wineswee header 等)自動讓位，
  // 避免這個 fixed banner 蓋住既有內容。關閉或卸載時歸零。
  useEffect(() => {
    if (dismissed) {
      document.documentElement.style.setProperty('--sw-banner-offset', '0px')
      return
    }
    const el = ref.current
    if (!el) return
    const update = () => document.documentElement.style.setProperty('--sw-banner-offset', `${el.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      observer.disconnect()
      document.documentElement.style.setProperty('--sw-banner-offset', '0px')
    }
  }, [dismissed])

  if (dismissed) return null

  return (
    <div ref={ref} style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9998,
      background: 'var(--accent-red-dim)',
      color: 'var(--accent-red)',
      borderBottom: '1px solid var(--accent-red)',
      padding: '9px 40px',
      textAlign: 'center',
      fontSize: 13,
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      flexWrap: 'wrap',
    }}>
      <AlertTriangle size={14} strokeWidth={2.2} />
      寬限期已結束。因無加購擴充模組意願，額外開發功能將於今日（9/14）起停用
      <button
        onClick={() => setDismissed(true)}
        aria-label="關閉通知"
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          padding: 4,
          cursor: 'pointer',
          color: 'var(--accent-red)',
          display: 'flex',
        }}
      >
        <X size={16} />
      </button>
    </div>
  )
}
