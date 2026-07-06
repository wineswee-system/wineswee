/**
 * POS 離線交易自動同步引擎
 *
 * 離線結帳的交易由 posCache.queueTransaction() 進入 localStorage 佇列
 * （每筆帶不變的 client_tx_id 冪等鍵），本模組負責在恢復連線後補送：
 *   secure_create_pos_transaction RPC 以 client_tx_id 去重 → 重放安全。
 *
 * 錯誤分類：
 *   - 網路層錯誤（fetch failed / timeout）→ 停止本輪，保留佇列稍後重試
 *   - 業務規則拒絕（RPC 明確回錯）→ 移入死信清單 pos_tx_failed，不默默丟棄
 *
 * 觸發：window 'online' 事件、initOfflineSync()（進入 POS 時）、60s 週期重試。
 */
import { createPOSTransaction } from './db'
import {
  getPendingTransactions,
  markTransactionSynced,
  addFailedTransaction,
  getFailedTransactions,
  requeueFailedTransactions,
  isOnline,
} from './posCache'
import { logger } from './logger'

const RETRY_INTERVAL_MS = 60 * 1000

let syncing = false
let initialized = false
let intervalId = null
let lastSyncAt = null
const listeners = new Set()

function notify() {
  const status = getSyncStatus()
  for (const fn of listeners) {
    try { fn(status) } catch { /* listener 自身錯誤不影響同步 */ }
  }
}

/** 訂閱同步狀態變化（回傳取消訂閱函式），供 OfflineSyncBadge 使用 */
export function subscribeSyncStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** @returns {{pending: number, failed: number, syncing: boolean, lastSyncAt: string|null}} */
export function getSyncStatus() {
  return {
    pending: getPendingTransactions().length,
    failed: getFailedTransactions().length,
    syncing,
    lastSyncAt,
  }
}

/** 網路層錯誤（可重試）vs 業務拒絕（進死信）的判斷 */
function isNetworkError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('timeout') ||
    msg.includes('fetcherror') ||
    err?.name === 'TypeError' // fetch 網路層失敗最常見的表象
  )
}

/**
 * 補送佇列中所有離線交易（FIFO，保序）。
 * @returns {Promise<{synced: number, failed: number, remaining: number}>}
 */
export async function syncPendingTransactions() {
  if (syncing) return { synced: 0, failed: 0, remaining: getPendingTransactions().length }
  if (!isOnline()) return { synced: 0, failed: 0, remaining: getPendingTransactions().length }

  syncing = true
  notify()

  let synced = 0
  let failed = 0

  try {
    // 逐筆處理，每筆重讀佇列頭（避免處理期間新入佇列造成快照過期）
    for (;;) {
      const pending = getPendingTransactions()
      const entry = pending[0] // FIFO：佇列即為插入序
      if (!entry) break

      const { localId, queuedAt: _q, ...txnData } = entry

      try {
        const { error } = await createPOSTransaction(txnData)

        if (error) {
          if (isNetworkError(error)) {
            // 網路又斷了 → 保留佇列，停止本輪
            logger.warn('Offline sync interrupted by network error, will retry', {
              module: 'pos', local_id: localId, reason: error.message,
            })
            break
          }
          // 業務規則拒絕 → 死信清單（保留完整內容，可人工重試）
          addFailedTransaction(entry, error.message)
          markTransactionSynced(localId)
          failed++
          logger.error('Offline transaction rejected by server, moved to dead-letter', {
            module: 'pos', local_id: localId, client_tx_id: txnData.client_tx_id, reason: error.message,
          })
          continue
        }

        markTransactionSynced(localId)
        synced++
        logger.info('Offline transaction synced', {
          module: 'pos', local_id: localId, client_tx_id: txnData.client_tx_id,
        })
      } catch (err) {
        if (isNetworkError(err)) {
          logger.warn('Offline sync stopped (network unreachable), will retry', {
            module: 'pos', local_id: localId, reason: err.message,
          })
          break
        }
        addFailedTransaction(entry, err.message)
        markTransactionSynced(localId)
        failed++
        logger.error('Offline transaction failed non-retryably, moved to dead-letter', {
          module: 'pos', local_id: localId, reason: err.message,
        })
      }
    }
  } finally {
    syncing = false
    lastSyncAt = new Date().toISOString()
    notify()
  }

  return { synced, failed, remaining: getPendingTransactions().length }
}

/** 手動重試死信清單：搬回佇列後立即觸發同步 */
export async function retryFailedTransactions() {
  const moved = requeueFailedTransactions()
  notify()
  if (moved > 0) await syncPendingTransactions()
  return moved
}

/**
 * 初始化自動同步（冪等 — 重複呼叫只生效一次）：
 * 進入 POS 模組時呼叫；掛 'online' 監聽 + 啟動時補送 + 週期重試。
 */
export function initOfflineSync() {
  if (initialized) return
  initialized = true

  window.addEventListener('online', () => {
    logger.info('Network restored — syncing offline POS transactions', { module: 'pos' })
    syncPendingTransactions()
  })

  // 啟動即補送（頁面可能在離線期間被關閉）
  if (getPendingTransactions().length > 0) syncPendingTransactions()

  // 週期重試（佇列為空時為 no-op，成本可忽略）
  if (!intervalId) {
    intervalId = setInterval(() => {
      if (getPendingTransactions().length > 0) syncPendingTransactions()
    }, RETRY_INTERVAL_MS)
  }
}
