import { useEffect, useState, useMemo } from 'react'
import { Plus, CheckCircle, XCircle, ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import {
  findActiveChainByCategory, loadChainSteps,
  resolveFirstApprovers, approveChainStep, notifyApprovers,
} from '../../lib/hrChain'

const TRANSFER_TYPES = ['調職', '升遷', '降調', '部門調動', '跨店調動', '調薪']

const STATUS_BADGE = {
  '申請中': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1' },
  '已核准': { bg: 'rgba(34,197,94,0.12)',  color: 'var(--accent-green)' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
  '已取消': { bg: 'rgba(156,163,175,0.12)', color: 'var(--text-muted)' },
}

export default function TransferRequest() {
  const { profile, role } = useAuth()
  const isAdmin = ['super_admin','admin','manager'].includes(role?.name || profile?.role)
  const [list, setList] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [chainSteps, setChainSteps] = useState({})
  const [activeChain, setActiveChain] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [reviewModal, setReviewModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  function emptyForm() {
    return {
      employee_id: '',
      transfer_type: '調職',
      effective_date: '',
      new_department_id: '',
      new_store_id: '',
      new_position: '',
      new_base_salary: '',
      reason: '',
    }
  }

  const load = async () => {
    setLoading(true)
    let q = supabase.from('personnel_transfer_requests')
      .select(`*,
        employee:employees(id,name,name_en,department_id,store_id,position,role),
        approver:employees!approver_id(id,name),
        old_dept:departments!old_department_id(id,name),
        new_dept:departments!new_department_id(id,name),
        old_store:stores!old_store_id(id,name),
        new_store:stores!new_store_id(id,name)`)
      .order('id', { ascending: false })
    if (!isAdmin && profile?.id) q = q.eq('employee_id', profile.id)
    const [{ data: r }, { data: e }, { data: d }, { data: s }, chain] = await Promise.all([
      q,
      supabase.from('employees').select('id,name,name_en,position,department_id,store_id,role,dept,store,departments!department_id(name),stores!store_id(name)').eq('status','在職').order('name'),
      supabase.from('departments').select('id,name').order('name'),
      supabase.from('stores').select('id,name').eq('is_active', true).order('name'),
      findActiveChainByCategory('異動', profile?.organization_id),
    ])
    setList(r || [])
    setEmployees(e || [])
    setDepartments(d || [])
    setStores(s || [])
    setActiveChain(chain)

    const uniqChainIds = [...new Set((r || []).map(x => x.approval_chain_id).filter(Boolean))]
    if (chain?.id) uniqChainIds.push(chain.id)
    const stepMap = {}
    await Promise.all([...new Set(uniqChainIds)].map(async (cid) => {
      stepMap[cid] = await loadChainSteps(cid)
    }))
    setChainSteps(stepMap)
    setLoading(false)
  }
  useEffect(() => { load() }, [profile?.id, isAdmin, profile?.organization_id])

  const selectedEmp = employees.find(e => String(e.id) === String(form.employee_id))
  const formattedEmpOptions = useMemo(() => empOptions(employees), [employees])

  const handleSubmit = async () => {
    const empId = isAdmin ? form.employee_id : profile?.id
    if (!empId) return alert('請選擇員工')
    if (!form.effective_date) return alert('請填生效日')
    const payload = {
      employee_id: Number(empId),
      organization_id: profile?.organization_id || 1,
      transfer_type: form.transfer_type,
      effective_date: form.effective_date,
      old_department_id: selectedEmp?.department_id || null,
      old_store_id: selectedEmp?.store_id || null,
      old_position: selectedEmp?.position || null,
      old_role: selectedEmp?.role || null,
      new_department_id: form.new_department_id ? Number(form.new_department_id) : null,
      new_store_id: form.new_store_id ? Number(form.new_store_id) : null,
      new_position: form.new_position || null,
      new_base_salary: form.new_base_salary ? Number(form.new_base_salary) : null,
      reason: form.reason || null,
      status: '申請中',
      approval_chain_id: activeChain?.id || null,
      current_step: 0,
    }
    const { data: inserted, error } = await supabase.from('personnel_transfer_requests').insert(payload).select().single()
    if (error) return alert('送出失敗：' + error.message)

    if (activeChain?.id && inserted) {
      const approvers = await resolveFirstApprovers('transfer', inserted.id)
      if (approvers.length > 0) {
        const empName = employees.find(e => e.id === Number(empId))?.name || ''
        await notifyApprovers({
          approvers,
          title: `人事異動申請待簽核 — ${empName}`,
          message: `${form.transfer_type}・生效日 ${form.effective_date}`,
          type: 'form_submission',
          actionUrl: '/hr/forms/transfer',
          organizationId: profile?.organization_id,
        })
      }
    } else if (!activeChain) {
      alert('已送出（目前無「異動」簽核鏈，admin 可直接核准）。\n建議到「簽核鏈設定」建立 category=異動 的鏈。')
    }

    setShowForm(false)
    setForm(emptyForm())
    load()
  }

  const handleApprove = async (req) => {
    if (!confirm(`核准 ${req.employee?.name} 的異動申請？\n最後一關核准後 DB 會自動寫 position_history 並更新員工資料。`)) return
    const res = await approveChainStep({
      table: 'transfer', id: req.id,
      approverEmpId: profile?.id, action: 'approve',
    })
    if (!res?.ok) return alert('核准失敗：' + (res?.error || 'unknown'))
    if (res.event === 'advanced' && res.next_approvers?.length > 0) {
      await notifyApprovers({
        approvers: res.next_approvers,
        title: `人事異動申請待簽核 — ${req.employee?.name}`,
        message: `已通過第 ${res.advanced_to_step} 關前的簽核，輪到您`,
        type: 'form_submission',
        actionUrl: '/hr/forms/transfer',
        organizationId: profile?.organization_id,
      })
    }
    load()
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return alert('請填駁回原因')
    const res = await approveChainStep({
      table: 'transfer', id: reviewModal.id,
      approverEmpId: profile?.id, action: 'reject', reason: rejectReason,
    })
    if (!res?.ok) return alert('駁回失敗：' + (res?.error || 'unknown'))
    setReviewModal(null); setRejectReason('')
    load()
  }

  const handleCancel = async (req) => {
    if (!confirm('確定取消此申請？')) return
    await supabase.from('personnel_transfer_requests').update({ status: '已取消' }).eq('id', req.id)
    load()
  }

  if (loading) return <LoadingSpinner />

  const canIApprove = (req) => {
    if (req.status !== '申請中') return false
    const steps = chainSteps[req.approval_chain_id] || []
    const cur = steps.find(s => s.step_order === (req.current_step || 0))
    if (!cur) return isAdmin
    return cur.target_emp_id === profile?.id || isAdmin
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>人事異動申請</h2>
            <p>
              共 {list.length} 筆 · 申請中 {list.filter(r => r.status === '申請中').length} 筆
              {activeChain ? <span style={{ marginLeft: 8, color: 'var(--accent-cyan)', fontSize: 12 }}>· 簽核鏈：{activeChain.name}（{(chainSteps[activeChain.id] || []).length} 關）</span>
                : <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontSize: 12 }}>· ⚠ 無簽核鏈，admin 可直接核准</span>}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> 新增異動</button>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>類型</th>
                <th>異動內容</th>
                <th>生效日</th>
                <th>原因</th>
                <th>簽核進度</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無異動申請</td></tr>
              )}
              {list.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                const steps = chainSteps[r.approval_chain_id] || []
                const myTurn = canIApprove(r)
                const canCancel = r.status === '申請中' && (r.employee_id === profile?.id || isAdmin)
                return (
                  <tr key={r.id}>
                    <td><b>{r.employee?.name}</b>{r.employee?.name_en ? ` ${r.employee.name_en}` : ''}</td>
                    <td><span style={{ padding: '2px 6px', fontSize: 11, fontWeight: 600, borderRadius: 4, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)' }}>{r.transfer_type}</span></td>
                    <td style={{ fontSize: 12 }}>
                      <DiffRow label="部門" old={r.old_dept?.name} cur={r.new_dept?.name} />
                      <DiffRow label="門市" old={r.old_store?.name} cur={r.new_store?.name} />
                      <DiffRow label="職位" old={r.old_position} cur={r.new_position} />
                      {r.new_base_salary && <DiffRow label="薪資" old={r.old_base_salary || '—'} cur={`${r.new_base_salary}`} />}
                    </td>
                    <td>{r.effective_date}</td>
                    <td style={{ fontSize: 12, maxWidth: 180 }}>{r.reason || '—'}</td>
                    <td>
                      {steps.length === 0 ? (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>無鏈</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                          {steps.map((st, idx) => (
                            <span key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              {idx > 0 && <ArrowRight size={9} style={{ color: 'var(--text-muted)' }} />}
                              <span style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                                background: idx < (r.current_step || 0) ? 'var(--accent-green-dim)' :
                                            idx === (r.current_step || 0) && r.status === '申請中' ? 'var(--accent-orange-dim)' :
                                            'var(--glass-light)',
                                color: idx < (r.current_step || 0) ? 'var(--accent-green)' :
                                       idx === (r.current_step || 0) && r.status === '申請中' ? 'var(--accent-orange)' :
                                       'var(--text-muted)',
                              }} title={st.role_name || ''}>
                                {st.label || `第${idx + 1}關`}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td><span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{r.status}</span>{r.reject_reason && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{r.reject_reason}</div>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {myTurn && (
                          <>
                            <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-green)' }} onClick={() => handleApprove(r)}><CheckCircle size={11} /> 核准</button>
                            <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => setReviewModal(r)}><XCircle size={11} /> 駁回</button>
                          </>
                        )}
                        {canCancel && (
                          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleCancel(r)}>取消</button>
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

      {showForm && (
        <Modal title="新增人事異動申請" onClose={() => setShowForm(false)} onSubmit={handleSubmit} submitLabel="送出申請">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工">
              <SearchableSelect
                value={form.employee_id}
                onChange={(v) => setForm(f => ({ ...f, employee_id: v || '' }))}
                options={formattedEmpOptions}
                placeholder="搜尋員工姓名/職稱..."
              />
            </Field>
            <Field label="異動類型">
              <select className="form-input" style={{ width: '100%' }} value={form.transfer_type} onChange={e => setForm(f => ({ ...f, transfer_type: e.target.value }))}>
                {TRANSFER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="生效日">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} />
          </Field>
          {selectedEmp && (
            <div style={{ padding: 10, background: 'var(--glass-light)', borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>異動前資料</div>
              <div>部門：{departments.find(d => d.id === selectedEmp.department_id)?.name || '—'}</div>
              <div>門市：{stores.find(s => s.id === selectedEmp.store_id)?.name || '—'}</div>
              <div>職位：{selectedEmp.position || '—'}</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="新部門（可空）">
              <SearchableSelect
                value={form.new_department_id}
                onChange={(v) => setForm(f => ({ ...f, new_department_id: v || '' }))}
                options={departments.map(d => ({ value: d.id, label: d.name }))}
                placeholder="不變"
              />
            </Field>
            <Field label="新門市（可空）">
              <SearchableSelect
                value={form.new_store_id}
                onChange={(v) => setForm(f => ({ ...f, new_store_id: v || '' }))}
                options={stores.map(s => ({ value: s.id, label: s.name }))}
                placeholder="不變"
              />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="新職位（可空）">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：店長 / 督導 / 部門主管" value={form.new_position} onChange={e => setForm(f => ({ ...f, new_position: e.target.value }))} />
            </Field>
            <Field label="新基本薪資（可空）">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="例：45000" value={form.new_base_salary} onChange={e => setForm(f => ({ ...f, new_base_salary: e.target.value }))} />
            </Field>
          </div>
          <Field label="異動原因">
            <textarea className="form-input" rows={3} style={{ width: '100%' }} placeholder="例：擴編、員工輪調、績效升遷..." value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </Field>
          {activeChain && (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>送出後將進入簽核流程：{activeChain.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>申請人</span>
                {(chainSteps[activeChain.id] || []).map((st) => (
                  <span key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ArrowRight size={11} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)' }}>{st.label || st.role_name}</span>
                  </span>
                ))}
                <ArrowRight size={11} style={{ color: 'var(--text-muted)' }} />
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>✓ 自動寫入異動軌跡 + 員工資料</span>
              </div>
            </div>
          )}
        </Modal>
      )}

      {reviewModal && (
        <Modal title={`駁回 — ${reviewModal.employee?.name}`} onClose={() => { setReviewModal(null); setRejectReason('') }} onSubmit={handleReject} submitLabel="確認駁回">
          <Field label="駁回原因">
            <textarea className="form-input" rows={3} style={{ width: '100%' }} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}

function DiffRow({ label, old, cur }) {
  if (!cur || cur === old) {
    return <div style={{ color: 'var(--text-muted)' }}>{label}：{old || '—'}{cur === old && <span style={{ marginLeft: 4 }}>（不變）</span>}</div>
  }
  return (
    <div>
      <span style={{ color: 'var(--text-muted)' }}>{label}：</span>
      <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{old || '—'}</span>
      <ArrowRight size={11} style={{ display: 'inline', margin: '0 4px', color: 'var(--accent-cyan)' }} />
      <b style={{ color: 'var(--accent-cyan)' }}>{cur}</b>
    </div>
  )
}
