import { useState, useEffect } from 'react'
import { Plus, Check, X, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printClockCorrectionSignOff } from '../../lib/signOffAdapters'

export default function PunchCorrection() {
  const { profile, role } = useAuth()
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'

  const [corrections, setCorrections] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [tab, setTab] = useState('pending')
  const [form, setForm] = useState({ employee: isStaff ? (profile?.name || '') : '', date: '', correction_type: 'clock_out', corrected_time: '', reason: '' })
  const [organization, setOrganization] = useState(null)  // 印簽呈用

  const load = () => {
    const orgId = profile?.organization_id
    Promise.all([
      supabase.from('punch_corrections').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, name_en, position, dept, department_id, store, store_id, signature_url, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name'),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([c, e, orgRes]) => {
      let recs = c.data || []
      if (isStaff && profile?.name) recs = recs.filter(r => r.employee === profile.name)
      setCorrections(recs)
      // store_staff: 只顯示自己
      const emps = e.data || []
      setEmployees(isStaff ? emps.filter(emp => emp.name === profile?.name) : emps)
      setOrganization(orgRes?.data || null)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.employee || !form.date || !form.corrected_time || !form.reason) return
    // Lookup employee_id
    const emp = employees.find(e => e.name === form.employee)
    const insertData = {
      employee: form.employee,
      employee_id: emp?.id || null,
      date: form.date,
      correction_type: form.correction_type,
      corrected_time: form.corrected_time,
      reason: form.reason,
      status: '待審核',
      organization_id: profile?.organization_id || null,
    }
    const { data } = await supabase.from('punch_corrections').insert(insertData).select().single()
    if (data) {
      setCorrections(prev => [data, ...prev])
      setShowModal(false)
      setForm({ employee: '', date: '', correction_type: 'clock_out', corrected_time: '', reason: '' })
    }
  }

  const handleApprove = async (id) => {
    const correction = corrections.find(c => c.id === id)
    const { data } = await supabase.from('punch_corrections')
      .update({ status: '已核准', approved_by: '管理員', approved_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data) {
      setCorrections(prev => prev.map(c => c.id === id ? data : c))

      // Write correction back to attendance_records
      if (correction) {
        const matchField = correction.employee_id ? 'employee_id' : 'employee'
        const matchValue = correction.employee_id || correction.employee
        const { data: existing } = await supabase.from('attendance_records')
          .select('*')
          .eq(matchField, matchValue)
          .eq('date', correction.date).maybeSingle()

        if (existing) {
          const update = {}
          if (correction.correction_type === 'clock_in') {
            update.clock_in = correction.corrected_time
          } else {
            update.clock_out = correction.corrected_time
          }
          // Recalculate hours when both in/out exist
          const finalIn = update.clock_in || existing.clock_in
          const finalOut = update.clock_out || existing.clock_out
          if (finalIn && finalOut) {
            const [inH, inM] = finalIn.split(':').map(Number)
            const [outH, outM] = finalOut.split(':').map(Number)
            let diff = (outH * 60 + outM) - (inH * 60 + inM)
            if (diff < 0) diff += 24 * 60 // overnight shift
            update.hours = Math.round(diff / 60 * 10) / 10
          }
          update.status = existing.status === '未打卡' ? '補登' : existing.status
          await supabase.from('attendance_records').update(update).eq('id', existing.id)
        } else {
          // Create new record
          const newRecord = {
            employee: correction.employee,
            date: correction.date,
            status: '補登',
          }
          if (correction.correction_type === 'clock_in') {
            newRecord.clock_in = correction.corrected_time
          } else {
            newRecord.clock_out = correction.corrected_time
          }
          await supabase.from('attendance_records').insert(newRecord)
        }
      }
    }
  }

  const handleReject = async (id) => {
    const reason = prompt('駁回原因：')
    if (!reason) return
    const { data } = await supabase.from('punch_corrections')
      .update({ status: '已駁回', reject_reason: reason })
      .eq('id', id).select().single()
    if (data) setCorrections(prev => prev.map(c => c.id === id ? data : c))
  }

  if (loading) return <LoadingSpinner />

  const filtered = corrections.filter(c => {
    if (tab === 'pending') return c.status === '待審核'
    if (tab === 'approved') return c.status === '已核准'
    if (tab === 'rejected') return c.status === '已駁回'
    return true
  })

  const pendingCount = corrections.filter(c => c.status === '待審核').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 打卡補登申請</h2>
            <p>員工打卡異常補登審核</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增補登</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'pending', label: `待審核 (${pendingCount})` },
          { key: 'approved', label: '已核准' },
          { key: 'rejected', label: '已駁回' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            border: tab === t.key ? 'none' : '1px solid var(--border-medium)',
          }}>{t.label}</button>
        ))}
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>員工</th><th>日期</th><th>類型</th><th>補登時間</th><th>原因</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無資料</td></tr>}
              {filtered.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.employee}</td>
                  <td>{c.date}</td>
                  <td><span className="badge badge-cyan">{c.correction_type === 'clock_in' ? '上班' : '下班'}</span></td>
                  <td style={{ fontWeight: 600 }}>{c.corrected_time}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200 }}>{c.reason}</td>
                  <td>
                    <span className={`badge ${c.status === '已核准' ? 'badge-success' : c.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{c.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      {c.status === '待審核' ? (
                        <>
                          <button className="btn btn-sm btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handleApprove(c.id)}>
                            <Check size={12} /> 核准
                          </button>
                          <button className="btn btn-sm btn-secondary" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => handleReject(c.id)}>
                            <X size={12} /> 駁回
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {c.approved_by}
                          {c.reject_reason && <div style={{ color: 'var(--accent-red)' }}>原因：{c.reject_reason}</div>}
                        </span>
                      )}
                      <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} title="下載簽呈"
                        onClick={() => printClockCorrectionSignOff(c, {
                          companyName: organization?.name, logoUrl: organization?.logo_url,
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
        <Modal title="新增補登申請" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工 *">
              <SearchableSelect
                value={form.employee}
                onChange={(v) => set('employee', v || '')}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋員工姓名..."
              />
            </Field>
            <Field label="日期 *">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => set('date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="補登類型">
              <select className="form-input" style={{ width: '100%' }} value={form.correction_type} onChange={e => set('correction_type', e.target.value)}>
                <option value="clock_in">上班打卡</option>
                <option value="clock_out">下班打卡</option>
              </select>
            </Field>
            <Field label="補登時間 *">
              <input className="form-input" type="time" style={{ width: '100%' }} value={form.corrected_time} onChange={e => set('corrected_time', e.target.value)} />
            </Field>
          </div>
          <Field label="原因 *">
            <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }} placeholder="例：忘記打卡、系統異常..."
              value={form.reason} onChange={e => set('reason', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
