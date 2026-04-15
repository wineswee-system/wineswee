import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, BarChart3, PieChart } from 'lucide-react'
import { getCostCenters, createCostCenter, updateCostCenter, deleteCostCenter, getAllJournalLines, getJournalEntries, getAccounts } from '../../lib/db'
import { generateTrialBalanceByCostCenter } from '../../lib/accounting'
import LoadingSpinner from '../../components/LoadingSpinner'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const emptyForm = { code: '', name: '', department: '', manager: '', is_active: true }

export default function CostCenters() {
  const [centers, setCenters] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('list') // list | report
  const [costCenterReport, setCostCenterReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const { data, error } = await getCostCenters()
    if (error) setError(error.message)
    else setCenters(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.code || !form.name) return
    setSaving(true)
    const payload = { ...form }
    delete payload.id

    if (editingId) {
      const { error } = await updateCostCenter(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await createCostCenter(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    load()
  }

  const handleEdit = (cc) => {
    setForm({ code: cc.code, name: cc.name, department: cc.department || '', manager: cc.manager || '', is_active: cc.is_active })
    setEditingId(cc.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('確定要刪除此成本中心？')) return
    const { error } = await deleteCostCenter(id)
    if (error) setError(error.message)
    else load()
  }

  const loadReport = async () => {
    setReportLoading(true)
    try {
      // Fetch posted journal entries and their lines with cost_center
      const [entriesRes, linesRes, accountsRes] = await Promise.all([
        getJournalEntries(),
        getAllJournalLines(),
        getAccounts(),
      ])

      const postedEntryIds = new Set(
        (entriesRes.data || []).filter(e => e.status === '已過帳').map(e => e.id)
      )
      const postedLines = (linesRes.data || []).filter(l => postedEntryIds.has(l.entry_id))
      const accounts = accountsRes.data || []

      const report = generateTrialBalanceByCostCenter(accounts, postedLines)
      setCostCenterReport(report)
    } catch (err) {
      setError(err.message)
    }
    setReportLoading(false)
  }

  useEffect(() => {
    if (tab === 'report' && !costCenterReport) loadReport()
  }, [tab])

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏷</span> 成本中心</h2>
            <p>Cost Centers — 成本中心管理與分攤報表</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
              <Plus size={14} /> 新增成本中心
            </button>
          </div>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', padding: 4, borderRadius: 8, width: 'fit-content', border: '1px solid var(--border)' }}>
        <button onClick={() => setTab('list')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === 'list' ? 'var(--accent-blue)' : 'transparent', color: tab === 'list' ? '#fff' : 'var(--text-secondary)' }}>
          <BarChart3 size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> 成本中心清單
        </button>
        <button onClick={() => setTab('report')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === 'report' ? 'var(--accent-blue)' : 'transparent', color: tab === 'report' ? '#fff' : 'var(--text-secondary)' }}>
          <PieChart size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> 成本中心試算表
        </button>
      </div>

      {tab === 'list' && (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>代碼</th>
                <th>名稱</th>
                <th>部門</th>
                <th>負責人</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {centers.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無成本中心</td></tr>
              ) : centers.map(cc => (
                <tr key={cc.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{cc.code}</td>
                  <td style={{ fontWeight: 600 }}>{cc.name}</td>
                  <td>{cc.department || '-'}</td>
                  <td>{cc.manager || '-'}</td>
                  <td>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                      background: cc.is_active ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
                      color: cc.is_active ? 'var(--accent-green)' : 'var(--accent-red)',
                    }}>{cc.is_active ? '啟用' : '停用'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => handleEdit(cc)}><Edit3 size={13} /></button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(cc.id)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'report' && (
        <div>
          {reportLoading ? <LoadingSpinner /> : costCenterReport ? (
            Object.entries(costCenterReport).map(([cc, trialBalance]) => (
              <div key={cc} style={{ marginBottom: 24 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>
                  <span style={{ color: 'var(--accent-blue)', fontFamily: 'monospace' }}>{cc}</span>
                  {' '}{centers.find(c => c.code === cc)?.name || ''}
                </h3>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>科目代碼</th>
                        <th>科目名稱</th>
                        <th>類型</th>
                        <th style={{ textAlign: 'right' }}>借方餘額</th>
                        <th style={{ textAlign: 'right' }}>貸方餘額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trialBalance.filter(r => r.debit_balance || r.credit_balance).map((row, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: 'monospace' }}>{row.account_code}</td>
                          <td>{row.account_name}</td>
                          <td>{row.type}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{row.debit_balance ? fmt(row.debit_balance) : '-'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{row.credit_balance ? fmt(row.credit_balance) : '-'}</td>
                        </tr>
                      ))}
                      {trialBalance.filter(r => r.debit_balance || r.credit_balance).length === 0 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--text-secondary)' }}>此成本中心無已過帳分錄</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          ) : (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>無資料</div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 420, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯成本中心' : '新增成本中心'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>代碼 *</label>
                <input type="text" value={form.code} onChange={e => set('code', e.target.value)} placeholder="例：CC-RD" disabled={!!editingId} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editingId ? 'var(--bg-main-dim)' : 'var(--bg-main)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>名稱 *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：研發中心" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>部門</label>
                  <input type="text" value={form.department} onChange={e => set('department', e.target.value)} placeholder="選填" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>負責人</label>
                  <input type="text" value={form.manager} onChange={e => set('manager', e.target.value)} placeholder="選填" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              {editingId && (
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>啟用</span>
                  </label>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
