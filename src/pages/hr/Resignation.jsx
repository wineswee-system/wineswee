import { useEffect, useState, useMemo } from 'react'
import { Plus, CheckCircle, XCircle, ArrowRight, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import {
  findActiveChainByCategory, loadChainSteps,
  resolveFirstApprovers, approveChainStep, notifyApprovers,
} from '../../lib/hrChain'
import { printResignationSignOff } from '../../lib/signOffAdapters'

const REASONS = ['個人因素', '家庭因素', '健康因素', '另謀高就', '進修', '退休', '其他']

const STATUS_BADGE = {
  '申請中': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1' },
  '已核准': { bg: 'rgba(34,197,94,0.12)',  color: 'var(--accent-green)' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
  '已取消': { bg: 'rgba(156,163,175,0.12)', color: 'var(--text-muted)' },
}

export default function Resignation() {
  const { profile, role } = useAuth()
  const isAdmin = ['super_admin','admin','manager'].includes(role?.name || profile?.role)
  const [list, setList] = useState([])
  const [employees, setEmployees] = useState([])
  const [chainSteps, setChainSteps] = useState({})  // { chainId: [steps] }
  const [activeChain, setActiveChain] = useState(null)
  const [organization, setOrganization] = useState(null)  // { name, logo_url } 印簽呈用
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    employee_id: profile?.id || '',
    planned_resign_date: '',
    reason: '個人因素',
    reason_detail: '',
    handover_notes: '',
  })
  const [reviewModal, setReviewModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = async () => {
    setLoading(true)
    let q = supabase.from('resignation_requests')
      .select('*, employee:employees(id,name,name_en,department_id,position), approver:employees!approver_id(id,name)')
      .order('id', { ascending: false })
    if (!isAdmin && profile?.id) q = q.eq('employee_id', profile.id)
    const orgId = profile?.organization_id
    const [{ data: r }, { data: e }, chain, orgRes] = await Promise.all([
      q,
      supabase.from('employees').select('id,name,name_en,position,dept,department_id,store,store_id,departments!department_id(name),stores!store_id(name)').eq('status','在職').order('name'),
      findActiveChainByCategory('離職', orgId),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setList(r || [])
    setEmployees(e || [])
    setActiveChain(chain)
    setOrganization(orgRes?.data || null)

    // 預載各 chain 的步驟
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

  const handleSubmit = async () => {
    const empId = isAdmin ? form.employee_id : profile?.id
    if (!empId) return alert('請選擇員工')
    if (!form.planned_resign_date) return alert('請填預計離職日')
    const payload = {
      employee_id: Number(empId),
      planned_resign_date: form.planned_resign_date,
      reason: form.reason,
      reason_detail: form.reason_detail || null,
      handover_notes: form.handover_notes || null,
      organization_id: profile?.organization_id || 1,
      status: '申請中',
      approval_chain_id: activeChain?.id || null,
      current_step: 0,
    }
    const { data: inserted, error } = await supabase.from('resignation_requests').insert(payload).select().single()
    if (error) return alert('送出失敗：' + error.message)

    // 推第一審
    if (activeChain?.id && inserted) {
      const approvers = await resolveFirstApprovers('resignation', inserted.id)
      if (approvers.length > 0) {
        const empName = employees.find(e => e.id === Number(empId))?.name || ''
        await notifyApprovers({
          approvers,
          title: `離職申請待簽核 — ${empName}`,
          message: `預計離職日：${form.planned_resign_date}・原因：${form.reason}`,
          type: 'form_submission',
          actionUrl: '/hr/forms/resignation',
          organizationId: profile?.organization_id,
        })
      } else {
        alert('已送出，但找不到對應的第一關簽核人。請確認簽核鏈設定。')
      }
    } else if (!activeChain) {
      alert('已送出（目前無「離職」簽核鏈，admin 可直接核准）。\n建議到「簽核鏈設定」建立 category=離職 的鏈。')
    }

    setShowForm(false)
    setForm({ employee_id: profile?.id || '', planned_resign_date: '', reason: '個人因素', reason_detail: '', handover_notes: '' })
    load()
  }

  const handleApprove = async (req) => {
    if (!confirm(`核准 ${req.employee?.name} 的離職申請？\n最後一關核准後會自動把員工狀態改為「離職」。`)) return
    const res = await approveChainStep({
      table: 'resignation', id: req.id,
      approverEmpId: profile?.id, action: 'approve',
    })
    if (!res?.ok) return alert('核准失敗：' + (res?.error || 'unknown'))

    // 若推進到下一關 → 推通知
    if (res.event === 'advanced' && res.next_approvers?.length > 0) {
      await notifyApprovers({
        approvers: res.next_approvers,
        title: `離職申請待簽核 — ${req.employee?.name}`,
        message: `已通過第 ${res.advanced_to_step} 關前的簽核，輪到您`,
        type: 'form_submission',
        actionUrl: '/hr/forms/resignation',
        organizationId: profile?.organization_id,
      })
    }
    load()
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return alert('請填駁回原因')
    const res = await approveChainStep({
      table: 'resignation', id: reviewModal.id,
      approverEmpId: profile?.id, action: 'reject', reason: rejectReason,
    })
    if (!res?.ok) return alert('駁回失敗：' + (res?.error || 'unknown'))
    setReviewModal(null)
    setRejectReason('')
    load()
  }

  const handleCancel = async (req) => {
    if (!confirm('確定取消此申請？')) return
    await supabase.from('resignation_requests').update({ status: '已取消' }).eq('id', req.id)
    load()
  }

  const formattedEmpOptions = useMemo(() => empOptions(employees), [employees])

  if (loading) return <LoadingSpinner />

  // 我是不是當前 step 的合法簽核人
  const canIApprove = (req) => {
    if (req.status !== '申請中') return false
    const steps = chainSteps[req.approval_chain_id] || []
    const cur = steps.find(s => s.step_order === (req.current_step || 0))
    if (!cur) return isAdmin  // 沒 chain → 退回 admin 老邏輯
    // 簡化：暫時以 target_emp_id 為主，dept/role 之後再加（gitnexus 不確定 employees 有 role_id）
    return cur.target_emp_id === profile?.id || isAdmin
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>離職申請</h2>
            <p>
              共 {list.length} 筆 · 申請中 {list.filter(r => r.status === '申請中').length} 筆
              {activeChain ? <span style={{ marginLeft: 8, color: 'var(--accent-cyan)', fontSize: 12 }}>· 簽核鏈：{activeChain.name}（{(chainSteps[activeChain.id] || []).length} 關）</span>
                : <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontSize: 12 }}>· ⚠ 無簽核鏈，admin 可直接核准</span>}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> 新增申請</button>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>預計離職日</th>
                <th>原因</th>
                <th>交接</th>
                <th>申請日</th>
                <th>簽核進度</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無離職申請</td></tr>
              )}
              {list.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                const steps = chainSteps[r.approval_chain_id] || []
                const myTurn = canIApprove(r)
                const canCancel = r.status === '申請中' && (r.employee_id === profile?.id || isAdmin)
                return (
                  <tr key={r.id}>
                    <td><b>{r.employee?.name}</b>{r.employee?.name_en ? ` ${r.employee.name_en}` : ''}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employee?.position}</div></td>
                    <td>{r.planned_resign_date}</td>
                    <td>{r.reason}{r.reason_detail ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.reason_detail}</div> : null}</td>
                    <td style={{ fontSize: 12, maxWidth: 200, whiteSpace: 'pre-wrap' }}>{r.handover_notes || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.created_at?.slice(0, 10)}</td>
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
                            <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-green)' }}
                              onClick={() => handleApprove(r)}><CheckCircle size={11} /> 核准</button>
                            <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }}
                              onClick={() => setReviewModal(r)}><XCircle size={11} /> 駁回</button>
                          </>
                        )}
                        {canCancel && (
                          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleCancel(r)}>取消</button>
                        )}
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} title="下載簽呈"
                          onClick={() => printResignationSignOff(r, { companyName: organization?.name, logoUrl: organization?.logo_url })}>
                          <Printer size={11} />
                        </button>
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
        <Modal title="新增離職申請" onClose={() => setShowForm(false)} onSubmit={handleSubmit} submitLabel="送出申請">
          <Field label="員工">
            {isAdmin ? (
              <SearchableSelect
                value={form.employee_id}
                onChange={(v) => setForm(f => ({ ...f, employee_id: v || '' }))}
                options={formattedEmpOptions}
                placeholder="搜尋員工姓名/職稱..."
              />
            ) : (
              <input className="form-input" style={{ width: '100%' }} value={`${profile?.name || ''}${profile?.name_en ? ' ' + profile.name_en : ''}`} disabled />
            )}
          </Field>
          <Field label="預計離職日">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.planned_resign_date} onChange={e => setForm(f => ({ ...f, planned_resign_date: e.target.value }))} />
          </Field>
          <Field label="離職原因">
            <select className="form-input" style={{ width: '100%' }} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="原因說明（選填）">
            <input className="form-input" type="text" style={{ width: '100%' }} value={form.reason_detail} onChange={e => setForm(f => ({ ...f, reason_detail: e.target.value }))} />
          </Field>
          <Field label="交接事項">
            <textarea className="form-input" rows={4} style={{ width: '100%' }} placeholder="例：A 專案交接給 XXX、客戶聯絡資料整理在共享資料夾..." value={form.handover_notes} onChange={e => setForm(f => ({ ...f, handover_notes: e.target.value }))} />
          </Field>
          {activeChain && (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>送出後將進入簽核流程：{activeChain.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>申請人</span>
                {(chainSteps[activeChain.id] || []).map((st, i) => (
                  <span key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ArrowRight size={11} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)' }}>{st.label || st.role_name}</span>
                  </span>
                ))}
                <ArrowRight size={11} style={{ color: 'var(--text-muted)' }} />
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>✓ 員工狀態自動改為離職</span>
              </div>
            </div>
          )}
        </Modal>
      )}

      {reviewModal && (
        <Modal title={`駁回 — ${reviewModal.employee?.name}`} onClose={() => { setReviewModal(null); setRejectReason('') }} onSubmit={handleReject} submitLabel="確認駁回">
          <Field label="駁回原因">
            <textarea className="form-input" rows={3} style={{ width: '100%' }} placeholder="請說明駁回原因（員工會收到）" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
