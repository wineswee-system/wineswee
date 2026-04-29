import { useState, useEffect } from 'react'
import { Plus, Search } from 'lucide-react'
import { getPurchaseRequests, createPurchaseRequest } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { getSupervisor } from '../../lib/approval'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function PurchaseRequests() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ pr_number: '', requester: '', department: '', total_amount: '', reason: '' })

  useEffect(() => {
    getPurchaseRequests().then(({ data }) => { setRequests(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.pr_number || !form.requester) return
    const { data } = await createPurchaseRequest({ ...form, total_amount: parseFloat(form.total_amount) || 0, status: '待審核' })
    if (data) {
      setRequests(prev => [...prev, data])
      setShowModal(false)
      setForm({ pr_number: '', requester: '', department: '', total_amount: '', reason: '' })

      // 動態簽核：通知申請人的直屬主管
      const supervisor = await getSupervisor(form.requester)
      if (supervisor) {
        await supabase.from('notifications').insert({
          recipient_emp_id: supervisor.id,
          type: '採購簽核',
          title: `${form.requester} 提交採購申請 ${form.pr_number}（NT$ ${(parseFloat(form.total_amount) || 0).toLocaleString()}），請審核`,
          read: false,
        })
      }
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = requests.filter(r =>
    search === '' || r.pr_number?.includes(search) || r.requester?.includes(search)
  )

  const pending = filtered.filter(r => r.status === '待審核').length
  const approved = filtered.filter(r => r.status === '已核准').length
  const rejected = filtered.filter(r => r.status === '已駁回').length

  const now = new Date()
  const monthTotal = filtered
    .filter(r => {
      const d = new Date(r.created_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    })
    .reduce((sum, r) => sum + (r.total_amount || 0), 0)

  const statusBadge = (status) => {
    const cls = status === '已核准' ? 'badge-success' : status === '已駁回' ? 'badge-danger' : 'badge-warning'
    return <span className={`badge ${cls}`}><span className="badge-dot"></span>{status}</span>
  }

  const formatNT = (n) => `NT$ ${(n || 0).toLocaleString()}`

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 採購申請 (PR)</h2>
            <p>採購需求提交與審核管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增採購申請</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待審核</div>
          <div className="stat-card-value">{pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{approved}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已駁回</div>
          <div className="stat-card-value">{rejected}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">本月金額</div>
          <div className="stat-card-value">{formatNT(monthTotal)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 採購申請列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋PR編號/申請人..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>PR 編號</th><th>申請人</th><th>部門</th><th>金額</th><th>事由</th><th>狀態</th><th>申請日期</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無採購申請</td></tr>}
              {filtered.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.pr_number}</td>
                  <td>{r.requester}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.department}</td>
                  <td style={{ fontWeight: 600 }}>{formatNT(r.total_amount)}</td>
                  <td>{r.reason}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增採購申請" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="PR 編號 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="PR-20260401-001" value={form.pr_number} onChange={e => set('pr_number', e.target.value)} />
            </Field>
            <Field label="申請人 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="申請人姓名" value={form.requester} onChange={e => set('requester', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="部門名稱" value={form.department} onChange={e => set('department', e.target.value)} />
            </Field>
            <Field label="金額">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.total_amount} onChange={e => set('total_amount', e.target.value)} />
            </Field>
          </div>
          <Field label="事由">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="採購事由說明" value={form.reason} onChange={e => set('reason', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
