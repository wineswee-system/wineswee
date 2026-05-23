import { useState, useEffect, useMemo } from 'react'
import { ChevronDown, X, Check } from 'lucide-react'
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
          group: t.scope === 'business_expense' ? '費用' : '非費用',
        }))
        setOptions([
          { form_type: 'expense_request', form_template_id: null, label: '申請費用', group: '費用' },
          { form_type: 'expense',         form_template_id: null, label: '費用報銷', group: '費用' },
          ...customForms,
        ])
      })
  }, [])

  // 關閉外部點擊
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!e.target.closest?.('.fbp-wrapper')) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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

  // 分群
  const grouped = useMemo(() => {
    const m = new Map()
    for (const o of options) {
      if (!m.has(o.group)) m.set(o.group, [])
      m.get(o.group).push(o)
    }
    return [...m.entries()]
  }, [options])

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
          <button type="button" onClick={() => setOpen(o => !o)}
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

      {/* 下拉選單 */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
          minWidth: 240, maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
          borderRadius: 8, boxShadow: 'var(--shadow-xl, 0 8px 24px rgba(0,0,0,0.15))',
        }}>
          {options.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              載入中或無可用表單
            </div>
          ) : (
            grouped.map(([groupName, items]) => (
              <div key={groupName}>
                <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-secondary)' }}>
                  {groupName}
                </div>
                {items.map(o => {
                  const sel = isSelected(o)
                  const locked = lockedKeys.includes(keyOf(o))
                  return (
                    <div key={keyOf(o)} onClick={() => toggle(o)}
                      style={{
                        padding: '8px 12px', cursor: locked ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: sel ? 'var(--accent-cyan-dim)' : 'transparent',
                        opacity: locked ? 0.6 : 1,
                        fontSize: 13,
                      }}>
                      <span>{locked && '🔒 '}{o.label}</span>
                      {sel && <Check size={14} style={{ color: 'var(--accent-cyan)' }} />}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
