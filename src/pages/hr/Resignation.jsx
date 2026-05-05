import { useEffect, useState } from 'react'
import { Plus, FileText, CheckCircle, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

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
    const [{ data: r }, { data: e }] = await Promise.all([
      supabase.from('resignation_requests')
        .select('*, employee:employees(id,name,name_en,department_id,position), approver:employees!approver_id(id,name)')
        .order('id', { ascending: false }),
      supabase.from('employees').select('id,name,name_en,position').eq('status','在職').order('name'),
    ])
    setList(r || [])
    setEmployees(e || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.employee_id) return alert('請選擇員工')
    if (!form.planned_resign_date) return alert('請填預計離職日')
    const payload = {
      employee_id: Number(form.employee_id),
      planned_resign_date: form.planned_resign_date,
      reason: form.reason,
      reason_detail: form.reason_detail || null,
      handover_notes: form.handover_notes || null,
      organization_id: profile?.organization_id || 1,
      status: '申請中',
    }
    const { error } = await supabase.from('resignation_requests').insert(payload)
    if (error) return alert('送出失敗：' + error.message)
    setShowForm(false)
    setForm({ employee_id: profile?.id || '', planned_resign_date: '', reason: '個人因素', reason_detail: '', handover_notes: '' })
    load()
  }

  const handleApprove = async (req) => {
    if (!confirm(`核准 ${req.employee?.name} 的離職申請？\n核准後會自動將員工狀態改為「離職」。`)) return
    const { error } = await supabase.from('resignation_requests').update({
      status: '已核准',
      approver_id: profile?.id || null,
      approved_at: new Date().toISOString(),
    }).eq('id', req.id)
    if (error) return alert('核准失敗：' + error.message)
    // 同步更新 employees
    await supabase.from('employees').update({
      status: '離職',
      resign_date: req.planned_resign_date,
      resign_reason: req.reason + (req.reason_detail ? `（${req.reason_detail}）` : ''),
    }).eq('id', req.employee_id)
    load()
  }

  const handleReject = async () => {
    if (!rejectReason) return alert('請填駁回原因')
    const { error } = await supabase.from('resignation_requests').update({
      status: '已駁回',
      approver_id: profile?.id || null,
      approved_at: new Date().toISOString(),
      reject_reason: rejectReason,
    }).eq('id', reviewModal.id)
    if (error) return alert('駁回失敗：' + error.message)
    setReviewModal(null)
    setRejectReason('')
    load()
  }

  const handleCancel = async (req) => {
    if (!confirm('確定取消此申請？')) return
    await supabase.from('resignation_requests').update({ status: '已取消' }).eq('id', req.id)
    load()
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>離職申請</h2>
            <p>共 {list.length} 筆 · 申請中 {list.filter(r => r.status === '申請中').length} 筆</p>
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
                <th>狀態</th>
                <th>核准人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無離職申請</td></tr>
              )}
              {list.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                const canApprove = isAdmin && r.status === '申請中'
                const canCancel = r.status === '申請中' && (r.employee_id === profile?.id || isAdmin)
                return (
                  <tr key={r.id}>
                    <td><b>{r.employee?.name}</b>{r.employee?.name_en ? ` ${r.employee.name_en}` : ''}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employee?.position}</div></td>
                    <td>{r.planned_resign_date}</td>
                    <td>{r.reason}{r.reason_detail ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.reason_detail}</div> : null}</td>
                    <td style={{ fontSize: 12, maxWidth: 200, whiteSpace: 'pre-wrap' }}>{r.handover_notes || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.created_at?.slice(0, 10)}</td>
                    <td><span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{r.status}</span></td>
                    <td style={{ fontSize: 12 }}>{r.approver?.name || '—'}{r.reject_reason ? <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>{r.reject_reason}</div> : null}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canApprove && (
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
            <select className="form-input" style={{ width: '100%' }} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
              <option value="">請選擇</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.name_en ? ` ${e.name_en}` : ''} - {e.position || ''}</option>)}
            </select>
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
