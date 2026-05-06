import { useState, useEffect } from 'react'
import { Plus, Printer } from 'lucide-react'
import { getExpenses, createExpense, updateExpenseStatus } from '../../lib/db'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { getEventBus } from '../../lib/events/index.js'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printExpenseSimpleSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildWorkflowChainSteps } from '../../lib/buildChainSteps'

const CATEGORIES = ['交通', '住宿', '餐飲', '設備', '其他']

export default function Expenses() {
  const { profile } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ employee: '', category: CATEGORIES[0], amount: '', date: '', description: '', receipt: true })
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getExpenses(),
      supabase.from('employees').select('id, name, name_en, dept, department_id, store, store_id, position, signature_url, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([ex, e, d, orgRes]) => {
      const emps = e.data || []
      setExpenses(ex.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      setOrganization(orgRes?.data || null)
      setForm(f => ({ ...f, employee: emps[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.amount || !form.date || !form.employee) return
    const payload = { ...form, amount: Number(form.amount) }

    // ── 編輯重送路徑 ──
    if (editingId) {
      const { error: updErr } = await supabase.from('expenses')
        .update({ ...payload, status: '待審核', reject_reason: null })
        .eq('id', editingId)
      if (updErr) { alert('更新失敗：' + updErr.message); return }
      try {
        await supabase.rpc('resume_workflow_for_request', { p_type: 'expense', p_id: editingId })
      } catch (e) { console.error('[resume_workflow] failed:', e) }
      setExpenses(prev => prev.map(x => x.id === editingId ? { ...x, ...payload, status: '待審核', reject_reason: null } : x))
      setShowModal(false)
      setEditingId(null)
      setForm({ employee: profile?.name || employees[0]?.name || '', category: CATEGORIES[0], amount: '', date: '', description: '', receipt: true })
      return
    }

    // ── 新增路徑 ──
    const { data } = await createExpense({ ...payload, status: '待審核' })
    if (data) {
      setExpenses(prev => [...prev, data])
      setShowModal(false)
      setForm({ employee: profile?.name || employees[0]?.name || '', category: CATEGORIES[0], amount: '', date: '', description: '', receipt: true })
      await createApprovalWorkflow('expense', data, form.employee)
    }
  }

  const handleApprove = async (id) => {
    const { data } = await updateExpenseStatus(id, '已核銷')
    if (data) {
      setExpenses(prev => prev.map(e => e.id === id ? data : e))
      getEventBus().publish('hr.expense.approved', {
        expense_id: data.id,
        employee: data.employee,
        category: data.category,
        amount: data.amount,
        description: data.description,
        date: data.date,
      }, { source: 'Expenses.jsx' })
      alert('已核銷並發送費用核准事件')
    }
  }

  const handleReject = async (id) => {
    const reason = prompt('請輸入駁回原因：')
    if (reason === null) return
    if (!reason.trim()) { alert('請填寫駁回原因'); return }
    const { data } = await updateExpenseStatus(id, '已駁回', reason.trim())
    if (data) setExpenses(prev => prev.map(e => e.id === id ? data : e))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  const openDetail = async (row) => {
    setDetailRow(row)
    setLoadingChain(true)
    setDetailChainSteps([])
    const empRow = employees.find(e => e.name === row.employee)
    const steps = await buildWorkflowChainSteps({
      templateName: '費用報帳簽核',
      applicantName: row.employee,
      applicantId: empRow?.id,
      applicantCreatedAt: row.created_at,
      recordStatus: row.status,
    })
    setDetailChainSteps(steps)
    setLoadingChain(false)
  }

  const filtered = expenses.filter(e =>
    deptFilter === '' || getEmpDept(e.employee) === deptFilter
  )


  const totalPending = filtered.filter(e => e.status === '待審核').reduce((s, e) => s + Number(e.amount), 0)
  const totalApproved = filtered.filter(e => e.status === '已核銷').reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧾</span> 費用核銷</h2>
            <p>報銷申請與審核</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setEditingId(null); setShowModal(true) }}><Plus size={14} /> 新增報銷</button>
        </div>
      </div>

      {/* 部門篩選 */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待審核</div>
          <div className="stat-card-value">{filtered.filter(e => e.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核銷金額</div>
          <div className="stat-card-value">NT$ {totalApproved.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">待核銷金額</div>
          <div className="stat-card-value">NT$ {totalPending.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>員工</th><th>部門</th><th>類別</th><th>金額</th><th>日期</th><th>說明</th><th>收據</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無報銷申請</td></tr>}
              {filtered.map(e => (
                <tr key={e.id} onClick={() => openDetail(e)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                  onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                  <td style={{ fontWeight: 600 }}>{e.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(e.employee) || '-'}</td>
                  <td><span className="badge badge-info">{e.category}</span></td>
                  <td style={{ fontWeight: 600 }}>NT$ {Number(e.amount).toLocaleString()}</td>
                  <td>{e.date}</td>
                  <td>{e.description}</td>
                  <td>{e.receipt ? <span className="badge badge-success">✓ 有</span> : <span className="badge badge-danger">✗ 無</span>}</td>
                  <td>
                    <span className={`badge ${e.status === '已核銷' ? 'badge-success' : e.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{e.status}
                    </span>
                    {e.reject_reason && (
                      <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>原因：{e.reject_reason}</div>
                    )}
                  </td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {e.status === '待審核' && (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={() => handleApprove(e.id)}>核銷</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleReject(e.id)}>駁回</button>
                        </>
                      )}
                      {(e.status === '已駁回' || e.status === '已退回') && e.employee === profile?.name && (
                        <button className="btn btn-sm btn-primary" style={{ background: 'var(--accent-orange)' }} onClick={() => {
                          setEditingId(e.id)
                          setForm({
                            employee: e.employee,
                            category: e.category || CATEGORIES[0],
                            amount: e.amount?.toString() || '',
                            date: e.date || '',
                            description: e.description || '',
                            receipt: e.receipt ?? true,
                          })
                          setShowModal(true)
                        }}>✏️ 編輯重送</button>
                      )}
                      <button className="btn btn-sm btn-secondary" title="下載簽呈"
                        onClick={() => printExpenseSimpleSignOff(e, {
                          companyName: organization?.name, logoUrl: organization?.logo_url,
                          dept: getEmpDept(e.employee),
                          signatures: Object.fromEntries(employees.filter(emp => emp.signature_url).map(emp => [emp.name, emp.signature_url])),
                        })}>
                        <Printer size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editingId ? '✏️ 編輯重送（駁回後修改）' : '新增報銷申請'} onClose={() => { setShowModal(false); setEditingId(null) }} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <SearchableSelect
              value={form.employee}
              onChange={(v) => set('employee', v || '')}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋員工姓名/職稱..."
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="類別">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="金額 (NT$)">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.amount} onChange={e => set('amount', e.target.value)} />
            </Field>
          </div>
          <Field label="日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => set('date', e.target.value)} />
          </Field>
          <Field label="說明">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="費用說明" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
          <Field label="收據">
            <select className="form-input" style={{ width: '100%' }} value={form.receipt} onChange={e => set('receipt', e.target.value === 'true')}>
              <option value="true">有收據</option>
              <option value="false">無收據</option>
            </select>
          </Field>
        </Modal>
      )}

      {detailRow && (() => {
        const empRow = employees.find(e => e.name === detailRow.employee)
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle="費用報銷"
            docNo={detailRow.id}
            status={detailRow.status}
            applicant={{
              name: detailRow.employee,
              name_en: empRow?.name_en,
              position: empRow?.position,
              dept: getEmpDept(detailRow.employee),
              status: empRow?.status,
              employee_no: empRow?.employee_no,
            }}
            fields={[
              { label: '費用類別', value: detailRow.category },
              { label: '發生日期', value: detailRow.date },
              { label: '金額', value: `NT$ ${Number(detailRow.amount || 0).toLocaleString()}` },
              { label: '是否有收據', value: detailRow.receipt ? '有' : '無' },
              { label: '用途', value: detailRow.description, multiline: true },
              ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ]}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            onPrint={() => printExpenseSimpleSignOff(detailRow, {
              companyName: organization?.name, logoUrl: organization?.logo_url,
              dept: getEmpDept(detailRow.employee),
              signatures: Object.fromEntries(employees.filter(emp => emp.signature_url).map(emp => [emp.name, emp.signature_url])),
            })}
          />
        )
      })()}
    </div>
  )
}
