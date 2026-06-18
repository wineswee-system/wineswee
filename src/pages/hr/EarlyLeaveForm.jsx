import { useState, useEffect } from 'react'
import { Clock, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'

// 提早下班登記（店方安排早退）— 純紀錄、無簽核
// 記一筆後，計薪那天會跳過「早退扣款」，底薪照實際打卡時數算 → 直接算對，班表不動。
export default function EarlyLeaveForm() {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ employee: '', date: '', early_from: '', early_to: '', reason: '' })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const fetchData = async () => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const [empRes, recRes] = await Promise.all([
      supabase.from('employees')
        .select('id, name, dept, store, store_id')
        .eq('status', '在職').eq('organization_id', orgId).order('name'),
      supabase.from('early_leave_records')
        .select('*').eq('organization_id', orgId).order('date', { ascending: false }).limit(100),
    ])
    setEmployees(empRes.data || [])
    setRecords(recRes.data || [])
    setLoading(false)
  }
  useEffect(() => { fetchData() }, [profile?.organization_id]) // eslint-disable-line

  // 選了員工 + 日期 → 自動帶入「班表下班時間」當 early_to、「實際打卡下班」當 early_from
  useEffect(() => {
    const emp = employees.find(e => e.name === form.employee)
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
  }, [form.employee, form.date]) // eslint-disable-line

  const handleSave = async () => {
    if (!form.employee || !form.date) { toast.warning('請選員工與日期'); return }
    const emp = employees.find(e => e.name === form.employee)
    if (!emp) { toast.error('找不到員工'); return }
    setSaving(true)
    const payload = {
      employee_id: emp.id,
      date: form.date,
      store_id: emp.store_id || null,
      early_from: form.early_from || null,
      early_to: form.early_to || null,
      reason: form.reason || null,
      created_by: profile?.id || null,
      organization_id: profile?.organization_id,
    }
    const { error } = await supabase.from('early_leave_records').upsert(payload, { onConflict: 'employee_id,date' })
    setSaving(false)
    if (error) { toast.error('登記失敗：' + error.message); return }
    toast.success(`已登記 ${form.employee} ${form.date} 提早下班`)
    setForm({ employee: '', date: '', early_from: '', early_to: '', reason: '' })
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
      <div className="page-header">
        <h2><span className="header-icon">🕒</span> 提早下班登記</h2>
        <p>店方安排員工提早下班的登記（無需簽核）。登記後當天不計早退扣款，薪資照實際工時算。</p>
      </div>

      {/* 登記表單 */}
      <div className="card" style={{ padding: 20, marginBottom: 20, maxWidth: 720 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={lbl}>員工 *</label>
            <SearchableSelect value={form.employee} onChange={v => set('employee', v)}
              options={empOptions(employees)} placeholder="選擇員工" />
          </div>
          <div>
            <label style={lbl}>日期 *</label>
            <input type="date" className="form-input" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>提早離開時間</label>
            <input type="time" className="form-input" value={form.early_from} onChange={e => set('early_from', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>原班表下班時間</label>
            <input type="time" className="form-input" value={form.early_to} onChange={e => set('early_to', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>原因</label>
            <input className="form-input" value={form.reason} onChange={e => set('reason', e.target.value)}
              placeholder="例：生意清淡、人力過剩，店方安排提早下班" />
          </div>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          選員工 + 日期後，系統會自動帶入班表/打卡時間，可再調整。
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16, width: 'auto', padding: '10px 24px' }}
          disabled={saving} onClick={handleSave}>
          <Clock size={14} /> {saving ? '登記中…' : '登記提早下班'}
        </button>
      </div>

      {/* 已登記清單 */}
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>員工</th><th>日期</th><th>提早離開</th><th>原下班</th><th>原因</th><th></th></tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 28 }}>尚無登記紀錄</td></tr>
            )}
            {records.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{empName(r.employee_id)}</td>
                <td>{r.date}</td>
                <td style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>{r.early_from?.slice(0, 5) || '—'}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{r.early_to?.slice(0, 5) || '—'}</td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{r.reason || '—'}</td>
                <td>
                  <button className="btn btn-icon" title="刪除" onClick={() => handleDelete(r.id)}
                    style={{ color: 'var(--accent-red)' }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }
