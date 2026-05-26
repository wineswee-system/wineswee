import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { getEventBus, registerAllHandlers } from './lib/events/index.js'
import { logger } from './lib/logger.js'
import { applyFontScale, getFontScale } from './lib/fontScale.js'
import { installGlobalErrorHandler } from './lib/systemLogger.js'
import { dlqMonitor } from './lib/dlqMonitor.js'

const log = logger.forModule('app')

// 套用字體大小（有使用者偏好用偏好值，否則依視窗寬度自動計算）
applyFontScale(getFontScale())

// 無使用者偏好時，視窗縮放自動重算比例
window.addEventListener('resize', () => {
  if (!localStorage.getItem('app.fontScale')) {
    applyFontScale(getFontScale())
  }
}, { passive: true })

// Initialize event bus with all domain handlers
registerAllHandlers(getEventBus())
log.info('Event bus initialized with all domain handlers')

// ── Error Tracking Bootstrap ──
// Capture window.onerror + unhandledrejection → persists to error_logs table
installGlobalErrorHandler()
log.info('Global error handler installed')

// Start DLQ monitor: polls every 60s, tracks error budget, fires alert callbacks
dlqMonitor.start()
dlqMonitor.onAlert((alert) => {
  log.warn(`DLQ alert [${alert.severity}]: ${alert.message}`, {
    alert_type: alert.type,
    severity: alert.severity,
  })
})
log.info('DLQ monitor started')

// Register Service Worker (production only)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        log.info('Service Worker registered', { scope: reg.scope })

        // Flush offline queue when back online
        window.addEventListener('online', () => {
          reg.active?.postMessage({ type: 'FLUSH_OFFLINE_QUEUE' })
          log.info('Back online — flushing offline queue')
        })

        // Listen for offline queue sync results
        navigator.serviceWorker.addEventListener('message', async (event) => {
          if (event.data?.type === 'OFFLINE_QUEUE_FLUSHED') {
            log.info('Offline queue flushed', {
              synced: event.data.synced,
              failed: event.data.failed,
            })
          }
          // ★ 偵測到舊 build chunk 已不存在 → 自動 unregister SW + 清快取 + reload
          //    避免使用者卡在「系統發生錯誤」白屏
          if (event.data?.type === 'STALE_BUILD_DETECTED') {
            log.warn('Stale build detected, auto-recovering', { url: event.data.url })
            try {
              const regs = await navigator.serviceWorker.getRegistrations()
              await Promise.all(regs.map(r => r.unregister()))
              const keys = await caches.keys()
              await Promise.all(keys.map(k => caches.delete(k)))
            } catch { /* best effort */ }
            // 強制重整（bypass cache）
            window.location.reload()
          }
        })

        // 自動偵測 SW 有新版 → 提示用戶 reload
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              log.info('New SW installed, will activate on next navigation')
            }
          })
        })
      })
      .catch((err) => {
        log.warn('Service Worker registration failed', { error: err })
      })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
