import { useState, useEffect } from 'react'
import { Type } from 'lucide-react'
import { getFontScale, setFontScale, FONT_SCALE_LIMITS } from '../lib/fontScale'

export default function FontSizeControl() {
  const [scale, setScale] = useState(getFontScale())

  useEffect(() => {
    setScale(getFontScale())
  }, [])

  const bump = (delta) => {
    const next = Math.round((scale + delta) * 100) / 100
    setScale(setFontScale(next))
  }
  const reset = () => setScale(setFontScale(FONT_SCALE_LIMITS.DEFAULT))

  const atMin = scale <= FONT_SCALE_LIMITS.MIN + 0.001
  const atMax = scale >= FONT_SCALE_LIMITS.MAX - 0.001

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '6px 8px',
      borderRadius: 8,
      background: 'var(--bg-secondary)',
      fontSize: 11,
    }}>
      <Type size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <button
        onClick={() => bump(-FONT_SCALE_LIMITS.STEP)}
        disabled={atMin}
        title="縮小字體"
        style={btn(atMin)}
      >A-</button>
      <button
        onClick={reset}
        title="重設字體大小"
        style={{ ...btn(false), minWidth: 36 }}
      >{Math.round(scale * 100)}%</button>
      <button
        onClick={() => bump(FONT_SCALE_LIMITS.STEP)}
        disabled={atMax}
        title="放大字體"
        style={btn(atMax)}
      >A+</button>
    </div>
  )
}

const btn = (disabled) => ({
  padding: '3px 6px',
  borderRadius: 6,
  border: '1px solid var(--border-medium)',
  background: 'var(--bg-card)',
  color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
  fontSize: 11,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
})
