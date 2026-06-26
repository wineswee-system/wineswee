import { Search } from 'lucide-react'

export default function POSProductGrid({
  search,
  setSearch,
  barcodeInput,
  setBarcodeInput,
  handleBarcodeSubmit,
  filtered,
  addToCart,
  loading,
  combos = [],
  onComboClick = () => {},
  itemVariants = {},
  onVariantClick = () => {},
  onAddItem = null,
}) {
  return (
    <div style={{ flex: '1 1 55%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Barcode scanner input */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ padding: '12px 16px' }}>
          <form onSubmit={handleBarcodeSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="form-input"
              placeholder="掃描條碼或輸入商品名稱..."
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px' }}>加入</button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🛒</span> 商品選擇</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋商品..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div style={{ padding: 16 }}>
          {combos.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                            marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                套餐
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {combos.map(combo => (
                  <button
                    key={combo.id}
                    onClick={() => onComboClick(combo)}
                    style={{
                      textAlign: 'left', padding: '10px 12px',
                      background: 'var(--accent-purple-dim)',
                      border: '1px solid var(--accent-purple)',
                      borderRadius: 10, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', gap: 4
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {combo.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--accent-purple)', fontWeight: 500 }}>
                      NT${combo.price}
                    </div>
                    <div style={{ fontSize: 10, background: 'var(--accent-purple)', color: '#fff',
                                  borderRadius: 4, padding: '1px 5px', alignSelf: 'flex-start' }}>
                      套餐
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
            {loading && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>載入商品中…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無商品</div>
            )}
            {!loading && filtered.map(p => {
              const hasVariants = itemVariants[p.id]?.length > 0
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    if (hasVariants) {
                      onVariantClick(p, itemVariants[p.id])
                    } else if (onAddItem) {
                      onAddItem(p)
                    } else {
                      addToCart(p)
                    }
                  }}
                  style={{
                    position: 'relative',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 10,
                    padding: 14,
                    cursor: 'pointer',
                    textAlign: 'center',
                    background: 'var(--bg-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-cyan)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.transform = 'none' }}
                >
                  {hasVariants && (
                    <span style={{
                      position: 'absolute', top: 4, right: 4,
                      fontSize: 9, background: 'var(--accent-cyan-dim)',
                      color: 'var(--accent-cyan)', borderRadius: 4,
                      padding: '1px 4px', fontWeight: 600
                    }}>
                      選項
                    </span>
                  )}
                  <div style={{ width: 48, height: 48, borderRadius: 8, background: 'var(--bg-tertiary)', margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                    {p.category === '飲品' ? '☕' : p.category === '甜點' ? '🍰' : '🥗'}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.name}</div>
                  <div style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: 14 }}>NT$ {p.price}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.category}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
