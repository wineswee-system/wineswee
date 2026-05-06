import { useState, useEffect } from 'react'
import { Plus, Printer } from 'lucide-react'
import { getBusinessTrips, createBusinessTrip, updateBusinessTripStatus } from '../../lib/db'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printTripSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildWorkflowChainSteps } from '../../lib/buildChainSteps'

export default function BusinessTravel() {
  const { profile } = useAuth()
  const [trips, setTrips] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ employee: '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getBusinessTrips(),
      supabase.from('employees').select('id, name, dept, department_id, position, signature_url, departments!department_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([t, e, d, orgRes]) => {
      const emps = e.data || []
      setTrips(t.data || [])
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
    if (!form.destination || !form.start_date || !form.employee) return
    const payload = { ...form, budget: Number(form.budget) || 0 }

    // ── 編輯重送路徑 ──
    if (editingId) {
      const { error: updErr } = await supabase.from('business_trips')
        .update({ ...payload, status: '待審核', reject_reason: null })
        .eq('id', editingId)
      if (updErr) { alert('更新失敗：' + updErr.message); return }
      try {
        await supabase.rpc('resume_workflow_for_request', { p_type: 'trip', p_id: editingId })
      } catch (e) { console.error('[resume_workflow] failed:', e) }
      setTrips(prev => prev.map(t => t.id === editingId ? { ...t, ...payload, status: '待審核', reject_reason: null } : t))
      setShowModal(false)
      setEditingId(null)
      setForm({ employee: profile?.name || employees[0]?.name || '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })
      return
    }

    // ── 新增路徑 ──
    const { data } = await createBusinessTrip({ ...payload, status: '待審核' })
    if (data) {
      setTrips(prev => [...prev, data])
      setShowModal(false)
      setForm({ employee: profile?.name || employees[0]?.name || '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })
      await createApprovalWorkflow('business_trip', data, form.employee)
    }
  }

  const handleApprove = async (id) => {
    const { data } = await updateBusinessTripStatus(id, '已核准')
    if (data) setTrips(prev => prev.map(t => t.id === id ? data : t))
  }

  const handleReject = async (id) => {
    const reason = prompt('請輸入駁回原因：')
    if (reason === null) return
    if (!reason.trim()) { alert('請填寫駁回原因'); return }
    const { data } = await updateBusinessTripStatus(id, '已駁回', reason.trim())
    if (data) setTrips(prev => prev.map(t => t.id === id ? data : t))
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
      templateName: '出差申請簽核',
      applicantName: row.employee,
      applicantId: empRow?.id,
      applicantCreatedAt: row.created_at,
      recordStatus: row.status,
      approverName: row.approver,
      approvedAt: row.approved_at,
      rejectReason: row.reject_reason,
      fallbackTail: ['人資/財務'],
    })
    setDetailChainSteps(steps)
    setLoadingChain(false)
  }

  const filtered = trips.filter(t =>
    deptFilter === '' || getEmpDept(t.employee) === deptFilter
  )


  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">✈️</span> 公出差旅</h2>
            <p>出差申請與核准管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setEditingId(null); setShowModal(true) }}><Plus size={14} /> 新增差旅</button>
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
          <div className="stat-card-value">{filtered.filter(t => t.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{filtered.filter(t => t.status === '已核准').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">預算合計</div>
          <div className="stat-card-value">NT$ {filtered.reduce((s, t) => s + Number(t.budget || 0), 0).toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>員工</th><th>部門</th><th>目的地</th><th>出發日</th><th>回程日</th><th>事由</th><th>預算</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無差旅紀錄</td></tr>}
              {filtered.map(t => (
                <tr key={t.id} onClick={() => openDetail(t)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                  <td style={{ fontWeight: 600 }}>{t.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(t.employee) || '-'}</td>
                  <td>{t.destination}</td>
                  <td>{t.start_date}</td>
                  <td>{t.end_date}</td>
                  <td>{t.purpose}</td>
                  <td>NT$ {Number(t.budget).toLocaleString()}</td>
                  <td>
                    <span className={`badge ${t.status === '已核准' ? 'badge-success' : t.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{t.status}
                    </span>
                    {t.reject_reason && (
                      <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>原因：{t.reject_reason}</div>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {t.status === '待審核' && (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={() => handleApprove(t.id)}>核准</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleReject(t.id)}>駁回</button>
                        </>
                      )}
                      {(t.status === '已駁回' || t.status === '已退回') && t.employee === profile?.name && (
                        <button className="btn btn-sm btn-primary" style={{ background: 'var(--accent-orange)' }} onClick={() => {
                          setEditingId(t.id)
                          setForm({
                            employee: t.employee,
                            destination: t.destination || '',
                            start_date: t.start_date || '',
                            end_date: t.end_date || '',
                            purpose: t.purpose || '',
                            budget: t.budget?.toString() || '',
                          })
                          setShowModal(true)
                        }}>✏️ 編輯重送</button>
                      )}
                      <button className="btn btn-sm btn-secondary" title="下載簽呈"
                        onClick={() => printTripSignOff(t, {
                          companyName: organization?.name, logoUrl: organization?.logo_url,
                          dept: getEmpDept(t.employee),
                          signatures: Object.fromEntries(employees.filter(e => e.signature_url).map(e => [e.name, e.signature_url])),
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
        <Modal title={editingId ? '✏️ 編輯重送（駁回後修改）' : '新增差旅申請'} onClose={() => { setShowModal(false); setEditingId(null) }} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <SearchableSelect
              value={form.employee}
              onChange={(v) => set('employee', v || '')}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋員工姓名/職稱..."
            />
          </Field>
          <Field label="目的地">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：東京" value={form.destination} onChange={e => set('destination', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="出發日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="回程日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </Field>
          </div>
          <Field label="事由">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：客戶拜訪" value={form.purpose} onChange={e => set('purpose', e.target.value)} />
          </Field>
          <Field label="預算 (NT$)">
            <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.budget} onChange={e => set('budget', e.target.value)} />
          </Field>
        </Modal>
      )}

      {detailRow && (() => {
        const empRow = employees.find(e => e.name === detailRow.employee)
        const period = detailRow.start_date === detailRow.end_date || !detailRow.end_date
          ? detailRow.start_date
          : `${detailRow.start_date} ~ ${detailRow.end_date}`
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle="出差申請"
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
              { label: '出差地點', value: detailRow.destination },
              { label: '期間', value: period },
              { label: '預估費用', value: `NT$ ${Number(detailRow.budget || 0).toLocaleString()}` },
              { label: '出差目的', value: detailRow.purpose, multiline: true },
              ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ]}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            onPrint={() => printTripSignOff(detailRow, {
              companyName: organization?.name, logoUrl: organization?.logo_url,
              dept: getEmpDept(detailRow.employee),
              signatures: Object.fromEntries(employees.filter(e => e.signature_url).map(e => [e.name, e.signature_url])),
            })}
          />
        )
      })()}
    </div>
  )
}
