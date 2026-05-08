import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { Plus, Trash2, Edit3, X, Search, ChevronRight, Filter } from 'lucide-react'
import { getAccounts, createAccount, updateAccount, deleteAccount } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useTenant } from '../../contexts/TenantContext'

const TYPES = [
  { value: '費用', label: '費用', color: 'var(--accent-red)', dim: 'var(--accent-red-dim)' },
  { value: '收入', label: '收入', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)' },
  { value: '資產', label: '資產', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)' },
  { value: '負債', label: '負債', color: 'var(--accent-yellow)', dim: 'var(--accent-yellow-dim)' },
  { value: '權益', label: '權益', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  { value: '代收代付', label: '代收代付', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)' },
  { value: '週轉金', label: '週轉金', color: 'var(--accent-pink)', dim: 'var(--accent-pink-dim)' },
]

const typeColor = (type) => TYPES.find(t => t.value === type)?.color || 'var(--text-secondary)'
const typeDim = (type) => TYPES.find(t => t.value === type)?.dim || 'var(--bg-tertiary)'

const emptyForm = { code: '', name: '', type: '費用', parent_code: '', description: '', balance: 0 }

export default function ChartOfAccounts() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const { data, error } = await getAccounts(orgId)
    if (error) setError(error.message)
    else setAccounts(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [orgId])

  const handleSubmit = async () => {
    if (!form.code || !form.name || !form.type) return
    setSaving(true)
    const payload = { ...form, organization_id: orgId }
    delete payload.id
    if (!payload.parent_code) payload.parent_code = null
    if (!payload.description) payload.description = null

    if (editingId) {
      const { error } = await updateAccount(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await createAccount(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    load()
  }

  const handleEdit = (acc) => {
    setForm({
      code: acc.code,
      name: acc.name,
      type: acc.type || '費用',
      parent_code: acc.parent_code || '',
      description: acc.description || '',
      balance: acc.balance || 0,
    })
    setEditingId(acc.id)
    setShowModal(true)
  }

  const handleDelete = async (id, code) => {
    // Check if this code is used as parent
    const hasChildren = accounts.some(a => a.parent_code === code)
    if (hasChildren) {
      setError(`科目 ${code} 有子科目，無法刪除`)
      return
    }
    if (!confirm('確定要刪除此會計科目？')) return
    const { error } = await deleteAccount(id)
    if (error) setError(error.message)
    else load()
  }

  // Filter & search
  const filtered = accounts.filter(a => {
    if (filterType && a.type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    }
    return true
  })

  // Build parent lookup
  const parentName = (code) => {
    if (!code) return null
    const p = accounts.find(a => a.code === code)
    return p ? p.name : code
  }

  // Stats
  const typeCounts = {}
  accounts.forEach(a => { typeCounts[a.type] = (typeCounts[a.type] || 0) + 1 })

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 會計科目</h2>
            <p>Chart of Accounts — 科目代號管理，可串接傳票與簽核流程</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增科目
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>總科目數</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent-blue)' }}>{accounts.length}</div>
        </div>
        {TYPES.filter(t => typeCounts[t.value]).map(t => (
          <div key={t.value} className="card" style={{ padding: '14px 18px', cursor: 'pointer', border: filterType === t.value ? `2px solid ${t.color}` : undefined }}
            onClick={() => setFilterType(filterType === t.value ? '' : t.value)}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: t.color }}>{typeCounts[t.value]}</div>
          </div>
        ))}
      </div>

      {/* Search & filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜尋代號或名稱..."
            style={{ width: '100%', padding: '8px 12px 8px 30px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }}
          />
        </div>
        {filterType && (
          <button className="btn btn-secondary" onClick={() => setFilterType('')} style={{ fontSize: 12 }}>
            <Filter size={12} /> {filterType} <X size={12} />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>代號</th>
              <th>名稱</th>
              <th>類型</th>
              <th>上層科目</th>
              <th>說明</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                {search || filterType ? '無符合條件的科目' : '尚無會計科目，點擊「新增科目」開始建立'}
              </td></tr>
            ) : filtered.map(acc => (
              <tr key={acc.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{acc.code}</td>
                <td style={{ fontWeight: 600 }}>
                  {acc.parent_code && <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>└</span>}
                  {acc.name}
                </td>
                <td>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                    background: typeDim(acc.type),
                    color: typeColor(acc.type),
                  }}>{acc.type || '-'}</span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {acc.parent_code ? (
                    <span><span style={{ fontFamily: 'monospace' }}>{acc.parent_code}</span> {parentName(acc.parent_code)}</span>
                  ) : '-'}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {acc.description || '-'}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => handleEdit(acc)}><Edit3 size={13} /></button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(acc.id, acc.code)}><Trash2 size={13} /></button>
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
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 480, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯會計科目' : '新增會計科目'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>代號 *</label>
                  <input type="text" value={form.code} onChange={e => set('code', e.target.value)} placeholder="例：001"
                    disabled={!!editingId}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editingId ? 'var(--bg-main-dim)' : 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>類型 *</label>
                  <select value={form.type} onChange={e => set('type', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>名稱 *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：租金費用"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>上層科目</label>
                <select value={form.parent_code} onChange={e => set('parent_code', e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">無（頂層科目）</option>
                  {accounts.filter(a => a.id !== editingId).map(a => (
                    <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>說明</label>
                <input type="text" value={form.description} onChange={e => set('description', e.target.value)} placeholder="選填"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
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
