import { useState, useEffect, useMemo, useRef } from 'react'
import { User, Calendar, DollarSign, Clock, FileText, Bell, ChevronRight, Upload, Trash2, PenTool } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'

export default function SelfService() {
  const { profile, isSuperAdmin, isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [employee, setEmployee] = useState(null)
  const [employees, setEmployees] = useState([])
  const [selectedEmpName, setSelectedEmpName] = useState('')
  const [tab, setTab] = useState('profile')
  const [attendance, setAttendance] = useState([])
  const [leaves, setLeaves] = useState([])
  const [salaryRecords, setSalaryRecords] = useState([])
  const [leaveEntitlements, setLeaveEntitlements] = useState([])
  const [sigUploading, setSigUploading] = useState(false)
  const [sigMsg, setSigMsg] = useState(null)  // { type:'ok'|'error', text }
  const sigFileRef = useRef(null)

  useEffect(() => {
    supabase.from('employees').select('*, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name')
      .then(({ data }) => {
        setEmployees(data || [])
        if (data?.length) {
          // Default to the logged-in user's record; fall back to first in list
          const self = profile?.name ? data.find(e => e.id === profile.id) : null
          const defaultEmp = self || data[0]
          setSelectedEmpName(defaultEmp.name)
          setEmployee(defaultEmp)
        }
      })
      .catch(() => setError('載入失敗'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  useEffect(() => {
    if (!selectedEmpName) return
    const emp = employees.find(e => e.name === selectedEmpName)
    setEmployee(emp || null)

    const thisMonth = new Date().toISOString().slice(0, 7)
    const thisYear = new Date().getFullYear()
    const last30 = new Date()
    last30.setDate(last30.getDate() - 30)

    Promise.all([
      supabase.from('attendance_records').select('*').eq('employee_id', emp?.id).gte('date', last30.toISOString().slice(0, 10)).order('date', { ascending: false }),
      supabase.from('leave_requests').select('*').eq('employee_id', emp?.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('salary_records').select('*').eq('employee_id', emp?.id).order('month', { ascending: false }).limit(12),
      supabase.from('leave_entitlements').select('*').eq('employee', emp?.name).eq('year', thisYear),
    ]).then(([a, l, s, le]) => {
      setAttendance(a.data || [])
      setLeaves(l.data || [])
      setSalaryRecords(s.data || [])
      setLeaveEntitlements(le.data || [])
    })
  }, [selectedEmpName, employees])

  const attendanceStats = useMemo(() => {
    const total = attendance.length
    const late = attendance.filter(a => a.status === '遲到' || a.late_flag).length
    const totalHours = attendance.reduce((s, a) => s + (a.hours || 0), 0)
    return { total, late, totalHours: Math.round(totalHours * 10) / 10 }
  }, [attendance])

  // 編輯權限：自己 or admin
  const canEditSignature = employee && (employee.id === profile?.id || isSuperAdmin || isAdmin)

  const handleSigUpload = async (file) => {
    if (!file || !employee?.id) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      setSigMsg({ type: 'error', text: '請上傳 PNG / JPG / WEBP / SVG 圖檔' })
      return
    }
    if (file.size > 1024 * 1024) {
      setSigMsg({ type: 'error', text: '檔案大小不可超過 1MB' })
      return
    }
    setSigUploading(true)
    setSigMsg(null)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `employee-signatures/${employee.id}/signature.${ext}`
      const { error: upErr } = await supabase.storage.from('attachments')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('attachments').getPublicUrl(path)
      const url = `${data.publicUrl}?v=${Date.now()}`  // cache-buster
      const { error: updErr } = await supabase.from('employees')
        .update({ signature_url: url }).eq('id', employee.id)
      if (updErr) throw updErr
      // 同步更新本地 state，下次切回不用重撈
      setEmployee(e => ({ ...e, signature_url: url }))
      setEmployees(list => list.map(e => e.id === employee.id ? { ...e, signature_url: url } : e))
      setSigMsg({ type: 'ok', text: '已儲存簽章。下次有人用你的名字核可文件，PDF 就會印出此簽章' })
    } catch (e) {
      setSigMsg({ type: 'error', text: '上傳失敗：' + (e.message || '未知錯誤') })
    } finally {
      setSigUploading(false)
      if (sigFileRef.current) sigFileRef.current.value = ''
    }
  }

  const handleSigRemove = async () => {
    if (!employee?.id) return
    if (!confirm('確定移除簽章？簽呈 PDF 會回到空白狀態。')) return
    setSigUploading(true)
    const { error } = await supabase.from('employees').update({ signature_url: null }).eq('id', employee.id)
    setSigUploading(false)
    if (error) {
      setSigMsg({ type: 'error', text: '移除失敗：' + error.message })
      return
    }
    setEmployee(e => ({ ...e, signature_url: null }))
    setEmployees(list => list.map(e => e.id === employee.id ? { ...e, signature_url: null } : e))
    setSigMsg({ type: 'ok', text: '已移除簽章' })
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👤</span> 員工自助服務</h2>
            <p>查看個人資料、出勤、薪資、請假紀錄</p>
          </div>
          {(isSuperAdmin || isAdmin) && (
            <div style={{ minWidth: 220 }}>
              <SearchableSelect
                value={selectedEmpName}
                onChange={(v) => setSelectedEmpName(v || '')}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="切換員工..."
                clearable={false}
              />
            </div>
          )}
        </div>
      </div>

      {employee && (
        <>
          {/* Profile card */}
          <div style={{
            display: 'flex', gap: 20, padding: 20, marginBottom: 20,
            background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'var(--accent-cyan)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#fff', fontWeight: 700,
            }}>
              {employee.name?.charAt(0)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{employee.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                {employee.dept} · {employee.position} · {employee.store || ''}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13 }}>
                <span>📧 {employee.email || '-'}</span>
                <span>📱 {employee.phone || '-'}</span>
                <span>📅 到職日 {employee.join_date || '-'}</span>
              </div>
            </div>
          </div>

          {/* Quick stat cards */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
              <div className="stat-card-label">本月出勤天數</div>
              <div className="stat-card-value">{attendanceStats.total}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': attendanceStats.late > 0 ? 'var(--accent-red)' : 'var(--accent-green)', '--card-accent-dim': attendanceStats.late > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)' }}>
              <div className="stat-card-label">遲到次數</div>
              <div className="stat-card-value">{attendanceStats.late}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'rgba(16,185,129,0.12)' }}>
              <div className="stat-card-label">累計工時</div>
              <div className="stat-card-value">{attendanceStats.totalHours}h</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'rgba(245,158,11,0.12)' }}>
              <div className="stat-card-label">薪資紀錄</div>
              <div className="stat-card-value">{salaryRecords.length} 月</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
            {[['profile', '👤 個人資料'], ['attendance', '🕐 出勤紀錄'], ['leave', '📅 請假紀錄'], ['salary', '💰 薪資明細']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                background: tab === key ? 'var(--accent-cyan)' : 'transparent',
                color: tab === key ? '#fff' : 'var(--text-muted)',
              }}>{label}</button>
            ))}
          </div>

          {/* Profile */}
          {tab === 'profile' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">👤</span> 個人資料</div>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px 24px' }}>
                  {[
                    ['姓名', employee.name],
                    ['英文名', employee.name_en || '-'],
                    ['部門', employee.dept || '-'],
                    ['職位', employee.position || '-'],
                    ['門市', employee.store || '-'],
                    ['狀態', employee.status],
                    ['信箱', employee.email || '-'],
                    ['電話', employee.phone || '-'],
                    ['到職日', employee.join_date || '-'],
                    ['主管', employee.supervisor || '-'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* 個人簽章 ── 簽呈 PDF 用 */}
                <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PenTool size={16} style={{ color: 'var(--accent-cyan)' }} /> 個人簽章
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    上傳後，當你核可任何簽呈（請假/出差/費用/離職/異動…）時，PDF 的對應簽核欄會自動印出此簽章
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{
                      width: 160, height: 80, borderRadius: 6,
                      border: '1.5px dashed var(--border-medium)',
                      background: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', flexShrink: 0,
                    }}>
                      {employee.signature_url ? (
                        <img src={employee.signature_url} alt="signature" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（尚未上傳）</span>
                      )}
                    </div>
                    {canEditSignature && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input ref={sigFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            onChange={(e) => handleSigUpload(e.target.files?.[0])} style={{ display: 'none' }} />
                          <button className="btn btn-secondary" style={{ fontSize: 12 }}
                            onClick={() => sigFileRef.current?.click()} disabled={sigUploading}>
                            <Upload size={12} /> {sigUploading ? '上傳中...' : (employee.signature_url ? '更換' : '上傳')}
                          </button>
                          {employee.signature_url && (
                            <button className="btn btn-secondary" style={{ fontSize: 12, color: 'var(--accent-red)' }}
                              onClick={handleSigRemove} disabled={sigUploading}>
                              <Trash2 size={12} /> 移除
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          建議透明背景 PNG，2:1 比例（如 200×100）<br />
                          PNG / JPG / WEBP / SVG，1MB 內
                        </div>
                      </div>
                    )}
                    {!canEditSignature && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        僅能編輯自己的簽章
                      </div>
                    )}
                  </div>
                  {sigMsg && (
                    <div style={{
                      marginTop: 10, padding: '6px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600,
                      background: sigMsg.type === 'ok' ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
                      color: sigMsg.type === 'ok' ? 'var(--accent-green)' : 'var(--accent-red)',
                    }}>{sigMsg.text}</div>
                  )}
                </div>

                {/* Leave Entitlements */}
                {leaveEntitlements.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>📅 假別額度（{new Date().getFullYear()}）</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                      {leaveEntitlements.map(le => {
                        const used = le.used_days || 0
                        const total = le.total_days || 0
                        const pct = total ? Math.round((used / total) * 100) : 0
                        return (
                          <div key={le.id} style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                              <span style={{ fontWeight: 600 }}>{le.leave_type}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{used}/{total} 天</span>
                            </div>
                            <div className="progress-track">
                              <div className="progress-fill" style={{
                                width: `${pct}%`,
                                background: pct >= 80 ? 'var(--accent-red)' : pct >= 50 ? 'var(--accent-orange)' : 'var(--accent-green)',
                              }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Attendance */}
          {tab === 'attendance' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">🕐</span> 近30天出勤紀錄</div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>日期</th><th>上班</th><th>下班</th><th>時數</th><th>狀態</th><th>打卡地點</th></tr>
                  </thead>
                  <tbody>
                    {attendance.map(a => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{a.date}</td>
                        <td>{a.clock_in || '-'}</td>
                        <td>{a.clock_out || '-'}</td>
                        <td>{a.hours ? `${a.hours}h` : '-'}</td>
                        <td>
                          <span className={`badge ${a.status === '遲到' || a.late_flag ? 'badge-danger' : 'badge-success'}`}>
                            {a.status || (a.late_flag ? '遲到' : '正常')}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.clock_in_location || '-'}</td>
                      </tr>
                    ))}
                    {!attendance.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無出勤紀錄</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Leave */}
          {tab === 'leave' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">📅</span> 請假紀錄</div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>假別</th><th>開始</th><th>結束</th><th>天數</th><th>原因</th><th>狀態</th><th>審核人</th></tr>
                  </thead>
                  <tbody>
                    {leaves.map(l => (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 600 }}>{l.type}</td>
                        <td>{l.start_date}</td>
                        <td>{l.end_date}</td>
                        <td>{l.days}</td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.reason || '-'}</td>
                        <td>
                          <span className={`badge ${l.status === '已核准' ? 'badge-success' : l.status === '已駁回' ? 'badge-danger' : 'badge-info'}`}>
                            {l.status}
                          </span>
                        </td>
                        <td>{l.approver || '-'}</td>
                      </tr>
                    ))}
                    {!leaves.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無請假紀錄</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Salary */}
          {tab === 'salary' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">💰</span> 薪資明細（最近12個月）</div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>月份</th><th>底薪</th><th>津貼</th><th>加班費</th><th>扣除</th><th>勞健保</th><th>實發</th></tr>
                  </thead>
                  <tbody>
                    {salaryRecords.map(s => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.month}</td>
                        <td>${(s.base_salary || 0).toLocaleString()}</td>
                        <td>${(s.allowance || 0).toLocaleString()}</td>
                        <td>${(s.overtime || 0).toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-red)' }}>-${(s.deductions || 0).toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-orange)' }}>-${(s.insurance || 0).toLocaleString()}</td>
                        <td style={{ fontWeight: 700, color: 'var(--accent-green)' }}>${(s.net_salary || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                    {!salaryRecords.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無薪資紀錄</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
