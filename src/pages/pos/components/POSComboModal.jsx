import { useState } from 'react'
import { X, Minus, Plus } from 'lucide-react'

export default function POSComboModal({ combo, onAdd, onClose }) {
  const [qty, setQty] = useState(1)

  function handleAdd() {
    onAdd({
      id: combo.id,
      name: combo.name,
      price: combo.price * qty,
      qty,
      isCombo: true,
      comboItems: combo.items,
      _basePrice: combo.price,
    })
    onClose()
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
          borderRadius: 14,
          border: '1px solid var(--border-primary)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-primary)',
        }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{combo.name}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {combo.description && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {combo.description}
            </p>
          )}

          {/* Combo items list */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              套餐內容:
            </div>
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              border: '1px solid var(--border-primary)',
              overflow: 'hidden',
            }}>
              {combo.items.map((item, idx) => (
                <div
                  key={item.menu_item_id ?? idx}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 14px',
                    borderBottom: idx < combo.items.length - 1 ? '1px solid var(--border-primary)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)' }}>
                    <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: 11 }}>•</span>
                    <span>{item.quantity}x {item.name}</span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>NT${item.unit_price}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-primary)' }} />

          {/* Qty selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>數量</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => setQty(q => Math.max(1, q - 1))}
                disabled={qty <= 1}
                style={{
                  background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                  borderRadius: 7, padding: '5px 10px', cursor: qty <= 1 ? 'not-allowed' : 'pointer',
                  color: qty <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Minus size={14} />
              </button>
              <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                {qty}
              </span>
              <button
                onClick={() => setQty(q => Math.min(20, q + 1))}
                disabled={qty >= 20}
                style={{
                  background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                  borderRadius: 7, padding: '5px 10px', cursor: qty >= 20 ? 'not-allowed' : 'pointer',
                  color: qty >= 20 ? 'var(--text-muted)' : 'var(--text-primary)',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Price total */}
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>
              NT${(combo.price * qty).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Action row */}
        <div style={{
          display: 'flex', gap: 10,
          padding: '12px 18px',
          borderTop: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 600,
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={handleAdd}
            style={{
              flex: 2, padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 700,
              border: 'none',
              background: 'var(--accent-cyan)',
              color: '#fff', /* inverse text on accent bg */
              cursor: 'pointer',
            }}
          >
            加入購物車
          </button>
        </div>
      </div>
    </div>
  )
}
