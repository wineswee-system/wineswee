import { useState, useEffect } from 'react'
import { Plus, Search, Info } from 'lucide-react'
import { getLeaveRequests, createLeaveRequest, updateLeaveStatus } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { getSupervisor } from '../../lib/approval'
import { LEAVE_TYPES, getAnnualLeaveEntitlement, getLeaveTypeInfo, validateLeaveRequest } from '../../lib/leavePolicy'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Leave() {
  const [leaves, setLeaves] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showPolicyModal, setShowPolicyModal] = useState(false)
  const [form, setForm] = useState({ employee: '', type: 'annual', start_date: '', end_date: '', start_time: '09:00', end_time: '18:00', unit: 'day', hours: 0, days: 1, reason: '' })
  const [validationMsg, setValidationMsg] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      getLeaveRequests(),
      supabase.from('employees').select('id, name, department, position, join_date, phone').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([l, e, d]) => {
      const emps = e.data || []
      setLeaves(l.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      setForm(f => ({ ...f, employee: emps[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setValidationMsg('')
  }

  const selectedPolicy = getLeaveTypeInfo(form.type)

  const handleSubmit = async () => {
    try {
    if (!form.start_date || !form.employee) return

    // Calculate days/hours
    let days, hours
    if (form.unit === 'hour') {
      const [sh, sm] = form.start_time.split(':').map(Number)
      const [eh, em] = form.end_time.split(':').map(Number)
      hours = Math.max(0.5, (eh + em / 60) - (sh + sm / 60))
      days = Math.round(hours / 8 * 10) / 10
    } else {
      const start = new Date(form.start_date)
      const end = new Date(form.end_date || form.start_date)
      days = Math.max(1, Math.ceil((end - start) / 86400000) + 1)
      hours = days * 8
    }

    // Validate
    const usedThisYear = leaves
      .filter(l => l.employee === form.employee && (l.type === form.type || l.type === selectedPolicy?.shortName) && l.status !== '已拒絕')
      .reduce((s, l) => s + (l.days || 0), 0)

    const result = validateLeaveRequest({
      type: form.type,
      days,
      hours,
      usedDays: usedThisYear,
    })

    if (!result.valid) {
      setValidationMsg(result.error)
      return
    }

    const { data } = await createLeaveRequest({
      employee: form.employee,
      type: selectedPolicy?.shortName || form.type,
      start_date: form.start_date,
      end_date: form.end_date || form.start_date,
      start_time: form.unit === 'hour' ? form.start_time : null,
      end_time: form.unit === 'hour' ? form.end_time : null,
      days,
      hours,
      reason: form.reason,
      status: '待審核',
      approver: '-',
    })
    if (data) {
      setLeaves(prev => [data, ...prev])
      setShowModal(false)
      setForm({ employee: employees[0]?.name || '', type: 'annual', start_date: '', end_date: '', start_time: '09:00', end_time: '18:00', unit: 'day', hours: 0, days: 1, reason: '' })
      setValidationMsg('')

      // 動態簽核：找直屬主管，建立通知
      const supervisor = await getSupervisor(form.employee)
      if (supervisor) {
        await supabase.from('notifications').insert({
          type: '假單簽核',
          title: `${form.employee} 申請${selectedPolicy?.shortName || form.type}（${days}天），請審核`,
          user_id: supervisor.name,
        })
      }
    }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleApprove = async (id) => {
    const { data } = await updateLeaveStatus(id, '已核准', '主管')
    if (data) setLeaves(prev => prev.map(l => l.id === id ? data : l))
  }
  const handleReject = async (id) => {
    const { data } = await updateLeaveStatus(id, '已拒絕', '主管')
    if (data) setLeaves(prev => prev.map(l => l.id === id ? data : l))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.department || ''
  const filtered = leaves.filter(l =>
    (deptFilter === '' || getEmpDept(l.employee) === deptFilter) &&
    (search === '' || l.employee.includes(search))
  )

  const deptBtnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏖️</span> 請假管理</h2>
            <p>依據勞基法、性平法完整假別管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowPolicyModal(true)}><Info size={14} /> 法規說明</button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增假單</button>
          </div>
        </div>
      </div>

      {/* Department filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={deptBtnStyle(deptFilter === '')} onClick={() => setDeptFilter('')}>全部部門</button>
        {departments.map(d => (
          <button key={d.id} style={deptBtnStyle(deptFilter === d.name)} onClick={() => setDeptFilter(d.name)}>{d.name}</button>
        ))}
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待審核</div>
          <div className="stat-card-value">{filtered.filter(l => l.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{filtered.filter(l => l.status === '已核准').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">本月天數</div>
          <div className="stat-card-value">{filtered.reduce((s, l) => s + (l.days || 0), 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">假別數</div>
          <div className="stat-card-value">{LEAVE_TYPES.length}</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 假單列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋員工..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>員工</th><th>部門</th><th>假別</th><th>期間</th><th>天數/時數</th><th>事由</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無假單</td></tr>}
              {filtered.map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>{l.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(l.employee)}</td>
                  <td><span className="badge badge-info"><span className="badge-dot"></span>{l.type}</span></td>
                  <td style={{ fontSize: 12 }}>
                    {l.start_date}{l.start_time ? ` ${l.start_time}` : ''}
                    {l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''}
                    {l.end_time ? ` ${l.end_time}` : ''}
                  </td>
                  <td>{l.hours && l.hours < 8 ? `${l.hours}h` : `${l.days}天`}</td>
                  <td style={{ fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.reason}</td>
                  <td>
                    <span className={`badge ${l.status === '已核准' ? 'badge-success' : l.status === '已拒絕' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{l.status}
                    </span>
                  </td>
                  <td>
                    {l.status === '待審核' && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => handleApprove(l.id)}>核准</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleReject(l.id)}>拒絕</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Leave Modal */}
      {showModal && (
        <Modal title="新增假單" onClose={() => { setShowModal(false); setValidationMsg('') }} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <select className="form-input" style={{ width: '100%' }} value={form.employee} onChange={e => set('employee', e.target.value)}>
              <option value="">請選擇</option>
              {departments.map(d => (
                <optgroup key={d.id} label={d.name}>
                  {employees.filter(e => e.department === d.name).map(e => (
                    <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="假別 *">
            <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
              {LEAVE_TYPES.map(t => (
                <option key={t.code} value={t.code}>{t.shortName}（{t.law}）</option>
              ))}
            </select>
          </Field>
          {/* Policy info */}
          {selectedPolicy && (
            <div style={{
              padding: '10px 14px', borderRadius: 10, fontSize: 12, marginBottom: 12,
              background: 'var(--accent-cyan-dim)', border: '1px solid rgba(34,211,238,0.15)',
              color: 'var(--text-secondary)', lineHeight: 1.7,
            }}>
              <div><strong style={{ color: 'var(--accent-cyan)' }}>法源：</strong>{selectedPolicy.law}</div>
              <div><strong style={{ color: 'var(--accent-cyan)' }}>薪資：</strong>{selectedPolicy.salary}</div>
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>{selectedPolicy.description}</div>
            </div>
          )}
          {/* Unit toggle */}
          {selectedPolicy?.allowHourly && (
            <Field label="請假單位">
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ v: 'day', l: '整天' }, { v: 'hour', l: '時數' }].map(u => (
                  <button key={u.v} type="button" onClick={() => set('unit', u.v)} style={{
                    flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none',
                    background: form.unit === u.v ? 'var(--accent-cyan)' : 'var(--bg-card)',
                    color: form.unit === u.v ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer', outline: `1px solid ${form.unit === u.v ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                  }}>{u.l}</button>
                ))}
              </div>
            </Field>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: form.unit === 'hour' ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Field label={form.unit === 'hour' ? '日期 *' : '開始日期 *'}>
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            {form.unit === 'day' && (
              <Field label="結束日期">
                <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
              </Field>
            )}
          </div>
          {form.unit === 'hour' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="開始時間">
                <input className="form-input" type="time" style={{ width: '100%' }} value={form.start_time} onChange={e => set('start_time', e.target.value)} />
              </Field>
              <Field label="結束時間">
                <input className="form-input" type="time" style={{ width: '100%' }} value={form.end_time} onChange={e => set('end_time', e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="事由">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="請輸入請假事由" value={form.reason} onChange={e => set('reason', e.target.value)} />
          </Field>
          {validationMsg && (
            <div style={{ padding: '10px', borderRadius: 8, background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 13, fontWeight: 600 }}>
              {validationMsg}
            </div>
          )}
        </Modal>
      )}

      {/* Policy Reference Modal */}
      {showPolicyModal && (
        <Modal title="假別法規參照" onClose={() => setShowPolicyModal(false)} onSubmit={() => setShowPolicyModal(false)} submitLabel="關閉">
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {LEAVE_TYPES.map(t => (
              <div key={t.code} style={{
                padding: '14px 0', borderBottom: '1px solid var(--border-subtle)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t.name}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{t.law}</span>
                  {t.paid ? (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>有薪</span>
                  ) : (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>無薪</span>
                  )}
                  {t.gender && (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)' }}>{t.gender === 'female' ? '限女性' : '限男性'}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 4 }}>{t.description}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <strong>薪資：</strong>{t.salary}
                  {t.maxDays && <span> · <strong>上限：</strong>{t.maxDays} 天/年</span>}
                  {t.allowHourly && <span> · 可按小時請假</span>}
                </div>
                {t.conditions && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {t.conditions.map((c, i) => (
                      <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>
                        • {c.desc}：<strong>{c.days} 天</strong>{c.salary ? `（${c.salary}）` : ''}
                      </div>
                    ))}
                  </div>
                )}
                {t.settlement && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>⚠ {t.settlement}</div>}
                {t.note && <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>💡 {t.note}</div>}
                {t.note2026 && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4, padding: '6px 10px', borderRadius: 6, background: 'var(--accent-orange-dim)' }}>🆕 {t.note2026}</div>}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
