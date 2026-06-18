import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'

// 提早下班登記（店方安排早退）— 純紀錄、無簽核
// 記一筆後，計薪那天會跳過「早退扣款」，底薪照實際打卡時數算 → 直接算對，班表不動。
export default function EarlyLeaveForm() {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ employee_id: '', date: '', early_from: '', early_to: '', reason: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const fetchData = async () => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    const [empRes, recRes] = await Promise.all([
      supabase.from('employees').select('id, name, dept, store, store_id')
        .eq('status', '在職').eq('organization_id', orgId).order('name'),
      supabase.from('early_leave_records').select('*')
        .eq('organization_id', orgId).order('date', { ascending: false }).limit(200),
    ])
    setEmployees(empRes.data || [])
    setRecords(recRes.data || [])
    setLoading(false)
  }
  useEffect(() => { fetchData() }, [profile?.organization_id]) // eslint-disable-line

  // 選了員工 + 日期 → 自動帶入「班表下班」當 early_to、「實際打卡下班」當 early_from
  useEffect(() => {
    const emp = employees.find(e => e.id === form.employee_id)
    if (!emp || !form.date) return
    let cancelled = false
    ;(async () => {
      const [sch, att] = await Promise.all([
        supabase.from('schedules').select('actual_end').eq('employee_id', emp.id).eq('date', form.date).maybeSingle(),
        supabase.from('attendance_records').select('clock_out').eq('employee_id', emp.id).eq('date', form.date).maybeSingle(),
      ])
      if (cancelled) return
      const to = sch.data?.actual_end?.slice(0, 5)
      const from = att.data?.clock_out?.slice(11, 16) || att.data?.clock_out?.slice(0, 5)
      setForm(f => ({ ...f, early_to: f.early_to || to || '', early_from: f.early_from || from || '' }))
    })()
    return () => { cancelled = true }
  }, [form.employee_id, form.date]) // eslint-disable-line

  const openAdd = () => {
    setForm({ employee_id: '', date: '', early_from: '', early_to: '', reason: '' })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!form.employee_id || !form.date) { toast.warning('請選員工與日期'); return false }
    const emp = employees.find(e => e.id === form.employee_id)
    const { error } = await supabase.from('early_leave_records').upsert({
      employee_id: form.employee_id,
      date: form.date,
      store_id: emp?.store_id || null,
      early_from: form.early_from || null,
      early_to: form.early_to || null,
      reason: form.reason || null,
      created_by: profile?.id || null,
      organization_id: profile?.organization_id,
    }, { onConflict: 'employee_id,date' })
    if (error) { toast.error('登記失敗：' + error.message); return false }
    fetchData()
  }

  const handleDelete = async (id) => {
    const { error } = await supabase.from('early_leave_records').delete().eq('id', id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    setRecords(rs => rs.filter(r => r.id !== id))
  }

  const empName = (id) => employees.find(e => e.id === id)?.name || `#${id}`

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2><span className="header-icon">🕒</span> 提早下班登記</h2>
          <p>店方安排員工提早下班（無需簽核）。登記後當天不計早退扣款，薪資照實際工時算。</p>
        </div>
        <button className="btn btn-primary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={openAdd}>
          <Plus size={14} /> 新增登記
        </button>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>員工</th><th>日期</th><th>提早離開</th><th>原下班</th><th>原因</th><th></th></tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 28 }}>尚無登記紀錄，點右上「新增登記」</td></tr>
            )}
            {records.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{empName(r.employee_id)}</td>
                <td>{r.date}</td>
                <td style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>{r.early_from?.slice(0, 5) || '—'}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{r.early_to?.slice(0, 5) || '—'}</td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{r.reason || '—'}</td>
                <td>
                  <button className="btn btn-icon" title="刪除" onClick={() => handleDelete(r.id)} style={{ color: 'var(--accent-red)' }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title="新增提早下班登記" onClose={() => setShowModal(false)} onSubmit={handleSubmit} submitLabel="登記">
          <Field label="員工" required>
            <SearchableSelect value={form.employee_id || null} onChange={v => set('employee_id', v || '')}
              options={empOptions(employees, { keyBy: 'id' })} placeholder="搜尋員工姓名/職稱..." />
          </Field>
          <Field label="日期" required>
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => set('date', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="提早離開時間">
              <input className="form-input" type="time" step="60" lang="en-GB" style={{ width: '100%' }}
                value={form.early_from} onChange={e => set('early_from', e.target.value)} />
            </Field>
            <Field label="原班表下班時間">
              <input className="form-input" type="time" step="60" lang="en-GB" style={{ width: '100%' }}
                value={form.early_to} onChange={e => set('early_to', e.target.value)} />
            </Field>
          </div>
          <Field label="原因">
            <input className="form-input" style={{ width: '100%' }} value={form.reason} onChange={e => set('reason', e.target.value)}
              placeholder="例：生意清淡、人力過剩，店方安排提早下班" />
          </Field>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            選員工 + 日期後，系統會自動帶入班表/打卡時間，可再調整。
          </div>
        </Modal>
      )}
    </div>
  )
}
