import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { outageBus } from '../lib/outageBus'

export default function OutageBanner() {
  const [visible, setVisible] = useState(() => outageBus.isDown())

  useEffect(() => outageBus.subscribe(setVisible), [])

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: 'var(--accent-orange-dim)',
      color: 'var(--accent-orange)',
      borderBottom: '1px solid var(--accent-orange)',
      padding: '9px 16px',
      textAlign: 'center',
      fontSize: 13,
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    }}>
      <AlertTriangle size={14} strokeWidth={2.2} />
      資料庫服務暫時中斷，畫面顯示為上次同步資料，系統將自動重試恢復…
    </div>
  )
}
