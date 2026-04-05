import { useState, useEffect } from 'react'
import { Plus, Search, Barcode } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const CATEGORIES = ['食品', '飲料', '電子', '服飾', '家居', '美妝', '文具', '其他']
const COSTING_METHODS = [
  { value: 'FIFO', label: 'FIFO 先進先出' },
  { value: 'WEIGHTED_AVG', label: '加權平均' },
  { value: 'MOVING_AVG', label: '移動平均' },
]

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
  const [skus, setSkus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    code: '', name: '', barcode: '', unit: '件', weight: '', length: '', width: '', height: '',
    category: CATEGORIES[0], costing_method: 'WEIGHTED_AVG', unit_cost: ''
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
    }
    const { data } = await supabase.from('skus').insert(submitData).select().single()
    if (data) {
      setSkus(prev => [...prev, data])
      setShowModal(false)
      setForm({
        code: '', name: '', barcode: '', unit: '件', weight: '', length: '', width: '', height: '',
        category: CATEGORIES[0], costing_method: 'WEIGHTED_AVG', unit_cost: ''
      })
    }
  }

  const filtered = skus.filter(s => s.name?.includes(search) || s.code?.includes(search) || s.barcode?.includes(search))

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
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋品號/品名/條碼..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>品號</th><th>品名</th><th>條碼</th><th>分類</th><th>單位</th><th>成本方法</th><th>單位成本</th><th>重量(kg)</th><th>材積(cm)</th><th>狀態</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無商品資料</td></tr>}
              {filtered.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{s.code}</td>
                  <td>{s.name}</td>
                  <td><BarcodeVisual code={s.barcode} /></td>
                  <td><span className="badge badge-cyan">{s.category}</span></td>
                  <td>{s.unit}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增商品" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="品號 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="SKU-001" value={form.code} onChange={e => set('code', e.target.value)} /></Field>
            <Field label="品名 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="商品名稱" value={form.name} onChange={e => set('name', e.target.value)} /></Field>
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
            <Field label="單位"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="件" value={form.unit} onChange={e => set('unit', e.target.value)} /></Field>
            <Field label="重量(kg)"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0.5" value={form.weight} onChange={e => set('weight', e.target.value)} /></Field>
            <Field label="長(cm)"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="10" value={form.length} onChange={e => set('length', e.target.value)} /></Field>
            <Field label="寬(cm)"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="10" value={form.width} onChange={e => set('width', e.target.value)} /></Field>
          </div>
          <Field label="高(cm)"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="10" value={form.height} onChange={e => set('height', e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  )
}
