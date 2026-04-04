import { useState } from 'react'
import { Plus, Trash2, Edit3, X } from 'lucide-react'
import { calculateDepreciation } from '../../lib/accounting'
import LoadingSpinner from '../../components/LoadingSpinner'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const CATEGORIES = ['土地', '建築物', '機器設備', '運輸設備', '辦公設備', '其他']
const METHODS = [
  { value: 'straight-line', label: '直線法' },
  { value: 'declining-balance', label: '定率遞減法' },
  { value: 'sum-of-years', label: '年數合計法' },
]

const emptyForm = {
  name: '', category: '機器設備', cost: '', salvage_value: '', useful_life: '',
  method: 'straight-line', acquired_date: new Date().toISOString().slice(0, 10),
}

let nextId = 1

const INITIAL_ASSETS = [
  { id: nextId++, name: '辦公電腦 x10', category: '辦公設備', cost: 350000, salvage_value: 35000, useful_life: 5, method: 'straight-line', acquired_date: '2024-01-15' },
  { id: nextId++, name: '貨運卡車', category: '運輸設備', cost: 1200000, salvage_value: 200000, useful_life: 8, method: 'declining-balance', acquired_date: '2023-06-01' },
  { id: nextId++, name: 'CNC 加工機', category: '機器設備', cost: 2500000, salvage_value: 250000, useful_life: 10, method: 'straight-line', acquired_date: '2022-03-10' },
  { id: nextId++, name: '辦公桌椅組', category: '辦公設備', cost: 180000, salvage_value: 18000, useful_life: 7, method: 'sum-of-years', acquired_date: '2024-07-20' },
]

export default function FixedAssets() {
  const [assets, setAssets] = useState(INITIAL_ASSETS)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = () => {
    if (!form.name || !form.cost || !form.useful_life) return
    const asset = {
      ...form,
      cost: Number(form.cost),
      salvage_value: Number(form.salvage_value) || 0,
      useful_life: Number(form.useful_life),
    }

    if (editingId) {
      setAssets(prev => prev.map(a => a.id === editingId ? { ...a, ...asset } : a))
    } else {
      setAssets(prev => [...prev, { ...asset, id: nextId++ }])
    }
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
  }

  const handleEdit = (asset) => {
    setForm({
      name: asset.name, category: asset.category, cost: String(asset.cost),
      salvage_value: String(asset.salvage_value), useful_life: String(asset.useful_life),
      method: asset.method, acquired_date: asset.acquired_date,
    })
    setEditingId(asset.id)
    setShowModal(true)
  }

  const handleDelete = (id) => {
    if (!confirm('確定要刪除此資產？')) return
    setAssets(prev => prev.filter(a => a.id !== id))
  }

  const withDepreciation = assets.map(asset => {
    const dep = calculateDepreciation({
      cost: asset.cost,
      salvageValue: asset.salvage_value,
      usefulLife: asset.useful_life,
      method: asset.method,
      acquiredDate: asset.acquired_date,
    })
    return { ...asset, ...dep }
  })

  const totalCost = withDepreciation.reduce((s, a) => s + (a.cost || 0), 0)
  const totalAccumulated = withDepreciation.reduce((s, a) => s + (a.accumulatedDepreciation || 0), 0)
  const totalBookValue = withDepreciation.reduce((s, a) => s + (a.bookValue || 0), 0)

  const methodLabel = (m) => METHODS.find(x => x.value === m)?.label || m

  const categoryColor = (cat) => {
    switch (cat) {
      case '土地': return 'var(--accent-green)'
      case '建築物': return 'var(--accent-blue)'
      case '機器設備': return 'var(--accent-purple)'
      case '運輸設備': return 'var(--accent-orange)'
      case '辦公設備': return 'var(--accent-cyan)'
      default: return 'var(--text-secondary)'
    }
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏢</span> 固定資產</h2>
            <p>Fixed Assets — 資產登記與折舊計算</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增資產
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">資產原值合計</div>
          <div className="stat-card-value">{fmt(totalCost)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">累計折舊</div>
          <div className="stat-card-value">{fmt(totalAccumulated)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">帳面價值</div>
          <div className="stat-card-value">{fmt(totalBookValue)}</div>
        </div>
      </div>

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>資產名稱</th>
              <th>類別</th>
              <th style={{ textAlign: 'right' }}>原始成本</th>
              <th>折舊方法</th>
              <th style={{ textAlign: 'right' }}>每月折舊</th>
              <th style={{ textAlign: 'right' }}>累計折舊</th>
              <th style={{ textAlign: 'right' }}>帳面價值</th>
              <th>取得日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {withDepreciation.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無固定資產</td></tr>
            ) : withDepreciation.map(asset => (
              <tr key={asset.id}>
                <td style={{ fontWeight: 600 }}>{asset.name}</td>
                <td><span style={{ color: categoryColor(asset.category), fontWeight: 600 }}>{asset.category}</span></td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(asset.cost)}</td>
                <td>{methodLabel(asset.method)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(asset.monthlyDepreciation)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(asset.accumulatedDepreciation)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-green)', fontWeight: 600 }}>{fmt(asset.bookValue)}</td>
                <td>{asset.acquired_date}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => handleEdit(asset)}><Edit3 size={13} /></button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(asset.id)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 480, maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯資產' : '新增固定資產'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>資產名稱 *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：辦公電腦" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>類別</label>
                  <select value={form.category} onChange={e => set('category', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>折舊方法</label>
                  <select value={form.method} onChange={e => set('method', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>原始成本 *</label>
                  <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="0" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>殘值</label>
                  <input type="number" value={form.salvage_value} onChange={e => set('salvage_value', e.target.value)} placeholder="0" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>耐用年數 *</label>
                  <input type="number" value={form.useful_life} onChange={e => set('useful_life', e.target.value)} placeholder="年" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>取得日期</label>
                  <input type="date" value={form.acquired_date} onChange={e => set('acquired_date', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit}>{editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
