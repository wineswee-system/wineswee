import { useState, useEffect } from 'react'
import { Plus, Search, CheckCircle, Circle, Clock, AlertTriangle, UserCheck, ChevronRight, ChevronDown } from 'lucide-react'
import { getVendorOnboarding, createVendorOnboarding, updateVendorOnboarding, createSupplier } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const DEFAULT_CHECKLIST = [
  { step: '基本資料確認', completed: false },
  { step: '營業登記文件', completed: false },
  { step: '品質認證文件', completed: false },
  { step: '銀行資料提供', completed: false },
  { step: '合約簽署', completed: false },
  { step: '主管核准', completed: false },
]

const MOCK_ONBOARDING = [
  { id: 1, supplier_name: '台灣精密科技', contact_person: '王經理', email: 'wang@tpt.com.tw', phone: '02-2345-6789', category: '零組件', tax_id: '12345678', status: '已完成', checklist: DEFAULT_CHECKLIST.map(s => ({ ...s, completed: true })), created_at: '2026-03-15' },
  { id: 2, supplier_name: '永豐包材', contact_person: '李小姐', email: 'lee@yfpkg.com', phone: '03-456-7890', category: '包材', tax_id: '23456789', status: '進行中', checklist: DEFAULT_CHECKLIST.map((s, i) => ({ ...s, completed: i < 3 })), created_at: '2026-03-28' },
  { id: 3, supplier_name: '新竹物流服務', contact_person: '陳先生', email: 'chen@hcls.com', phone: '03-567-8901', category: '服務', tax_id: '34567890', status: '待審核', checklist: DEFAULT_CHECKLIST.map(s => ({ ...s })), created_at: '2026-04-01' },
  { id: 4, supplier_name: '高雄鋼鐵', contact_person: '張經理', email: 'chang@ksteel.com', phone: '07-678-9012', category: '原物料', tax_id: '45678901', status: '已拒絕', checklist: DEFAULT_CHECKLIST.map((s, i) => ({ ...s, completed: i < 1 })), created_at: '2026-03-20' },
]

const EMPTY_FORM = { supplier_name: '', contact_person: '', email: '', phone: '', category: '', tax_id: '', status: '待審核' }
const STATUS_OPTIONS = ['待審核', '進行中', '已完成', '已拒絕']
const CATEGORIES = ['原物料', '服務', '零組件', '包材', '設備', 'IT 服務']

export default function VendorOnboarding() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('全部')
  const [form, setForm] = useState(EMPTY_FORM)
  const [expandedRow, setExpandedRow] = useState(null)
  let nextId = 100

  useEffect(() => {
    getVendorOnboarding()
      .then(({ data }) => {
        const items = (data || []).map(d => ({
          ...d,
          checklist: typeof d.checklist === 'string' ? JSON.parse(d.checklist) : (d.checklist || DEFAULT_CHECKLIST)
        }))
        setList(items)
      })
      .catch(() => { setList(MOCK_ONBOARDING) })
      .finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.supplier_name) return
    const payload = { ...form, checklist: DEFAULT_CHECKLIST, created_at: new Date().toISOString().slice(0, 10) }
    const { data } = await createVendorOnboarding(payload).catch(() => ({ data: null }))
    if (data) {
      setList(prev => [{ ...data, checklist: typeof data.checklist === 'string' ? JSON.parse(data.checklist) : (data.checklist || DEFAULT_CHECKLIST) }, ...prev])
    } else {
      setList(prev => [{ ...payload, id: nextId++ }, ...prev])
    }
    setShowModal(false)
    setForm(EMPTY_FORM)
  }

  const toggleCheckItem = async (recordId, stepIndex) => {
    const record = list.find(r => r.id === recordId)
    if (!record) return
    const updated = record.checklist.map((s, i) => i === stepIndex ? { ...s, completed: !s.completed } : s)
    const allDone = updated.every(s => s.completed)
    const newStatus = allDone ? '已完成' : (updated.some(s => s.completed) ? '進行中' : record.status === '已拒絕' ? '已拒絕' : '待審核')

    setList(prev => prev.map(r => r.id === recordId ? { ...r, checklist: updated, status: newStatus } : r))
    await updateVendorOnboarding(recordId, { checklist: updated, status: newStatus }).catch(() => {})

    if (allDone && record.status !== '已完成') {
      await createSupplier({
        name: record.supplier_name,
        contact_person: record.contact_person,
        email: record.email,
        phone: record.phone,
        tax_id: record.tax_id,
        payment_terms: 'NET30',
        status: '合作中',
        rating: 3,
      }).catch(() => {})
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = list.filter(r => {
    const matchSearch = search === '' || r.supplier_name?.includes(search) || r.contact_person?.includes(search)
    const matchStatus = statusFilter === '全部' || r.status === statusFilter
    return matchSearch && matchStatus
  })

  const pending = list.filter(r => r.status === '待審核').length
  const inProgress = list.filter(r => r.status === '進行中').length
  const completed = list.filter(r => r.status === '已完成').length
  const rejected = list.filter(r => r.status === '已拒絕').length

  const statusBadge = (status) => {
    const map = { '待審核': 'badge-warning', '進行中': 'badge-info', '已完成': 'badge-success', '已拒絕': 'badge-danger' }
    return <span className={`badge ${map[status] || 'badge-info'}`}><span className="badge-dot"></span>{status}</span>
  }

  const statusIcon = (status) => {
    if (status === '已完成') return <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} />
    if (status === '進行中') return <Clock size={14} style={{ color: 'var(--accent-blue)' }} />
    if (status === '已拒絕') return <AlertTriangle size={14} style={{ color: 'var(--accent-red)' }} />
    return <Circle size={14} style={{ color: 'var(--accent-orange)' }} />
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🤝</span> 廠商入駐管理</h2>
            <p>新供應商入駐流程、文件審核與核准管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增入駐申請</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待審核</div>
          <div className="stat-card-value">{pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">進行中</div>
          <div className="stat-card-value">{inProgress}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成</div>
          <div className="stat-card-value">{completed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已拒絕</div>
          <div className="stat-card-value">{rejected}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><UserCheck size={16} /></span> 入駐申請列表</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-input" style={{ width: 'auto', fontSize: 13 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option>全部</option>
              {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="search-bar">
              <Search className="search-icon" />
              <input type="text" placeholder="搜尋廠商..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 30 }}></th><th>廠商名稱</th><th>聯絡人</th><th>分類</th><th>進度</th><th>狀態</th><th>申請日期</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無入駐申請</td></tr>}
              {filtered.map(r => {
                const done = r.checklist?.filter(s => s.completed).length || 0
                const total = r.checklist?.length || DEFAULT_CHECKLIST.length
                const pct = Math.round((done / total) * 100)
                const isExpanded = expandedRow === r.id
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedRow(isExpanded ? null : r.id)}>
                    <td>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {statusIcon(r.status)}
                        {r.supplier_name}
                      </div>
                    </td>
                    <td>{r.contact_person}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{r.category || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden', minWidth: 60 }}>
                          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct === 100 ? 'var(--accent-green)' : 'var(--accent-blue)', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{done}/{total}</span>
                      </div>
                    </td>
                    <td>{statusBadge(r.status)}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{r.created_at}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {expandedRow && (() => {
          const record = list.find(r => r.id === expandedRow)
          if (!record) return null
          return (
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600 }}>📋 入駐檢核清單 — {record.supplier_name}</h4>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  聯絡：{record.contact_person} | {record.email} | {record.phone}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {record.checklist?.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={(e) => { e.stopPropagation(); toggleCheckItem(record.id, idx) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                      background: 'var(--bg-secondary)', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${item.completed ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                      transition: 'all 0.2s',
                    }}
                  >
                    {item.completed
                      ? <CheckCircle size={16} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                      : <Circle size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    }
                    <span style={{
                      fontSize: 13, fontWeight: 500,
                      color: item.completed ? 'var(--text-primary)' : 'var(--text-secondary)',
                      textDecoration: item.completed ? 'line-through' : 'none',
                    }}>
                      {item.step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
      </div>

      {showModal && (
        <Modal title="新增入駐申請" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="廠商名稱" required>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="廠商名稱" value={form.supplier_name} onChange={e => set('supplier_name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="聯絡人">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="聯絡人姓名" value={form.contact_person} onChange={e => set('contact_person', e.target.value)} />
            </Field>
            <Field label="電話">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="02-1234-5678" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
          </div>
          <Field label="Email">
            <input className="form-input" type="email" style={{ width: '100%' }} placeholder="vendor@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="">請選擇</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="統一編號">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="12345678" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
