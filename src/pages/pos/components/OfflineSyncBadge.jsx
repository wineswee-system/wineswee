/**
 * 離線交易同步狀態徽章（POS 終端頁首用）
 * - 待同步 > 0 → 橘色「離線交易待同步 N 筆」
 * - 死信   > 0 → 紅色「同步失敗 N 筆」+ 重試按鈕
 * - 全部乾淨 → 不渲染
 */
import { useEffect, useState } from 'react'
import { getSyncStatus, subscribeSyncStatus, retryFailedTransactions, syncPendingTransactions } from '../../../lib/posOfflineSync'
import { toast } from '../../../lib/toast'

const pill = (accent) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  background: `var(--accent-${accent}-dim)`,
  color: `var(--accent-${accent})`,
})

export default function OfflineSyncBadge() {
  const [status, setStatus] = useState(getSyncStatus)

  useEffect(() => subscribeSyncStatus(setStatus), [])

  if (status.pending === 0 && status.failed === 0) return null

  const handleRetryFailed = async () => {
    const moved = await retryFailedTransactions()
    if (moved > 0) toast.success(`已重新排入 ${moved} 筆失敗交易`)
  }

  return (
    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {status.pending > 0 && (
        <button
          onClick={() => syncPendingTransactions()}
          title="點擊立即同步"
          style={{ ...pill('orange'), border: 'none', cursor: 'pointer' }}
        >
          {status.syncing ? '⟳ 同步中…' : `⏸ 離線交易待同步 ${status.pending} 筆`}
        </button>
      )}
      {status.failed > 0 && (
        <span style={pill('red')}>
          ✕ 同步失敗 {status.failed} 筆
          <button
            onClick={handleRetryFailed}
            style={{
              border: 'none',
              cursor: 'pointer',
              background: 'var(--accent-red)',
              color: '#fff', /* 反白文字置於 accent 背景上（允許的唯一 hex） */
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            重試
          </button>
        </span>
      )}
    </div>
  )
}
