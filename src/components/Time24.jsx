import { useState, useEffect, useRef } from 'react'
import { Clock } from 'lucide-react'

// 共用 24 小時制時間選擇：可直接打數字(自動補冒號) 或 點開選 時/分。
// 不用原生 <input type="time">（顯示 12h/24h 吃 OS 語系，無法強制 24h）。
// props: value('HH:MM'), onChange(回字串), style(套到外層 wrapper，給 flex 排版用)
const HH = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MM = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
function fmtTime24(raw) {
  const d = String(raw).replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d
}

export default function Time24({ value, onChange, style, placeholder = '例 15:00', className = 'form-input' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const [hh = '', mm = ''] = (value || '').split(':')
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const colStyle = { maxHeight: 180, overflowY: 'auto', flex: 1 }
  const cell = (sel) => ({
    padding: '6px 0', textAlign: 'center', cursor: 'pointer', fontSize: 13,
    fontWeight: sel ? 700 : 400,
    background: sel ? 'var(--accent-cyan-dim)' : 'transparent',
    color: sel ? 'var(--accent-cyan)' : 'var(--text-secondary)',
  })
  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <input className={className} type="text" inputMode="numeric" placeholder={placeholder} maxLength={5}
        style={{ width: '100%', paddingRight: 28 }}
        value={value || ''} onChange={e => onChange(fmtTime24(e.target.value))} onFocus={() => setOpen(true)} />
      <Clock size={13} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4, display: 'flex',
          background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', overflow: 'hidden', minWidth: 110,
        }}>
          <div style={{ ...colStyle, borderRight: '1px solid var(--border-light)' }}>
            {HH.map(h => <div key={h} style={cell(h === hh)} onMouseDown={e => e.preventDefault()} onClick={() => onChange(`${h}:${mm || '00'}`)}>{h}</div>)}
          </div>
          <div style={colStyle}>
            {MM.map(m => <div key={m} style={cell(m === mm)} onMouseDown={e => e.preventDefault()} onClick={() => { onChange(`${hh || '00'}:${m}`); setOpen(false) }}>{m}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}
