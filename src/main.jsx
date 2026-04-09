import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { getEventBus, registerAllHandlers } from './lib/events/index.js'
import { logger } from './lib/logger.js'

const log = logger.forModule('app')

// Initialize event bus with all domain handlers
registerAllHandlers(getEventBus())
log.info('Event bus initialized with all domain handlers')

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
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'OFFLINE_QUEUE_FLUSHED') {
            log.info('Offline queue flushed', {
              synced: event.data.synced,
              failed: event.data.failed,
            })
          }
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
