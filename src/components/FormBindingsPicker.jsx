import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X, Check, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'

/**
 * 綁定表單下拉選擇器 — 多選 dropdown，已選顯示為 chip
 *
 * Props:
 *   value     — Array<{form_type, form_template_id, label}>  目前綁定
 *   onChange  — (next) => void
 *   readonly  — bool  唯讀（不顯示加入下拉）
 *   lockedIds — Array<string>  已填過的 binding key（不可移除）
 *
 * 用法：
 *   <FormBindingsPicker value={form.required_forms} onChange={v => set('required_forms', v)} />
 */
export default function FormBindingsPicker({ value = [], onChange, readonly = false, lockedKeys = [] }) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState([])
  const [query, setQuery] = useState('')
  const triggerRef = useRef(null)
  const popupRef = useRef(null)
  const searchRef = useRef(null)
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0, minWidth: 320, flipUp: false })

  useEffect(() => {
    supabase.from('form_templates')
      .select('id, name, scope')
      .eq('is_active', true)
      .in('scope', ['business_expense', 'business_non_expense'])
      .order('name')
      .then(({ data }) => {
        const customForms = (data || []).map(t => ({
          form_type: 'form_submission',
          form_template_id: t.id,
          label: t.name,
          icon: '📋',
          group: t.scope === 'business_expense' ? '費用' : '非費用',
        }))
        setOptions([
          { form_type: 'expense_request', form_template_id: null, icon: '🧾', label: '申請費用', group: '費用' },
          { form_type: 'expense',         form_template_id: null, icon: '💸', label: '費用報銷', group: '費用' },
          { form_type: 'store_audit',     form_template_id: null, icon: '🏪', label: '門市稽核', group: '非費用' },
          { form_type: 'goods_transfer',  form_template_id: null, icon: '📦', label: '商品調撥', group: '非費用' },
          ...customForms,
        ])
      })
  }, [])

  // 關閉外部點擊（含 portal 內）
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      const inWrapper = triggerRef.current?.contains(e.target)
      const inPopup = popupRef.current?.contains(e.target)
      if (!inWrapper && !inPopup) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 動態追 trigger 位置（含 #root zoom 補償）+ 上下空間自動翻轉
  useLayoutEffect(() => {
    if (!open) return
    let raf = 0
    const tick = () => {
      const el = triggerRef.current
      if (!el) { raf = requestAnimationFrame(tick); return }
      const rect = el.getBoundingClientRect()
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-font-scale')) || 1
      const viewportH = window.innerHeight / scale
      const triggerTop = rect.top / scale
      const triggerBottom = rect.bottom / scale
      const spaceBelow = viewportH - triggerBottom
      const spaceAbove = triggerTop
      // 量目前 popup 實際高度（首 frame 還沒 render 時用估計值 420）
      const pop = popupRef.current
      const popHeight = pop ? pop.getBoundingClientRect().height / scale : 420
      // 下方放不下 + 上方空間更多 → 翻到上面
      const flipUp = spaceBelow < popHeight + 8 && spaceAbove > spaceBelow

      let top = flipUp ? triggerTop - popHeight - 4 : triggerBottom + 4
      let left = rect.left / scale

      // 補償祖先 transform 造成的 offset
      if (pop) {
        const pr = pop.getBoundingClientRect()
        const styleTop = parseFloat(pop.style.top) || 0
        const styleLeft = parseFloat(pop.style.left) || 0
        const offY = pr.top / scale - styleTop
        const offX = pr.left / scale - styleLeft
        if (Math.abs(offY) > 0.5) top -= offY
        if (Math.abs(offX) > 0.5) left -= offX
      }
      setPopupPos(p => (p.top === top && p.left === left && p.flipUp === flipUp ? p
        : { top, left, minWidth: Math.max(rect.width / scale, 320), flipUp }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])

  const keyOf = (o) => `${o.form_type}-${o.form_template_id ?? 'null'}`
  const isSelected = (o) => value.some(v => keyOf(v) === keyOf(o))

  const toggle = (o) => {
    if (readonly) return
    const k = keyOf(o)
    if (lockedKeys.includes(k)) return  // 鎖定的不能改
    if (isSelected(o)) {
      onChange?.(value.filter(v => keyOf(v) !== k))
    } else {
      onChange?.([...value, { form_type: o.form_type, form_template_id: o.form_template_id, label: o.label }])
    }
  }

  // 套用搜尋 filter
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => `${o.label} ${o.group}`.toLowerCase().includes(q))
  }, [options, query])

  // 分群
  const grouped = useMemo(() => {
    const m = new Map()
    for (const o of filteredOptions) {
      if (!m.has(o.group)) m.set(o.group, [])
      m.get(o.group).push(o)
    }
    return [...m.entries()]
  }, [filteredOptions])

  // 打開時 reset query + focus 搜尋
  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }, [open])

  return (
    <div className="fbp-wrapper" style={{ position: 'relative' }}>
      {/* 已選 chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 32 }}>
        {value.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚未綁定任何表單</span>
        )}
        {value.map(v => {
          const k = keyOf(v)
          const locked = lockedKeys.includes(k)
          return (
            <span key={k} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 8px 4px 10px', borderRadius: 14,
              background: locked ? 'var(--accent-green-dim)' : 'var(--accent-cyan-dim)',
              color: locked ? 'var(--accent-green)' : 'var(--accent-cyan)',
              fontSize: 12, fontWeight: 600,
              border: `1px solid ${locked ? 'var(--accent-green)' : 'var(--accent-cyan)'}`,
            }}>
              {locked && '🔒 '}
              {v.label}
              {!readonly && !locked && (
                <button type="button" onClick={() => toggle(v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, display: 'inline-flex' }}>
                  <X size={12} />
                </button>
              )}
            </span>
          )
        })}
        {!readonly && (
          <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)}
            style={{
              padding: '5px 12px', borderRadius: 14, border: '1px dashed var(--border-medium)',
              background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: 12, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
            + 加入綁定 <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </button>
        )}
      </div>

      {/* 下拉選單 — portal 到 body 避免被父層 overflow 遮住 */}
      {open && createPortal(
        <div ref={popupRef} style={{
          position: 'fixed', top: popupPos.top, left: popupPos.left,
          minWidth: popupPos.minWidth, maxHeight: 420, zIndex: 11000,
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
          borderRadius: 8, boxShadow: 'var(--shadow-xl, 0 8px 24px rgba(0,0,0,0.15))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* 搜尋框 — 表單變多時方便找 */}
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder={`搜尋表單（共 ${options.length} 張）`}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13 }} />
            {query && (
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: 'var(--accent-cyan)', background: 'var(--bg-secondary)',
                padding: '2px 6px', borderRadius: 6, flexShrink: 0,
              }}>{filteredOptions.length}/{options.length}</span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
          {options.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              載入中或無可用表單
            </div>
          ) : filteredOptions.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              找不到符合「{query}」的表單
            </div>
          ) : (
            grouped.map(([groupName, items]) => (
              <div key={groupName}>
                <div style={{
                  padding: '8px 14px', fontSize: 11, fontWeight: 700,
                  color: 'var(--text-muted)', background: 'var(--bg-secondary)',
                  letterSpacing: '0.5px', textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span>{groupName}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '1px 7px',
                    borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-muted)',
                  }}>{items.length}</span>
                </div>
                {items.map(o => {
                  const sel = isSelected(o)
                  const locked = lockedKeys.includes(keyOf(o))
                  return (
                    <div key={keyOf(o)} onClick={() => toggle(o)}
                      style={{
                        padding: '10px 14px', cursor: locked ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: sel ? 'var(--accent-cyan-dim)' : 'transparent',
                        opacity: locked ? 0.6 : 1,
                        fontSize: 14,
                        transition: 'background .12s ease',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                      onMouseEnter={(e) => { if (!sel && !locked) e.currentTarget.style.background = 'var(--bg-secondary)' }}
                      onMouseLeave={(e) => { if (!sel && !locked) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        {o.icon && <span style={{ fontSize: 18, lineHeight: 1 }}>{o.icon}</span>}
                        {locked && '🔒 '}
                        <span style={{ color: 'var(--text-primary)', fontWeight: sel ? 700 : 500 }}>{o.label}</span>
                      </span>
                      {sel && <Check size={16} style={{ color: 'var(--accent-cyan)' }} />}
                    </div>
                  )
                })}
              </div>
            ))
          )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
