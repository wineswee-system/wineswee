import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Edit3, X, PackageX } from 'lucide-react'
import { calculateDepreciation } from '../../lib/accounting'
import { getFixedAssets, createFixedAsset, updateFixedAsset, deleteFixedAsset } from '../../lib/db'
import { getUsefulLifeTable } from '../../lib/db/fixedAssetOps'
import LoadingSpinner from '../../components/LoadingSpinner'
import Badge from '../../components/ui/Badge'
import { useOrgId } from '../../contexts/AuthContext'
import AssetFormModal from './components/AssetFormModal'
import DepreciationRunSection from './components/DepreciationRunSection'
import DisposalModal from './components/DisposalModal'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { fmtNT as fmt } from '../../lib/currency'

// ─── F-A5 固定資產：登記（耐用年數表對齊稅法）＋ 月折舊提列 ＋ 處分 ───

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
  useful_life_ref_id: null, life_override_reason: '',
}

export default function FixedAssets() {
  const orgId = useOrgId()
  const [assets, setAssets] = useState([])
  const [lifeTable, setLifeTable] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [disposingAsset, setDisposingAsset] = useState(null)
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

  useEffect(() => { loadAssets() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getUsefulLifeTable().then(({ data, error }) => {
      if (error) setError(error.message)
      else setLifeTable(data || [])
    })
  }, [])

  const lifeById = useMemo(() => {
    const map = new Map()
    for (const row of lifeTable) map.set(row.id, row)
    return map
  }, [lifeTable])

  /** 已掛耐用年數表參考、且年數與法定不同 → 與稅法年限不符 */
  const lifeMismatch = (asset) => {
    const ref = asset.useful_life_ref_id ? lifeById.get(asset.useful_life_ref_id) : null
    return ref ? Number(asset.useful_life) !== ref.useful_life_years : false
  }

  const handleSubmit = async () => {
    if (!form.name || !form.cost || !form.useful_life) return

    // 覆寫法定年限 → 必填覆寫原因
    const ref = form.useful_life_ref_id ? lifeById.get(form.useful_life_ref_id) : null
    const mismatch = ref && Number(form.useful_life) !== ref.useful_life_years
    if (mismatch && !String(form.life_override_reason || '').trim()) {
      return toast.error('耐用年數與稅法年限不符，請填寫覆寫原因')
    }

    setSaving(true)
    const payload = {
      ...form,
      cost: Number(form.cost),
      salvage_value: Number(form.salvage_value) || 0,
      useful_life: Number(form.useful_life),
      useful_life_ref_id: form.useful_life_ref_id || null,
      life_override_reason: mismatch ? form.life_override_reason.trim() : null,
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
      useful_life_ref_id: asset.useful_life_ref_id || null,
      life_override_reason: asset.life_override_reason || '',
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
            <p>Fixed Assets — 資產登記（稅法耐用年數表）、月折舊提列、處分</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
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

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>資產編號</th>
              <th>資產名稱</th>
              <th>類別</th>
              <th>部門</th>
              <th style={{ textAlign: 'right' }}>原始成本</th>
              <th>折舊方法</th>
              <th style={{ textAlign: 'right' }}>耐用年數</th>
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
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無固定資產</td></tr>
            ) : filtered.map(asset => (
              <tr key={asset.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{asset.asset_code}</td>
                <td style={{ fontWeight: 600 }}>{asset.name}</td>
                <td><span style={{ color: categoryColor(asset.category), fontWeight: 600 }}>{asset.category}</span></td>
                <td>{asset.department || '-'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(asset.cost)}</td>
                <td>{methodLabel(asset.method)}</td>
                <td style={{ textAlign: 'right' }}>
                  {asset.useful_life} 年
                  {lifeMismatch(asset) && (
                    <div><Badge color="orange" size="sm">⚠ 與稅法年限不符</Badge></div>
                  )}
                </td>
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
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} title="編輯" onClick={() => handleEdit(asset)}><Edit3 size={13} /></button>
                    {asset.status === '使用中' && (
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-orange)' }} title="處分（出售/報廢）" onClick={() => setDisposingAsset(asset)}><PackageX size={13} /></button>
                    )}
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} title="刪除" onClick={() => handleDelete(asset.id)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 折舊提列（月結批次 → RPC，同期冪等） */}
      <DepreciationRunSection assets={assets} orgId={orgId} />

      {/* 新增/編輯資產（含耐用年數表 picker） */}
      {showModal && (
        <AssetFormModal
          form={form}
          set={set}
          editingId={editingId}
          saving={saving}
          lifeTable={lifeTable}
          onSubmit={handleSubmit}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* 處分（出售/報廢） */}
      {disposingAsset && (
        <DisposalModal
          asset={disposingAsset}
          onClose={() => setDisposingAsset(null)}
          onDisposed={loadAssets}
        />
      )}
    </div>
  )
}
