import { useEffect, useState } from 'react'
import { Plus, CheckCircle, XCircle, ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

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
    const [{ data: r }, { data: e }, { data: d }, { data: s }] = await Promise.all([
      supabase.from('personnel_transfer_requests')
        .select(`*,
          employee:employees(id,name,name_en,department_id,store_id,position,role),
          approver:employees!approver_id(id,name),
          old_dept:departments!old_department_id(id,name),
          new_dept:departments!new_department_id(id,name),
          old_store:stores!old_store_id(id,name),
          new_store:stores!new_store_id(id,name)`)
        .order('id', { ascending: false }),
      supabase.from('employees').select('id,name,name_en,position,department_id,store_id,role').eq('status','在職').order('name'),
      supabase.from('departments').select('id,name').order('name'),
      supabase.from('stores').select('id,name').eq('is_active', true).order('name'),
    ])
    setList(r || [])
    setEmployees(e || [])
    setDepartments(d || [])
    setStores(s || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const selectedEmp = employees.find(e => String(e.id) === String(form.employee_id))

  const handleSubmit = async () => {
    if (!form.employee_id) return alert('請選擇員工')
    if (!form.effective_date) return alert('請填生效日')
    const payload = {
      employee_id: Number(form.employee_id),
      organization_id: profile?.organization_id || 1,
      transfer_type: form.transfer_type,
      effective_date: form.effective_date,
      // snapshot 異動前
      old_department_id: selectedEmp?.department_id || null,
      old_store_id: selectedEmp?.store_id || null,
      old_position: selectedEmp?.position || null,
      old_role: selectedEmp?.role || null,
      // 目標
      new_department_id: form.new_department_id ? Number(form.new_department_id) : null,
      new_store_id: form.new_store_id ? Number(form.new_store_id) : null,
      new_position: form.new_position || null,
      new_base_salary: form.new_base_salary ? Number(form.new_base_salary) : null,
      reason: form.reason || null,
      status: '申請中',
    }
    const { error } = await supabase.from('personnel_transfer_requests').insert(payload)
    if (error) return alert('送出失敗：' + error.message)
    setShowForm(false)
    setForm(emptyForm())
    load()
  }

  const handleApprove = async (req) => {
    if (!confirm(`核准 ${req.employee?.name} 的異動申請？\n生效日 ${req.effective_date} 起會自動更新員工資料。`)) return
    const now = new Date().toISOString()
    // 1. 寫 personnel_transfer_requests 為已核准
    await supabase.from('personnel_transfer_requests').update({
      status: '已核准', approver_id: profile?.id || null, approved_at: now,
    }).eq('id', req.id)
    // 2. 寫 position_history（前任職務結束）
    await supabase.from('position_history').insert([
      {
        employee_id: req.employee_id,
        organization_id: req.organization_id,
        effective_date: req.effective_date,
        end_date: null,
        department_id: req.new_department_id || req.old_department_id,
        store_id: req.new_store_id || req.old_store_id,
        position: req.new_position || req.old_position,
        base_salary: req.new_base_salary,
        role: req.new_role || req.old_role,
        change_type: req.transfer_type,
        reason: req.reason,
        source_request_id: req.id,
        changed_by: profile?.id || null,
      },
    ])
    // 3. 異動生效日 <= 今日 → 立刻 UPDATE employees
    const today = new Date().toISOString().slice(0, 10)
    if (req.effective_date <= today) {
      const empUpdate = {}
      if (req.new_department_id) empUpdate.department_id = req.new_department_id
      if (req.new_store_id) empUpdate.store_id = req.new_store_id
      if (req.new_position) empUpdate.position = req.new_position
      if (req.new_base_salary) {
        // base_salary 在 salary_structures 表，這裡略過（或之後接 salary 模組）
      }
      if (Object.keys(empUpdate).length > 0) {
        await supabase.from('employees').update(empUpdate).eq('id', req.employee_id)
      }
    }
    // （未來 cron 可掃 effective_date <= today 但還沒套用的 record，補套用）
    load()
  }

  const handleReject = async () => {
    if (!rejectReason) return alert('請填駁回原因')
    await supabase.from('personnel_transfer_requests').update({
      status: '已駁回', approver_id: profile?.id || null,
      approved_at: new Date().toISOString(), reject_reason: rejectReason,
    }).eq('id', reviewModal.id)
    setReviewModal(null); setRejectReason('')
    load()
  }

  const handleCancel = async (req) => {
    if (!confirm('確定取消此申請？')) return
    await supabase.from('personnel_transfer_requests').update({ status: '已取消' }).eq('id', req.id)
    load()
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>人事異動申請</h2>
            <p>共 {list.length} 筆 · 申請中 {list.filter(r => r.status === '申請中').length} 筆</p>
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
                <th>狀態</th>
                <th>核准人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無異動申請</td></tr>
              )}
              {list.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                const canApprove = isAdmin && r.status === '申請中'
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
                    <td><span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{r.status}</span></td>
                    <td style={{ fontSize: 12 }}>{r.approver?.name || '—'}{r.reject_reason && <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>{r.reject_reason}</div>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canApprove && (
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
              <select className="form-input" style={{ width: '100%' }} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                <option value="">請選擇</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.name_en ? ` ${e.name_en}` : ''}</option>)}
              </select>
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
              <select className="form-input" style={{ width: '100%' }} value={form.new_department_id} onChange={e => setForm(f => ({ ...f, new_department_id: e.target.value }))}>
                <option value="">不變</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="新門市（可空）">
              <select className="form-input" style={{ width: '100%' }} value={form.new_store_id} onChange={e => setForm(f => ({ ...f, new_store_id: e.target.value }))}>
                <option value="">不變</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
