import { useState, useRef, useEffect, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, ChevronDown, Check } from 'lucide-react'

/**
 * SearchableSelect — drop-in replacement for <select> with built-in search.
 *
 * Props:
 *   value      — current selected value (string|number|null)
 *   onChange   — (value, option) => void
 *   options    — Array<{ value, label, sublabel?, disabled? }>
 *   placeholder — string, default '請選擇'
 *   disabled   — bool
 *   clearable  — bool, show ✕ to clear (default true)
 *   style      — wrapper style
 *   emptyText  — string when no match
 *
 * Use empOptions(employees) helper to map employees → options shape.
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = '請選擇',
  disabled = false,
  clearable = true,
  style = {},
  emptyText = '找不到符合的項目',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0, width: 0 })
  const wrapperRef = useRef(null)
  const triggerRef = useRef(null)
  const popupRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const selected = useMemo(
    () => options.find(o => String(o.value) === String(value)) || null,
    [options, value]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => {
      const hay = `${o.label || ''} ${o.sublabel || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [options, query])

  // Close on outside click (popup is portaled — check both wrapper and popup)
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      const inWrapper = wrapperRef.current?.contains(e.target)
      const inPopup = popupRef.current?.contains(e.target)
      if (!inWrapper && !inPopup) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Compute popup position when opened, and reposition on scroll/resize
  useEffect(() => {
    if (!open) return
    const updatePos = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPopupPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open])

  // Reset highlight when filter changes
  useEffect(() => { setHighlight(0) }, [query, open])

  // Scroll highlighted into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlight]
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const choose = (opt) => {
    if (opt?.disabled) return
    onChange?.(opt ? opt.value : null, opt)
    setOpen(false)
    setQuery('')
  }

  const handleKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      e.preventDefault()
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') { setHighlight(h => Math.min(h + 1, filtered.length - 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setHighlight(h => Math.max(h - 1, 0)); e.preventDefault() }
    else if (e.key === 'Enter') { if (filtered[highlight]) choose(filtered[highlight]); e.preventDefault() }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  return (
    <div
      ref={wrapperRef}
      className={`searchable-select ${className}`}
      style={{ position: 'relative', width: '100%', ...style }}
    >
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={() => { if (!disabled) { setOpen(o => !o); setTimeout(() => inputRef.current?.focus(), 0) } }}
        className="form-input"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1, paddingRight: 8, minHeight: 36,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selected ? (
            <>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.label}</span>
              {selected.sublabel && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selected.sublabel}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>
          )}
        </div>
        {clearable && selected && !disabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); choose(null) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)' }}
            title="清除"
          >
            <X size={14} />
          </button>
        )}
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </div>

      {/* Dropdown — portaled to body so parent overflow:hidden doesn't clip */}
      {open && createPortal(
        <div
          ref={popupRef}
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            width: Math.max(popupPos.width, 240),
            zIndex: 11000,
            background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
            borderRadius: 10, boxShadow: 'var(--shadow-xl)',
            maxHeight: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          {/* Search input */}
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜尋..."
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontSize: 13,
              }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{filtered.length}/{options.length}</span>
          </div>

          {/* List */}
          <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{emptyText}</div>
            ) : (() => {
              // 偵測是否要分群
              const hasGroups = filtered.some(o => o.group)
              if (!hasGroups) {
                return filtered.map((opt, idx) => renderItem(opt, idx, value, highlight, choose, setHighlight))
              }
              // 分群渲染（保留原 idx 在 filtered 中的位置給鍵盤導覽用）
              const groupMap = new Map()
              filtered.forEach((opt, idx) => {
                const g = opt.group || '未分類'
                if (!groupMap.has(g)) groupMap.set(g, [])
                groupMap.get(g).push({ opt, idx })
              })
              return [...groupMap.entries()].map(([groupName, items], gi) => (
                <Fragment key={groupName}>
                  <div style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 700,
                    color: 'var(--text-muted)',
                    background: 'var(--bg-secondary)',
                    borderTop: gi === 0 ? 'none' : '1px solid var(--border-medium)',
                    letterSpacing: '0.3px',
                  }}>
                    {groupName} <span style={{ opacity: 0.6, fontWeight: 400 }}>· {items.length}</span>
                  </div>
                  {items.map(({ opt, idx }) => renderItem(opt, idx, value, highlight, choose, setHighlight))}
                </Fragment>
              ))
            })()}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// 共用的列表項渲染（保持鍵盤 idx 一致）
function renderItem(opt, idx, value, highlight, choose, setHighlight) {
  const isSel = String(opt.value) === String(value)
  const isHi = idx === highlight
  return (
    <div
      key={opt.value ?? `i${idx}`}
      onClick={() => choose(opt)}
      onMouseEnter={() => setHighlight(idx)}
      style={{
        padding: '8px 12px', cursor: opt.disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 8,
        background: isHi ? 'var(--glass-light)' : 'transparent',
        opacity: opt.disabled ? 0.5 : 1,
        borderLeft: isSel ? '2px solid var(--accent-cyan)' : '2px solid transparent',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {opt.label}
        </div>
        {opt.sublabel && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {opt.sublabel}
          </div>
        )}
      </div>
      {isSel && <Check size={13} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />}
    </div>
  )
}

/**
 * Helper: 把 employees 陣列轉成 SearchableSelect 的 options 格式
 * 顯示一條：名字 (英文) 職稱
 * 自動依「部門 / 門市」分群（group 欄位）
 *
 * @param employees - 員工陣列
 * @param opts.keyBy - 'id' (預設) 或 'name'，決定 option.value 用哪個欄位
 *                    - 'id' → 適合直接寫 employee_id 的表單（簽核鏈/離職單等）
 *                    - 'name' → 適合舊欄位用 employee 名字字串的表單（補登/任務指派等）
 */
export function empOptions(employees = [], opts = {}) {
  const keyBy = opts.keyBy || 'id'
  return employees.map(e => {
    const parts = [e.name]
    if (e.name_en) parts.push(`(${e.name_en})`)
    if (e.position) parts.push(e.position)
    const storeName = e.store || e.stores?.name
    const deptName  = e.dept  || e.departments?.name
    const group = storeName ? `🏪 ${storeName}` : (deptName ? `🏢 ${deptName}` : '未分類')
    return {
      value: keyBy === 'name' ? e.name : e.id,
      label: parts.join(' '),
      group,
    }
  })
}
