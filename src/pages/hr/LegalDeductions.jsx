import { useState, useEffect, useMemo } from 'react'
import { Plus, Edit2, Pause, Play, Trash2, Gavel, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const STATUS_STYLE = {
  '進行中': { bg: 'rgba(34,211,238,0.15)', color: 'var(--accent-cyan)' },
  '已完成': { bg: 'rgba(52,211,153,0.15)', color: 'var(--accent-green)' },
  '已停止': { bg: 'rgba(248,113,113,0.15)', color: 'var(--accent-red)' },
}

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const emptyForm = {
  employee_id: '',
  title: '',
  total_amount: '',
  monthly_amount: '',
  started_month: currentMonth(),
  case_number: '',
  notes: '',
}

export default function LegalDeductions() {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [statusFilter, setStatusFilter] = useState('進行中')
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const loadData = () => {
    setLoading(true)
    Promise.all([
      supabase.from('legal_deductions').select('*').order('id', { ascending: false }),
      supabase.from('employees').select('id, name, dept, store, position, departments!department_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([d, e, dp]) => {
      setItems(d.data || [])
      setEmployees(e.data || [])
      setDepartments(dp.data || [])
    }).catch(err => {
      console.error('Failed to load:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const empMap = useMemo(() => {
    const m = {}
    employees.forEach(e => { m[e.id] = e })
    return m
  }, [employees])

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (statusFilter !== '全部' && i.status !== statusFilter) return false
      if (deptFilter) {
        const emp = empMap[i.employee_id]
        if (!emp || emp.dept !== deptFilter) return false
      }
      return true
    })
  }, [items, statusFilter, deptFilter, empMap])

  // 統計
  const stats = useMemo(() => {
    const active = items.filter(i => i.status === '進行中')
    return {
      activeCount: active.length,
      totalRemaining: active.reduce((s, i) => s + ((Number(i.total_amount) || 0) - (Number(i.paid_amount) || 0)), 0),
      monthlyTotal: active.reduce((s, i) => s + (Number(i.monthly_amount) || 0), 0),
      affectedEmps: new Set(active.map(i => i.employee_id)).size,
    }
  }, [items])

  // 新增
  const openAdd = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (item) => {
    setEditingId(item.id)
    setForm({
      employee_id: String(item.employee_id),
      title: item.title || '',
      total_amount: String(item.total_amount || ''),
      monthly_amount: String(item.monthly_amount || ''),
      started_month: item.started_month || currentMonth(),
      case_number: item.case_number || '',
      notes: item.notes || '',
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!form.employee_id) return alert('請選擇員工')
    if (!form.title.trim()) return alert('請輸入標題')
    const totalAmt = Number(form.total_amount)
    const monthlyAmt = Number(form.monthly_amount)
    if (!totalAmt || totalAmt <= 0) return alert('總額必須大於 0')
    if (!monthlyAmt || monthlyAmt <= 0) return alert('每月金額必須大於 0')
    if (!/^\d{4}-\d{2}$/.test(form.started_month)) return alert('開始月份格式錯誤（應為 YYYY-MM）')

    if (!profile?.organization_id) { alert('身份未載入，請重新登入'); return }
    const payload = {
      employee_id: Number(form.employee_id),
      title: form.title.trim(),
      total_amount: totalAmt,
      monthly_amount: monthlyAmt,
      started_month: form.started_month,
      case_number: form.case_number || null,
      notes: form.notes || null,
      organization_id: profile.organization_id,
    }
    try {
      if (editingId) {
        const { data, error } = await supabase.from('legal_deductions').update(payload).eq('id', editingId).select().single()
        if (error) throw error
        setItems(prev => prev.map(i => i.id === editingId ? data : i))
      } else {
        const { data, error } = await supabase.from('legal_deductions').insert(payload).select().single()
        if (error) throw error
        setItems(prev => [data, ...prev])
      }
      setShowModal(false)
    } catch (err) {
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const toggleStatus = async (item, newStatus) => {
    const verb = newStatus === '已停止' ? '停止' : '恢復'
    if (!confirm(`確定要${verb}此筆法扣？`)) return
    const { data, error } = await supabase.from('legal_deductions')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', item.id).select().single()
    if (error) return alert('操作失敗：' + error.message)
    setItems(prev => prev.map(i => i.id === item.id ? data : i))
  }

  const handleDelete = async (item) => {
    if (item.paid_amount > 0) return alert('已有扣款紀錄的法扣不能刪除，請改用「停止」')
    if (!confirm(`確定刪除：${item.title}？`)) return
    const { error } = await supabase.from('legal_deductions').delete().eq('id', item.id)
    if (error) return alert('刪除失敗：' + error.message)
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>⚠ {error}</h3>
      <button className="btn btn-primary" onClick={loadData} style={{ marginTop: 16 }}>重試</button>
    </div>
  )

  // 預估月數（編輯時用）
  const estimatedMonths = (() => {
    const t = Number(form.total_amount)
    const m = Number(form.monthly_amount)
    if (!t || !m) return null
    return Math.ceil(t / m)
  })()

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gavel size={20} style={{ color: 'var(--accent-purple)' }} /> 法扣管理
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              法院強制扣薪管理；薪資結算時依此自動扣款
            </p>
          </div>
          <button className="btn btn-primary" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={16} /> 新增法扣
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: '進行中筆數', value: stats.activeCount, color: 'var(--accent-cyan)' },
          { label: '影響員工', value: stats.affectedEmps, color: 'var(--accent-purple)' },
          { label: '每月應扣總額', value: fmt(stats.monthlyTotal), color: 'var(--accent-orange)' },
          { label: '剩餘待扣總額', value: fmt(stats.totalRemaining), color: 'var(--accent-red)' },
        ].map(c => (
          <div key={c.label} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="form-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 160 }}>
          <option value="全部">全部狀態</option>
          <option value="進行中">進行中</option>
          <option value="已完成">已完成</option>
          <option value="已停止">已停止</option>
        </select>
        <select className="form-input" value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ width: 180 }}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
                {['員工', '標題', '總額', '每月', '已扣', '進度', '開始月', '狀態', '案號', '操作'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>無資料</td></tr>
              ) : filtered.map(item => {
                const emp = empMap[item.employee_id]
                const total = Number(item.total_amount) || 0
                const paid = Number(item.paid_amount) || 0
                const pct = total > 0 ? (paid / total * 100) : 0
                const st = STATUS_STYLE[item.status] || STATUS_STYLE['進行中']
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{emp?.name || `#${item.employee_id}`}</td>
                    <td style={{ padding: '10px 14px' }}>{item.title}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(item.total_amount)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(item.monthly_amount)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div>{fmt(paid)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.paid_months || 0} 個月</div>
                    </td>
                    <td style={{ padding: '10px 14px', minWidth: 120 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: pct >= 100 ? 'var(--accent-green)' : 'var(--accent-cyan)' }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>{item.started_month}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: st.bg, color: st.color,
                      }}>{item.status}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>{item.case_number || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => openEdit(item)} title="編輯"
                          style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', padding: 4 }}>
                          <Edit2 size={14} />
                        </button>
                        {item.status === '進行中' && (
                          <button onClick={() => toggleStatus(item, '已停止')} title="停止"
                            style={{ background: 'none', border: 'none', color: 'var(--accent-orange)', cursor: 'pointer', padding: 4 }}>
                            <Pause size={14} />
                          </button>
                        )}
                        {item.status === '已停止' && (
                          <button onClick={() => toggleStatus(item, '進行中')} title="恢復"
                            style={{ background: 'none', border: 'none', color: 'var(--accent-green)', cursor: 'pointer', padding: 4 }}>
                            <Play size={14} />
                          </button>
                        )}
                        {paid === 0 && (
                          <button onClick={() => handleDelete(item)} title="刪除"
                            style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: 4 }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editingId ? '編輯法扣' : '新增法扣'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <SearchableSelect
              value={form.employee_id}
              onChange={(v) => set('employee_id', v || '')}
              options={employees.map(e => ({
                value: e.id,
                label: empLabel(e),
                sublabel: e.dept || '',
              }))}
              placeholder="搜尋員工姓名/部門..."
              disabled={!!editingId}
            />
          </Field>
          <Field label="標題 *">
            <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="例：養育費 / 信用卡欠款扣薪 / 法院強制執行" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="總額 *">
              <input className="form-input" type="number" value={form.total_amount} onChange={e => set('total_amount', e.target.value)} placeholder="例：120000" />
            </Field>
            <Field label="每月扣款 *">
              <input className="form-input" type="number" value={form.monthly_amount} onChange={e => set('monthly_amount', e.target.value)} placeholder="例：10000" />
            </Field>
          </div>
          {estimatedMonths && (
            <div style={{
              padding: '8px 12px', background: 'rgba(34,211,238,0.08)',
              borderRadius: 8, fontSize: 12, color: 'var(--accent-cyan)',
              marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <AlertCircle size={14} /> 預估扣款 <b>{estimatedMonths}</b> 個月扣完
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="開始月份 *">
              <input className="form-input" type="month" value={form.started_month} onChange={e => set('started_month', e.target.value)} />
            </Field>
            <Field label="案號">
              <input className="form-input" value={form.case_number} onChange={e => set('case_number', e.target.value)} placeholder="例：113 司執字 1234 號" />
            </Field>
          </div>
          <Field label="備註">
            <textarea className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="法院文件、債權人資訊、特殊處理規定..." />
          </Field>
        </Modal>
      )}
    </div>
  )
}
