import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, BookOpen, Download } from 'lucide-react'
import { calculateDepreciation } from '../../lib/accounting'
import { getFixedAssets, createFixedAsset, updateFixedAsset, deleteFixedAsset, createJournalEntry, batchCreateJournalLines } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useTenant } from '../../contexts/TenantContext'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const CATEGORIES = ['土地', '建築物', '機器設備', '運輸設備', '辦公設備', '其他']
const METHODS = [
  { value: 'straight_line', label: '直線法' },
  { value: 'declining_balance', label: '定率遞減法' },
  { value: 'sum_of_years', label: '年數合計法' },
]
const STATUSES = ['使用中', '已處分', '已報廢']

const emptyForm = {
  name: '', asset_code: '', category: '機器設備', cost: '', salvage_value: '', useful_life: '',
  method: 'straight_line', acquired_date: new Date().toISOString().slice(0, 10),
  department: '', location: '', notes: '', status: '使用中',
}

export default function FixedAssets() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [generatingJE, setGeneratingJE] = useState(false)
  const [error, setError] = useState(null)
  const [filterCategory, setFilterCategory] = useState('全部')
  const [filterStatus, setFilterStatus] = useState('使用中')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const loadAssets = async () => {
    setLoading(true)
    const { data, error } = await getFixedAssets(orgId)
    if (error) setError(error.message)
    else setAssets(data || [])
    setLoading(false)
  }

  useEffect(() => { loadAssets() }, [orgId])

  const handleSubmit = async () => {
    if (!form.name || !form.cost || !form.useful_life) return
    setSaving(true)
    const payload = {
      ...form,
      cost: Number(form.cost),
      salvage_value: Number(form.salvage_value) || 0,
      useful_life: Number(form.useful_life),
    }
    delete payload.id

    if (editingId) {
      const { error } = await updateFixedAsset(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      if (!payload.asset_code) {
        payload.asset_code = `FA-${String(Date.now()).slice(-6)}`
      }
      const { error } = await createFixedAsset(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    loadAssets()
  }

  const handleEdit = (asset) => {
    setForm({
      name: asset.name, asset_code: asset.asset_code || '', category: asset.category,
      cost: String(asset.cost), salvage_value: String(asset.salvage_value),
      useful_life: String(asset.useful_life), method: asset.method,
      acquired_date: asset.acquired_date, department: asset.department || '',
      location: asset.location || '', notes: asset.notes || '', status: asset.status || '使用中',
    })
    setEditingId(asset.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ message: '確定要刪除此資產？' }))) return
    const { error } = await deleteFixedAsset(id)
    if (error) setError(error.message)
    else loadAssets()
  }

  // Generate monthly depreciation journal entries for all active assets
  const handleGenerateDepreciationJE = async () => {
    const activeAssets = assets.filter(a => a.status === '使用中')
    if (activeAssets.length === 0) return toast.error('沒有使用中的資產')

    if (!(await confirm({ message: `將為 ${activeAssets.length} 項資產建立本月折舊分錄，是否繼續？` }))) return

    setGeneratingJE(true)
    const today = new Date().toISOString().slice(0, 10)
    const month = today.slice(0, 7)
    let totalDepreciation = 0
    const lines = []

    for (const asset of activeAssets) {
      if (asset.category === '土地') continue // land is not depreciated
      const dep = calculateDepreciation({
        cost: asset.cost,
        salvage_value: asset.salvage_value,
        useful_life_years: asset.useful_life,
        method: asset.method,
        acquired_date: asset.acquired_date,
        current_date: today,
      })
      if (dep.monthly_depreciation > 0) {
        totalDepreciation += dep.monthly_depreciation
        lines.push({
          account_code: '6300', account_name: '折舊費用',
          debit: dep.monthly_depreciation, credit: 0,
          memo: `${asset.name} ${month} 月折舊`,
        })
      }
    }

    if (totalDepreciation === 0) {
      setGeneratingJE(false)
      return toast.error('所有資產折舊金額為 0（可能已超過耐用年限）')
    }

    // Single credit line for accumulated depreciation
    lines.push({
      account_code: '1610', account_name: '累計折舊',
      debit: 0, credit: Math.round(totalDepreciation * 100) / 100,
      memo: `${month} 月固定資產折舊`,
    })

    const entryNumber = `JE-DEP-${month.replace('-', '')}`
    const { data: entry, error: entryErr } = await createJournalEntry({
      entry_number: entryNumber,
      entry_date: today,
      description: `${month} 固定資產折舊提列`,
      source: '折舊',
      status: '草稿',
      created_by: '系統',
    })

    if (entryErr) {
      setError(entryErr.message)
      setGeneratingJE(false)
      return
    }

    const linesWithEntry = lines.map(l => ({ ...l, entry_id: entry.id }))
    const { error: linesErr } = await batchCreateJournalLines(linesWithEntry)
    if (linesErr) setError(linesErr.message)
    else toast.success(`已建立折舊分錄 ${entryNumber}，總金額 ${fmt(totalDepreciation)}（草稿狀態，請至傳票管理過帳）`)

    setGeneratingJE(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const withDepreciation = assets.map(asset => {
    const dep = calculateDepreciation({
      cost: asset.cost,
      salvage_value: asset.salvage_value,
      useful_life_years: asset.useful_life,
      method: asset.method,
      acquired_date: asset.acquired_date,
      current_date: today,
    })
    return { ...asset, ...dep }
  })

  const filtered = withDepreciation.filter(a => {
    if (filterCategory !== '全部' && a.category !== filterCategory) return false
    if (filterStatus !== '全部' && a.status !== filterStatus) return false
    return true
  })

  const totalCost = filtered.reduce((s, a) => s + (a.cost || 0), 0)
  const totalAccumulated = filtered.reduce((s, a) => s + (a.accumulated_depreciation || 0), 0)
  const totalBookValue = filtered.reduce((s, a) => s + (a.book_value || 0), 0)

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

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏢</span> 固定資產</h2>
            <p>Fixed Assets — 資產登記、折舊計算、折舊分錄自動產生</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleGenerateDepreciationJE} disabled={generatingJE}>
              <BookOpen size={14} /> {generatingJE ? '產生中...' : '產生折舊分錄'}
            </button>
            <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
              <Plus size={14} /> 新增資產
            </button>
          </div>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

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

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <option value="全部">全部類別</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <option value="全部">全部狀態</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>資產編號</th>
              <th>資產名稱</th>
              <th>類別</th>
              <th>部門</th>
              <th style={{ textAlign: 'right' }}>原始成本</th>
              <th>折舊方法</th>
              <th style={{ textAlign: 'right' }}>每月折舊</th>
              <th style={{ textAlign: 'right' }}>累計折舊</th>
              <th style={{ textAlign: 'right' }}>帳面價值</th>
              <th>取得日期</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無固定資產</td></tr>
            ) : filtered.map(asset => (
              <tr key={asset.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{asset.asset_code}</td>
                <td style={{ fontWeight: 600 }}>{asset.name}</td>
                <td><span style={{ color: categoryColor(asset.category), fontWeight: 600 }}>{asset.category}</span></td>
                <td>{asset.department || '-'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(asset.cost)}</td>
                <td>{methodLabel(asset.method)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(asset.monthly_depreciation)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(asset.accumulated_depreciation)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-green)', fontWeight: 600 }}>{fmt(asset.book_value)}</td>
                <td>{asset.acquired_date}</td>
                <td>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                    background: asset.status === '使用中' ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
                    color: asset.status === '使用中' ? 'var(--accent-green)' : 'var(--accent-red)',
                  }}>{asset.status}</span>
                </td>
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
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 520, maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯資產' : '新增固定資產'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>資產名稱 *</label>
                  <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：辦公電腦" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>資產編號</label>
                  <input type="text" value={form.asset_code} onChange={e => set('asset_code', e.target.value)} placeholder="自動產生" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>部門</label>
                  <input type="text" value={form.department} onChange={e => set('department', e.target.value)} placeholder="例：研發部" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>存放地點</label>
                  <input type="text" value={form.location} onChange={e => set('location', e.target.value)} placeholder="例：台北總部" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              {editingId && (
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>狀態</label>
                  <select value={form.status} onChange={e => set('status', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>備註</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="選填" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
