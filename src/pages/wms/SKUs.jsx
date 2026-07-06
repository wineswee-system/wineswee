import { useState, useEffect } from 'react'
import { Plus, Search, Barcode } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import BarcodeManagerModal from './components/BarcodeManagerModal'
import { useOrgId } from '../../contexts/AuthContext'

const CATEGORIES = ['食品', '飲料', '電子', '服飾', '家居', '美妝', '文具', '其他']
const COSTING_METHODS = [
  { value: 'FIFO', label: 'FIFO 先進先出' },
  { value: 'WEIGHTED_AVG', label: '加權平均' },
  { value: 'MOVING_AVG', label: '移動平均' },
]

// 分類對應的變體屬性模板
const VARIANT_TEMPLATES = {
  '服飾': ['顏色', '尺寸'],
  '電子': ['容量', '顏色'],
  '食品': ['口味', '規格'],
  '飲料': ['口味', '容量'],
  '家居': ['顏色', '材質'],
  '美妝': ['色號', '容量'],
}

function generateBarcode() {
  // Generate EAN-13 style barcode
  const prefix = '471' // Taiwan prefix
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('')
  const raw = prefix + digits
  // Calculate check digit
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += parseInt(raw[i]) * (i % 2 === 0 ? 1 : 3)
  }
  const check = (10 - (sum % 10)) % 10
  return raw + check
}

function BarcodeVisual({ code }) {
  if (!code) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 3, fontWeight: 600, color: 'var(--text-secondary)' }}>
        |||&nbsp;{code}&nbsp;|||
      </div>
    </div>
  )
}

export default function SKUs() {
  const orgId = useOrgId()
  const [skus, setSkus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showBarcodeModal, setShowBarcodeModal] = useState(null) // 條碼管理中的 SKU（F-C4）
  const [showVariantModal, setShowVariantModal] = useState(null)
  const [variantForm, setVariantForm] = useState({ attributes: {}, variants: [] })
  const [viewMode, setViewMode] = useState('all') // 'all', 'parents', 'variants'
  const [form, setForm] = useState({
    code: '', name: '', barcode: '', unit: '件', weight: '', length: '', width: '', height: '',
    category: CATEGORIES[0], costing_method: 'WEIGHTED_AVG', unit_cost: '',
    purchase_uom: '', purchase_uom_qty: 1,
  })

  useEffect(() => {
    supabase.from('skus').select('*').order('id').then(({ data }) => { setSkus(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.code || !form.name) return
    const submitData = {
      ...form,
      status: '啟用',
      barcode: form.barcode || generateBarcode(),
      unit_cost: form.unit_cost ? Number(form.unit_cost) : 0,
      purchase_uom: form.purchase_uom || null,
      purchase_uom_qty: form.purchase_uom && Number(form.purchase_uom_qty) > 1 ? Number(form.purchase_uom_qty) : 1,
    }
    const { data } = await supabase.from('skus').insert(submitData).select().single()
    if (data) {
      setSkus(prev => [...prev, data])
      setShowModal(false)
      setForm({
        code: '', name: '', barcode: '', unit: '件', weight: '', length: '', width: '', height: '',
        category: CATEGORIES[0], costing_method: 'WEIGHTED_AVG', unit_cost: '',
        purchase_uom: '', purchase_uom_qty: 1,
      })
    }
  }

  // 變體管理
  const openVariantManager = (sku) => {
    const attrs = VARIANT_TEMPLATES[sku.category] || ['顏色', '尺寸']
    const existing = skus.filter(s => s.parent_sku_id === sku.id)
    setVariantForm({
      attributes: Object.fromEntries(attrs.map(a => [a, ''])),
      variants: existing,
    })
    setShowVariantModal(sku)
  }

  const handleCreateVariant = async () => {
    if (!showVariantModal) return
    const parent = showVariantModal
    const attrs = variantForm.attributes
    const filledAttrs = Object.fromEntries(Object.entries(attrs).filter(([_, v]) => v))
    if (Object.keys(filledAttrs).length === 0) return

    const suffix = Object.values(filledAttrs).join('-')
    const variantCode = `${parent.code}-${suffix}`
    const variantName = `${parent.name} (${Object.entries(filledAttrs).map(([k, v]) => `${k}:${v}`).join(', ')})`

    const { data } = await supabase.from('skus').insert({
      code: variantCode,
      name: variantName,
      barcode: generateBarcode(),
      unit: parent.unit,
      category: parent.category,
      costing_method: parent.costing_method,
      unit_cost: parent.unit_cost,
      weight: parent.weight,
      length: parent.length,
      width: parent.width,
      height: parent.height,
      status: '啟用',
      parent_sku_id: parent.id,
      is_variant: true,
      variant_attributes: filledAttrs,
    }).select().single()

    if (data) {
      setSkus(prev => [...prev, data])
      setVariantForm(f => ({
        ...f,
        variants: [...f.variants, data],
        attributes: Object.fromEntries(Object.keys(f.attributes).map(k => [k, ''])),
      }))
    }
  }

  const filtered = skus
    .filter(s => {
      if (viewMode === 'parents') return !s.is_variant
      if (viewMode === 'variants') return s.is_variant
      return true
    })
    .filter(s => s.name?.includes(search) || s.code?.includes(search) || s.barcode?.includes(search))

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const totalValue = skus.reduce((sum, s) => sum + ((s.unit_cost || 0) * (s.stock_qty || 0)), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon">📋</span> 商品主檔</h2><p>SKU 品項資料管理</p></div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增商品</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總品項數</div><div className="stat-card-value">{skus.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用中</div><div className="stat-card-value">{skus.filter(s => s.status === '啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">停用</div><div className="stat-card-value">{skus.filter(s => s.status !== '啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">庫存總價值</div><div className="stat-card-value">${totalValue.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📦</span> 商品列表</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 2 }}>
              {[{ key: 'all', label: '全部' }, { key: 'parents', label: '主商品' }, { key: 'variants', label: '變體' }].map(v => (
                <button key={v.key} className={`btn ${viewMode === v.key ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setViewMode(v.key)}>{v.label}</button>
              ))}
            </div>
            <div className="search-bar">
              <Search className="search-icon" />
              <input type="text" placeholder="搜尋品號/品名/條碼..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>品號</th><th>品名</th><th>條碼</th><th>分類</th><th>基本單位</th><th>進貨單位</th><th>成本方法</th><th>單位成本</th><th>重量(kg)</th><th>材積(cm)</th><th>狀態</th><th>變體</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無商品資料</td></tr>}
              {filtered.map(s => {
                const variantCount = skus.filter(v => v.parent_sku_id === s.id).length
                const parentSku = s.parent_sku_id ? skus.find(p => p.id === s.parent_sku_id) : null
                return (
                  <tr key={s.id} style={s.is_variant ? { background: 'var(--glass-light)' } : undefined}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                      {s.is_variant && <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>↳</span>}
                      {s.code}
                    </td>
                    <td>
                      {s.name}
                      {s.variant_attributes && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {Object.entries(s.variant_attributes).map(([k, v]) => (
                            <span key={k} className="badge badge-neutral" style={{ marginRight: 4, fontSize: 10 }}>{k}: {v}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <BarcodeVisual code={s.barcode} />
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap' }}
                          title="條碼管理（一品多碼）" onClick={() => setShowBarcodeModal(s)}>
                          <Barcode size={11} /> 管理
                        </button>
                      </div>
                    </td>
                    <td><span className="badge badge-cyan">{s.category}</span></td>
                    <td>{s.unit}</td>
                    <td style={{ fontSize: 12 }}>
                      {s.purchase_uom && s.purchase_uom !== s.unit
                        ? <span><span style={{ fontWeight: 600 }}>{s.purchase_uom}</span><span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>×{s.purchase_uom_qty || 1}{s.unit}</span></span>
                        : <span style={{ color: 'var(--text-muted)' }}>-</span>
                      }
                    </td>
                    <td>
                      <span className="badge badge-info">
                        {COSTING_METHODS.find(m => m.value === s.costing_method)?.label || s.costing_method || '加權平均'}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {s.unit_cost != null ? `$${Number(s.unit_cost).toLocaleString()}` : '-'}
                    </td>
                    <td>{s.weight}</td>
                    <td style={{ fontSize: 12 }}>{s.length && `${s.length}x${s.width}x${s.height}`}</td>
                    <td><span className={`badge ${s.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}><span className="badge-dot"></span>{s.status}</span></td>
                    <td>
                      {!s.is_variant ? (
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openVariantManager(s)}>
                          {variantCount > 0 ? `${variantCount} 變體` : '+ 變體'}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {parentSku ? `← ${parentSku.code}` : '變體'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 條碼管理 Modal（F-C4 一品多碼） */}
      {showBarcodeModal && (
        <BarcodeManagerModal
          sku={showBarcodeModal}
          orgId={orgId}
          onClose={() => setShowBarcodeModal(null)}
        />
      )}

      {/* 變體管理 Modal */}
      {showVariantModal && (
        <Modal title={`變體管理 — ${showVariantModal.code} ${showVariantModal.name}`} onClose={() => setShowVariantModal(null)}>
          {/* 現有變體 */}
          {variantForm.variants.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'block' }}>現有變體</span>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>品號</th><th>屬性</th><th>狀態</th></tr></thead>
                  <tbody>
                    {variantForm.variants.map(v => (
                      <tr key={v.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.code}</td>
                        <td>{v.variant_attributes && Object.entries(v.variant_attributes).map(([k, val]) => (
                          <span key={k} className="badge badge-cyan" style={{ marginRight: 4, fontSize: 10 }}>{k}: {val}</span>
                        ))}</td>
                        <td><span className={`badge ${v.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}>{v.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* 新增變體 */}
          <div style={{ borderTop: '1px solid var(--glass-light)', paddingTop: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'block' }}>新增變體</span>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Object.keys(variantForm.attributes).length}, 1fr)`, gap: 8, marginBottom: 8 }}>
              {Object.entries(variantForm.attributes).map(([attr, val]) => (
                <Field key={attr} label={attr}>
                  <input className="form-input" style={{ width: '100%' }} placeholder={`如：紅/M/500ml`} value={val}
                    onChange={e => setVariantForm(f => ({ ...f, attributes: { ...f.attributes, [attr]: e.target.value } }))} />
                </Field>
              ))}
            </div>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={handleCreateVariant}>建立變體</button>
          </div>
        </Modal>
      )}

      {showModal && (
        <Modal title="新增商品" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="品號" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="SKU-001" value={form.code} onChange={e => set('code', e.target.value)} /></Field>
            <Field label="品名" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="商品名稱" value={form.name} onChange={e => set('name', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="條碼">
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" type="text" style={{ flex: 1 }} placeholder="EAN/UPC (留空自動產生)" value={form.barcode} onChange={e => set('barcode', e.target.value)} />
                <button type="button" className="btn btn-secondary" onClick={() => set('barcode', generateBarcode())} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  <Barcode size={12} /> 產生
                </button>
              </div>
            </Field>
            <Field label="分類"><select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="成本方法">
              <select className="form-input" style={{ width: '100%' }} value={form.costing_method} onChange={e => set('costing_method', e.target.value)}>
                {COSTING_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="單位成本"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.unit_cost} onChange={e => set('unit_cost', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Field label="基本單位"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="件" value={form.unit} onChange={e => set('unit', e.target.value)} /></Field>
            <Field label="重量(kg)"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0.5" value={form.weight} onChange={e => set('weight', e.target.value)} /></Field>
            <Field label="長(cm)"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="10" value={form.length} onChange={e => set('length', e.target.value)} /></Field>
            <Field label="寬(cm)"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="10" value={form.width} onChange={e => set('width', e.target.value)} /></Field>
          </div>
          <Field label="高(cm)"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="10" value={form.height} onChange={e => set('height', e.target.value)} /></Field>
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>進貨計量單位（Multi-UOM）</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="進貨單位">
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="箱（留空=同基本單位）" value={form.purchase_uom} onChange={e => set('purchase_uom', e.target.value)} />
              </Field>
              <Field label={`1 ${form.purchase_uom || '進貨單位'} = ? ${form.unit || '件'}`}>
                <input className="form-input" type="number" style={{ width: '100%' }} min="1" step="1" placeholder="12" value={form.purchase_uom_qty} onChange={e => set('purchase_uom_qty', e.target.value)} disabled={!form.purchase_uom} />
              </Field>
            </div>
            {form.purchase_uom && Number(form.purchase_uom_qty) > 1 && (
              <div style={{ fontSize: 12, color: 'var(--accent-cyan)', padding: '4px 8px', background: 'var(--accent-cyan-dim)', borderRadius: 6, marginTop: 4 }}>
                收貨時輸入：箱數 × {form.purchase_uom_qty} = 入庫{form.unit || '件'}數
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
