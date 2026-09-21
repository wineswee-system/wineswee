import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { maskPhone, maskEmail, maskAddress } from '../lib/dataMasking'

/**
 * MaskedText — 敏感資料遮蔽元件
 * 預設顯示遮蔽後的值，有權限的人可點擊查看完整值
 *
 * Props:
 * - value: 原始值
 * - type: 'phone' | 'email' | 'address'
 * - canReveal: boolean (是否有權查看)
 */
export default function MaskedText({ value, type = 'phone', canReveal = false }) {
  const [revealed, setRevealed] = useState(false)

  if (!value) return <span style={{ color: 'var(--text-muted)' }}>-</span>

  const getMasked = () => {
    switch (type) {
      case 'phone': return maskPhone(value)
      case 'email': return maskEmail(value)
      case 'address': return maskAddress(value)
      default: return value
    }
  }

  const displayValue = revealed ? value : getMasked()

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: type === 'phone' ? 'monospace' : 'inherit' }}>
        {displayValue}
      </span>
      {canReveal && !revealed && (
        <button
          onClick={(e) => { e.stopPropagation(); setRevealed(true) }}
          title="查看完整內容"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--accent-cyan)', padding: 2, display: 'flex',
          }}
        >
          <Eye size={13} />
        </button>
      )}
      {canReveal && revealed && (
        <button
          onClick={(e) => { e.stopPropagation(); setRevealed(false) }}
          title="隱藏"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 2, display: 'flex',
          }}
        >
          <EyeOff size={13} />
        </button>
      )}
    </span>
  )
}
