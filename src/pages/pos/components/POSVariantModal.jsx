import { useState, useMemo } from 'react'
import { X, Plus, Minus } from 'lucide-react'

export default function POSVariantModal({ item, variantGroups, onAdd, onClose }) {
  // selections: required group → optionId (string|null), optional group → Set of optionIds
  const [selections, setSelections] = useState(() => {
    const init = {}
    variantGroups.forEach(g => { init[g.id] = g.is_required ? null : new Set() })
    return init
  })
  const [qty, setQty] = useState(1)

  function toggleOption(group, optionId) {
    setSelections(prev => {
      const next = { ...prev }
      if (group.is_required) {
        next[group.id] = optionId
      } else {
        const s = new Set(prev[group.id])
        s.has(optionId) ? s.delete(optionId) : s.add(optionId)
        next[group.id] = s
      }
      return next
    })
  }

  const isValid = useMemo(
    () => variantGroups.every(g => !g.is_required || selections[g.id] != null),
    [variantGroups, selections]
  )

  const { totalDelta, selectedLabels, variantSelections } = useMemo(() => {
    let delta = 0
    const labels = []
    const vsels = []
    variantGroups.forEach(g => {
      const sel = selections[g.id]
      const ids = g.is_required ? (sel != null ? [sel] : []) : [...sel]
      ids.forEach(oid => {
        const opt = g.options.find(o => o.id === oid)
        if (!opt) return
        delta += opt.price_delta || 0
        labels.push(opt.label)
        vsels.push({ group_name: g.group_name, label: opt.label, price_delta: opt.price_delta || 0 })
      })
    })
    return { totalDelta: delta, selectedLabels: labels, variantSelections: vsels }
  }, [variantGroups, selections])

  const totalPrice = (item.unit_price + totalDelta) * qty

  function handleAdd() {
    if (!isValid) return
    const variantKey = variantSelections.map(v => `${v.group_name}:${v.label}`).join('|')
    const nameSuffix = selectedLabels.length > 0 ? ` (${selectedLabels.join(', ')})` : ''
    onAdd({
      id: item.id + '_' + (variantKey || 'base'),
      name: item.name + nameSuffix,
      price: item.unit_price + totalDelta,
      qty,
      variantSelections,
      _baseItemId: item.id,
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-primary)',
          borderRadius: 14,
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{item.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              NT${item.unit_price.toLocaleString()} 基本價
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, flexShrink: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Variant groups */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {variantGroups.map(g => (
            <div key={g.id} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{g.group_name}</span>
                {g.is_required && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                    background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
                  }}>
                    必選
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {g.options.map(opt => {
                  const isSelected = g.is_required
                    ? selections[g.id] === opt.id
                    : selections[g.id]?.has(opt.id)
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleOption(g, opt.id)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        fontSize: 13,
                        cursor: 'pointer',
                        border: isSelected ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-primary)',
                        background: isSelected ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                        color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)',
                        fontWeight: isSelected ? 700 : 400,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        minWidth: 72,
                      }}
                    >
                      <span>{opt.label}</span>
                      <span style={{ fontSize: 11, color: isSelected ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                        {opt.price_delta > 0 ? `+NT$${opt.price_delta}` : '免費'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border-primary)' }} />

        {/* Qty + price + actions */}
        <div style={{ padding: '14px 20px', background: 'var(--bg-secondary)', borderRadius: '0 0 14px 14px' }}>
          {/* Qty selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>數量</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => setQty(q => Math.max(1, q - 1))}
                style={{
                  background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                  borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: 'var(--text-primary)',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Minus size={14} />
              </button>
              <span style={{ fontWeight: 700, fontSize: 16, minWidth: 28, textAlign: 'center' }}>{qty}</span>
              <button
                onClick={() => setQty(q => Math.min(20, q + 1))}
                style={{
                  background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                  borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: 'var(--text-primary)',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Price summary */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 6, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              NT${item.unit_price}{totalDelta !== 0 ? ` + ${totalDelta}` : ''} × {qty} =
            </span>
            <span style={{ fontWeight: 800, fontSize: 22, color: 'var(--accent-cyan)' }}>
              NT${totalPrice.toLocaleString()}
            </span>
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 600,
                border: '1px solid var(--border-primary)', background: 'var(--bg-primary)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              disabled={!isValid}
              title={!isValid ? '請完成所有必選項目' : undefined}
              style={{
                flex: 2, padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 700,
                border: 'none',
                background: isValid ? 'var(--accent-cyan)' : 'var(--bg-hover)',
                color: isValid ? '#fff' : 'var(--text-muted)',
                cursor: isValid ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              加入購物車
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
