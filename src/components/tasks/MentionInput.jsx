import { useState, useRef } from 'react'
import { extractMentionNames, renderMentionsHTML } from '../../lib/mentions'

// Textarea with @mention autocomplete.
export default function MentionInput({ value, onChange, employees = [], onSubmit, placeholder = '新增留言 (使用 @ 提及同事)', disabled }) {
  const taRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [menuStart, setMenuStart] = useState(-1)

  const handleChange = (e) => {
    const v = e.target.value
    onChange(v)
    const pos = e.target.selectionStart
    const upto = v.slice(0, pos)
    const atIdx = upto.lastIndexOf('@')
    if (atIdx >= 0) {
      const after = upto.slice(atIdx + 1)
      if (/^[\p{L}\p{N}_\-.]*$/u.test(after) && (atIdx === 0 || /\s|^/.test(upto[atIdx - 1] || ''))) {
        setMenuQuery(after.toLowerCase())
        setMenuOpen(true)
        setMenuStart(atIdx)
        const rect = taRef.current?.getBoundingClientRect()
        if (rect) {
          const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-font-scale')) || 1
          setMenuPos({ top: rect.bottom / scale + 4, left: rect.left / scale })
        }
        return
      }
    }
    setMenuOpen(false)
  }

  const insert = (name) => {
    if (menuStart < 0) return
    const before = value.slice(0, menuStart)
    const after = value.slice(taRef.current?.selectionStart ?? value.length)
    const next = `${before}@${name} ${after}`
    onChange(next)
    setMenuOpen(false)
    setTimeout(() => {
      taRef.current?.focus()
      const caret = before.length + name.length + 2
      taRef.current?.setSelectionRange(caret, caret)
    }, 0)
  }

  const suggestions = employees
    .filter(e => !menuQuery || e.name?.toLowerCase().includes(menuQuery))
    .slice(0, 6)

  const mentionedNames = extractMentionNames(value)

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef} value={value} onChange={handleChange} disabled={disabled}
        placeholder={placeholder}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit?.() }
          if (e.key === 'Escape') setMenuOpen(false)
        }}
        style={{
          width: '100%', minHeight: 60, resize: 'vertical', fontSize: 13,
          padding: 10, borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--bg-main)', color: 'var(--text-primary)',
          fontFamily: 'inherit',
        }}
      />
      {mentionedNames.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
          將通知：{mentionedNames.map(n => {
            const emp = employees.find(e => e.name === n)
            return emp
              ? <span key={n} style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>@{n}  </span>
              : <span key={n} style={{ color: 'var(--text-muted)' }}>@{n}（未找到）  </span>
          })}
        </div>
      )}
      {menuOpen && suggestions.length > 0 && (
        <div style={{
          position: 'fixed', top: menuPos.top, left: menuPos.left,
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          zIndex: 1000, minWidth: 200, maxHeight: 220, overflowY: 'auto',
        }}>
          {suggestions.map(e => (
            <div
              key={e.id}
              onMouseDown={(ev) => { ev.preventDefault(); insert(e.name) }}
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border-subtle)' }}
              onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--glass-light)'}
              onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
            >
              <div style={{ fontWeight: 600 }}>{e.name}</div>
              {e.dept && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{e.dept}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MentionText({ content, employees }) {
  return (
    <span
      dangerouslySetInnerHTML={{ __html: renderMentionsHTML(content, employees) }}
    />
  )
}
