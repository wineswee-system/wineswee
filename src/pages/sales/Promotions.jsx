import { useState, useEffect } from 'react'
import { Plus, Search } from 'lucide-react'
import { getPromotions, createPromotion } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useTenant } from '../../contexts/TenantContext'

const TYPE_OPTIONS = ['滿額折扣', '滿額贈品', '階梯折扣', 'VIP專屬價', '組合優惠']
const STATUS_BADGE = { '進行中': 'badge-success', '即將開始': 'badge-info', '已結束': 'badge-danger' }

export default function Promotions() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ name: '', type: '滿額折扣', start_date: '', end_date: '', discount_value: 0, discount_type: '百分比', applicable_to: '', max_uses: 0, status: '即將開始' })

  useEffect(() => {
    getPromotions(orgId).then(({ data }) => { setItems(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name) return
    const { data } = await createPromotion({ ...form, discount_value: Number(form.discount_value), max_uses: Number(form.max_uses), used_count: 0 })
    if (data) {
      setItems(prev => [...prev, data])
      setShowModal(false)
      setForm({ name: '', type: '滿額折扣', start_date: '', end_date: '', discount_value: 0, discount_type: '百分比', applicable_to: '', max_uses: 0, status: '即將開始' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = items.filter(s =>
    search === '' || s.name?.includes(search) || s.type?.includes(search)
  )

  const active = filtered.filter(s => s.status === '進行中').length
  const upcoming = filtered.filter(s => s.status === '即將開始').length
  const ended = filtered.filter(s => s.status === '已結束').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏷️</span> 促銷活動</h2>
            <p>促銷方案建立與追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增促銷</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">進行中</div>
          <div className="stat-card-value">{active}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">即將開始</div>
          <div className="stat-card-value">{upcoming}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">已結束</div>
          <div className="stat-card-value">{ended}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 促銷列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋促銷活動..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>活動名稱</th><th>類型</th><th>期間</th><th>折扣</th><th>適用對象</th><th>使用次數</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無促銷活動</td></tr>}
              {filtered.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td><span className="badge badge-info"><span className="badge-dot"></span>{s.type}</span></td>
                  <td style={{ fontSize: 12 }}>{s.start_date} ~ {s.end_date}</td>
                  <td>{s.discount_value}{s.discount_type === '百分比' ? '%' : ' 元'}</td>
                  <td>{s.applicable_to}</td>
                  <td>{s.used_count || 0} / {s.max_uses || '∞'}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[s.status] || 'badge-info'}`}>
                      <span className="badge-dot"></span>{s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增促銷活動" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="活動名稱" required>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="活動名稱" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                {TYPE_OPTIONS.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>即將開始</option>
                <option>進行中</option>
                <option>已結束</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="開始日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="結束日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="折扣值">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.discount_value} onChange={e => set('discount_value', e.target.value)} />
            </Field>
            <Field label="折扣類型">
              <select className="form-input" style={{ width: '100%' }} value={form.discount_type} onChange={e => set('discount_type', e.target.value)}>
                <option>百分比</option>
                <option>固定金額</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="適用對象">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="全部商品 / 特定分類" value={form.applicable_to} onChange={e => set('applicable_to', e.target.value)} />
            </Field>
            <Field label="最大使用次數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0 = 無限" value={form.max_uses} onChange={e => set('max_uses', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
