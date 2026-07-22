import { useState, useEffect } from 'react'
import { Plus, Search, DollarSign } from 'lucide-react'
import { getBudgets, createBudget } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'

export default function Budgets() {
  const { profile } = useAuth()
  const [budgets, setBudgets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ department: '', category: '', period: '', budget_amount: '', spent_amount: '0', status: '執行中' })

  useEffect(() => {
    getBudgets(profile?.organization_id).then(({ data }) => { setBudgets(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [profile?.organization_id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.department || !form.budget_amount) return
    const { data } = await createBudget({
      ...form,
      budget_amount: parseFloat(form.budget_amount) || 0,
      spent_amount: parseFloat(form.spent_amount) || 0,
    })
    if (data) {
      setBudgets(prev => [...prev, data])
      setShowModal(false)
      setForm({ department: '', category: '', period: '', budget_amount: '', spent_amount: '0', status: '執行中' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = budgets.filter(b =>
    search === '' || b.department?.includes(search) || b.category?.includes(search)
  )

  const totalBudget = filtered.reduce((sum, b) => sum + (b.budget_amount || 0), 0)
  const totalSpent = filtered.reduce((sum, b) => sum + (b.spent_amount || 0), 0)
  const totalRemaining = totalBudget - totalSpent
  const usageRate = totalBudget > 0 ? ((totalSpent / totalBudget) * 100).toFixed(1) : '0.0'

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💰</span> 預算管理</h2>
            <p>部門預算編列與執行追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增預算</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總預算</div>
          <div className="stat-card-value">NT$ {totalBudget.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">已使用</div>
          <div className="stat-card-value">NT$ {totalSpent.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">剩餘</div>
          <div className="stat-card-value">NT$ {totalRemaining.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">使用率</div>
          <div className="stat-card-value">{usageRate}%</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><DollarSign size={16} /></span> 預算列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋預算..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>部門</th><th>類別</th><th>期間</th><th>預算金額</th><th>已使用</th><th>剩餘</th><th>進度</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無預算資料</td></tr>}
              {filtered.map(b => {
                const remaining = (b.budget_amount || 0) - (b.spent_amount || 0)
                const pct = b.budget_amount > 0 ? ((b.spent_amount || 0) / b.budget_amount * 100) : 0
                const barColor = pct >= 90 ? 'var(--accent-red)' : pct >= 70 ? 'var(--accent-orange)' : 'var(--accent-green)'
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.department}</td>
                    <td>{b.category}</td>
                    <td>{b.period}</td>
                    <td>NT$ {(b.budget_amount || 0).toLocaleString()}</td>
                    <td>NT$ {(b.spent_amount || 0).toLocaleString()}</td>
                    <td>NT$ {remaining.toLocaleString()}</td>
                    <td style={{ minWidth: 140 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 4, background: barColor, transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 40, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${b.status === '執行中' ? 'badge-info' : b.status === '已結案' ? 'badge-success' : 'badge-warning'}`}>
                        <span className="badge-dot"></span>{b.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增預算" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="業務部" value={form.department} onChange={e => set('department', e.target.value)} />
            </Field>
            <Field label="類別">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="行銷費用" value={form.category} onChange={e => set('category', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="期間">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="2026-Q1" value={form.period} onChange={e => set('period', e.target.value)} />
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>執行中</option>
                <option>已結案</option>
                <option>草稿</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="預算金額" required>
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="500000" value={form.budget_amount} onChange={e => set('budget_amount', e.target.value)} />
            </Field>
            <Field label="已使用金額">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.spent_amount} onChange={e => set('spent_amount', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
