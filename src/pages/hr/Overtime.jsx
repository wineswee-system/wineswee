import { useState, useEffect } from 'react'
import { Plus, Printer } from 'lucide-react'
import { getOvertimeRequests, createOvertimeRequest, updateOvertimeStatus } from '../../lib/db'
import { createApprovalWorkflow, getWorkflowForRecord, advanceWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printOvertimeSignOff } from '../../lib/signOffAdapters'

export default function Overtime() {
  const { profile } = useAuth()
  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ employee: '', date: '', hours: 1, reason: '' })
  const [error, setError] = useState(null)

  // 各店的加班 step 設定 → {store_id: step}
  const [storeSteps, setStoreSteps] = useState({})
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  // employees 多帶 store_id 進來，這樣選人後可查 step
  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getOvertimeRequests(),
      supabase.from('employees').select('id, name, dept, store_id, department_id, position, signature_url, departments!department_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('id, overtime_step_hours'),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([r, e, d, s, orgRes]) => {
      const emps = e.data || []
      setRecords(r.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      const steps = {}
      ;(s.data || []).forEach(st => { steps[st.id] = Number(st.overtime_step_hours) || 0.5 })
      setStoreSteps(steps)
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
    try {
      if (!form.date || !form.employee) return

      // ── 編輯重送路徑 ──
      if (editingId) {
        const { error: updErr } = await supabase.from('overtime_requests')
          .update({ ...form, status: '待審核', reject_reason: null })
          .eq('id', editingId)
        if (updErr) throw updErr
        try {
          await supabase.rpc('resume_workflow_for_request', { p_type: 'overtime', p_id: editingId })
        } catch (e) { console.error('[resume_workflow] failed:', e) }
        setRecords(prev => prev.map(r => r.id === editingId ? { ...r, ...form, status: '待審核', reject_reason: null } : r))
        setShowModal(false)
        setEditingId(null)
        setForm({ employee: profile?.name || employees[0]?.name || '', date: '', hours: 1, reason: '' })
        return
      }

      // ── 新增路徑 ──
      const { data, error } = await createOvertimeRequest({ ...form, status: '待審核' })
      if (error) throw error
      if (data) {
        setRecords(prev => [...prev, data])
        setShowModal(false)
        setForm({ employee: profile?.name || employees[0]?.name || '', date: '', hours: 1, reason: '' })
        await createApprovalWorkflow('overtime', data, form.employee)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // Helper: write overtime hours to attendance_records
  const writeAttendance = async (rec) => {
    if (rec.employee && rec.date && rec.hours) {
      const { data: att } = await supabase.from('attendance_records')
        .select('id, hours')
        .eq(rec.employee_id ? 'employee_id' : 'employee', rec.employee_id || rec.employee)
        .eq('date', rec.date).maybeSingle()
      if (att) {
        await supabase.from('attendance_records').update({
          hours: (Number(att.hours) || 0) + Number(rec.hours),
        }).eq('id', att.id)
      } else {
        await supabase.from('attendance_records').insert({
          employee: rec.employee, date: rec.date,
          hours: Number(rec.hours), status: '加班',
        })
      }
    }
  }

  const handleApprove = async (id) => {
    try {
      const record = records.find(r => r.id === id)
      if (record) {
        const wf = await getWorkflowForRecord('加班簽核', record.employee)
        const pendingStep = wf?.workflow_steps?.find(s => s.status === '待處理')
        if (pendingStep) {
          const result = await advanceWorkflow(pendingStep.id, profile?.name || '主管', '核准')
          if (result.error) { alert('操作失敗：' + result.error); return }
          setRecords(prev => prev.map(r => r.id === id ? { ...r, status: '已核准' } : r))
          await writeAttendance(record)
          return
        }
      }
      // Fallback: no workflow running — use secure RPC (enforces org isolation + status guard)
      const { data, error } = await supabase.rpc('secure_update_overtime_status', {
        p_id: id, p_status: '已核准',
      })
      if (error) throw error
      if (data) {
        setRecords(prev => prev.map(r => r.id === id ? data : r))
        await writeAttendance(data)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleReject = async (id) => {
    const reason = prompt('請輸入駁回原因：')
    if (reason === null) return
    if (!reason.trim()) { alert('請填寫駁回原因'); return }
    try {
      const record = records.find(r => r.id === id)
      if (record) {
        const wf = await getWorkflowForRecord('加班簽核', record.employee)
        const pendingStep = wf?.workflow_steps?.find(s => s.status === '待處理')
        if (pendingStep) {
          const result = await advanceWorkflow(pendingStep.id, profile?.name || '主管', '退回', reason.trim())
          if (result.error) { alert('操作失敗：' + result.error); return }
          setRecords(prev => prev.map(r => r.id === id ? { ...r, status: '已拒絕' } : r))
          return
        }
      }
      // Fallback: no workflow running — use secure RPC (enforces org isolation + status guard)
      const { data, error } = await supabase.rpc('secure_update_overtime_status', {
        p_id: id, p_status: '已駁回', p_reject_reason: reason.trim(),
      })
      if (error) throw error
      if (data) setRecords(prev => prev.map(r => r.id === id ? data : r))
    } catch (err) {
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  const filtered = records.filter(r =>
    deptFilter === '' || getEmpDept(r.employee) === deptFilter
  )


  const totalHours = filtered.filter(r => r.status === '已核准').reduce((s, r) => s + (r.hours || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🕐</span> 加班申請</h2>
            <p>加班時數申請與審核</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setEditingId(null); setShowModal(true) }}><Plus size={14} /> 新增加班</button>
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
          <div className="stat-card-value">{filtered.filter(r => r.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '已核准').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">核准總時數</div>
          <div className="stat-card-value">{totalHours}h</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 加班紀錄</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>員工</th><th>部門</th><th>日期</th><th>時數</th><th>原因</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無加班紀錄</td></tr>}
              {filtered.map(o => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(o.employee) || '-'}</td>
                  <td>{o.date}</td>
                  <td>{o.hours}h</td>
                  <td>{o.reason}</td>
                  <td>
                    <span className={`badge ${o.status === '已核准' ? 'badge-success' : o.status === '已拒絕' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{o.status}
                    </span>
                    {o.reject_reason && (
                      <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>原因：{o.reject_reason}</div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {o.status === '待審核' && (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={() => handleApprove(o.id)}>核准</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleReject(o.id)}>駁回</button>
                        </>
                      )}
                      {(o.status === '已拒絕' || o.status === '已退回') && o.employee === profile?.name && (
                        <button className="btn btn-sm btn-primary" style={{ background: 'var(--accent-orange)' }} onClick={() => {
                          setEditingId(o.id)
                          setForm({ employee: o.employee, date: o.date || '', hours: o.hours || 1, reason: o.reason || '' })
                          setShowModal(true)
                        }}>✏️ 編輯重送</button>
                      )}
                      <button className="btn btn-sm btn-secondary" title="下載簽呈"
                        onClick={() => printOvertimeSignOff(o, {
                          companyName: organization?.name, logoUrl: organization?.logo_url,
                          dept: getEmpDept(o.employee),
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
        <Modal title={editingId ? '✏️ 編輯重送（駁回後修改）' : '新增加班申請'} onClose={() => { setShowModal(false); setEditingId(null) }} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <SearchableSelect
              value={form.employee}
              onChange={(v) => set('employee', v || '')}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋員工姓名/職稱..."
            />
          </Field>
          <Field label="加班日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => set('date', e.target.value)} />
          </Field>
          <Field label="加班時數">
            {(() => {
              const selectedEmp = employees.find(e => e.name === form.employee)
              const step = (selectedEmp && storeSteps[selectedEmp.store_id]) || 0.5
              const opts = []
              for (let v = step; v <= 12 + 1e-9; v += step) opts.push(Math.round(v * 100) / 100)
              // 若 form.hours 不在 opts 內，自動進位到最近合法值
              const safeHours = opts.includes(form.hours)
                ? form.hours
                : (opts.find(o => o >= form.hours) || opts[opts.length - 1])
              return (
                <>
                  <select
                    className="form-input"
                    style={{ width: '100%' }}
                    value={safeHours}
                    onChange={e => set('hours', Number(e.target.value))}
                  >
                    {opts.map(h => <option key={h} value={h}>{h} 小時</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    本店加班最小單位 <b style={{ color: 'var(--accent-cyan)' }}>{step}</b> 小時（可在「工時/假別單位」設定）
                  </div>
                </>
              )
            })()}
          </Field>
          <Field label="原因">
            <textarea className="form-input" rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="請輸入加班原因" value={form.reason} onChange={e => set('reason', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
