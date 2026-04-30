import { useState, useEffect } from 'react'
import { Minus, Plus } from 'lucide-react'
import { getFontScale, setFontScale, FONT_SCALE_LIMITS } from '../lib/fontScale'

// 緊湊版：2 顆小按鈕，塞進 sidebar 底部 user 列旁邊。
// 雙擊 A 字 → 重設回預設
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <button
        onClick={() => bump(-FONT_SCALE_LIMITS.STEP)}
        onDoubleClick={reset}
        disabled={atMin}
        title={`縮小字體（目前 ${Math.round(scale * 100)}%，雙擊重設）`}
        style={btn(atMin)}
      >
        <Minus size={12} />
      </button>
      <button
        onClick={() => bump(FONT_SCALE_LIMITS.STEP)}
        onDoubleClick={reset}
        disabled={atMax}
        title={`放大字體（目前 ${Math.round(scale * 100)}%，雙擊重設）`}
        style={btn(atMax)}
      >
        <Plus size={12} />
      </button>
    </div>
  )
}

const btn = (disabled) => ({
  width: 22, height: 22, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 4,
  border: '1px solid var(--border-medium)',
  background: 'var(--bg-card)',
  color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
})
