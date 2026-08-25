import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { confirm } from '../../lib/confirm'
import { getEventBus } from '../../lib/events/EventBus'
import { completePhysicalAttendance } from '../../lib/lms/completion'
import { BookOpen, Users, Award, TrendingUp, Edit, Plus, X, UserPlus, UsersRound, Trash2, Upload, Calendar, MapPin, ChevronDown, ChevronUp } from 'lucide-react'

const STATUS_OPTIONS = ['草稿', '發布', '封存']
const STATUS_COLOR = {
  '發布': { color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
  '封存': { color: 'var(--text-muted)',   bg: 'var(--bg-tertiary)' },
  '草稿': { color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
}

export default function LMSAdmin() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [courses, setCourses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [certificates, setCertificates] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  const [selectedCourse, setSelectedCourse] = useState(null)
  const [courseEnrollments, setCourseEnrollments] = useState([])
  const [enrollLoading, setEnrollLoading] = useState(false)
  const [enrollTarget, setEnrollTarget] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [bulkAssigning, setBulkAssigning] = useState(false)

  // 多選指派 modal
  const [showAssign, setShowAssign] = useState(false)
  const [assignSearch, setAssignSearch] = useState('')
  const [assignStore, setAssignStore] = useState('')
  const [assignSelected, setAssignSelected] = useState(() => new Set())

  // 實體課場次 + 簽到
  const [sessions, setSessions] = useState([])
  const [attendance, setAttendance] = useState({}) // session_id → Set(employee_id)
  const [activeSession, setActiveSession] = useState(null)
  const [sessionForm, setSessionForm] = useState({ title: '', starts_at: '', location: '' })
  const [attnBusy, setAttnBusy] = useState(false)

  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    if (!profile?.organization_id) return
    Promise.all([
      supabase.from('lms_courses').select('*').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }),
      supabase.from('lms_enrollments').select('course_id, status, employee_id, id').eq('organization_id', profile.organization_id),
      supabase.from('lms_certificates').select('course_id, employee_id, issued_at, tier').eq('organization_id', profile.organization_id),
      supabase.from('employees').select('id, name, email, store, position, job_category').eq('organization_id', profile.organization_id).eq('status', '在職').order('name'),
    ]).then(([c, e, cert, emp]) => {
      setCourses(c.data || [])
      setEnrollments(e.data || [])
      setCertificates(cert.data || [])
      setEmployees(emp.data || [])
    }).finally(() => setLoading(false))
  }, [profile?.organization_id])

  const handleSelectCourse = async (course) => {
    if (selectedCourse?.id === course.id) { setSelectedCourse(null); return }
    setSelectedCourse(course)
    setEnrollTarget('')
    setActiveSession(null)
    setSessions([])
    setAttendance({})
    setEnrollLoading(true)
    const { data } = await supabase
      .from('lms_enrollments')
      .select('*, employees(name, email)')
      .eq('course_id', course.id)
      .order('enrolled_at', { ascending: false })
    setCourseEnrollments(data || [])
    setEnrollLoading(false)
    if (course.delivery_mode === '實體') loadSessions(course.id)
  }

  const loadSessions = async (courseId) => {
    const { data: sess } = await supabase.from('lms_sessions').select('*').eq('course_id', courseId).order('starts_at', { ascending: true })
    setSessions(sess || [])
    const { data: attn } = await supabase.from('lms_attendance').select('session_id, employee_id').eq('course_id', courseId)
    const map = {}
    ;(attn || []).forEach(a => { (map[a.session_id] = map[a.session_id] || new Set()).add(a.employee_id) })
    setAttendance(map)
  }

  const addSession = async () => {
    if (!sessionForm.title.trim() || !selectedCourse) { toast.warning('請輸入場次名稱'); return }
    const { data, error } = await supabase.from('lms_sessions').insert({
      course_id: selectedCourse.id, title: sessionForm.title.trim(),
      starts_at: sessionForm.starts_at || null, location: sessionForm.location || null,
      organization_id: profile.organization_id,
    }).select().single()
    if (error) { toast.error(`新增場次失敗：${error.message}`); return }
    setSessions(prev => [...prev, data])
    setSessionForm({ title: '', starts_at: '', location: '' })
  }

  // 簽到切換:未簽到→簽到(並嘗試完課發證);已簽到→取消
  const toggleAttendance = async (session, enr) => {
    if (attnBusy) return
    const present = attendance[session.id]?.has(enr.employee_id)
    setAttnBusy(true)
    try {
      if (present) {
        const { error } = await supabase.from('lms_attendance').delete()
          .eq('session_id', session.id).eq('employee_id', enr.employee_id)
        if (error) throw error
        setAttendance(prev => { const s = new Set(prev[session.id]); s.delete(enr.employee_id); return { ...prev, [session.id]: s } })
      } else {
        const { error } = await supabase.from('lms_attendance').insert({
          session_id: session.id, course_id: selectedCourse.id, enrollment_id: enr.id,
          employee_id: enr.employee_id, checked_in_by: 'admin', organization_id: profile.organization_id,
        })
        if (error) throw error
        setAttendance(prev => { const s = new Set(prev[session.id] || []); s.add(enr.employee_id); return { ...prev, [session.id]: s } })
        // 簽到即完課(純實體課直接完成、有線上單元則需都完成)
        const done = await completePhysicalAttendance({
          enrollment: { id: enr.id, employee_id: enr.employee_id, status: enr.status },
          course: { id: selectedCourse.id, title: selectedCourse.title },
        })
        if (done) {
          setCourseEnrollments(prev => prev.map(e => e.id === enr.id ? { ...e, status: '已完成' } : e))
          toast.success(`${enr.employees?.name || '學員'} 已簽到並完成課程`)
        } else {
          toast.success(`${enr.employees?.name || '學員'} 已簽到`)
        }
      }
    } catch (err) {
      toast.error(`簽到操作失敗：${err.message}`)
    } finally {
      setAttnBusy(false)
    }
  }

  const handleStatusChange = async (courseId, newStatus) => {
    const prevStatus = courses.find(c => c.id === courseId)?.status
    const { data, error } = await supabase
      .from('lms_courses').update({ status: newStatus }).eq('id', courseId).select().single()
    if (error) { toast.error('狀態更新失敗'); return }
    setCourses(prev => prev.map(c => c.id === courseId ? data : c))
    if (selectedCourse?.id === courseId) setSelectedCourse(data)
    toast.success(`已更新為「${newStatus}」`)
    // 轉為發布的當下才發事件(草稿/封存→發布);已是發布不重發
    if (newStatus === '發布' && prevStatus !== '發布') {
      await getEventBus().publish('lms.course.published', {
        course_id: String(courseId), title: data.title, category: data.category || '',
      })
    }
  }

  const handleEnrollEmployee = async () => {
    if (!enrollTarget || !selectedCourse || enrolling) return
    setEnrolling(true)
    try {
      const { data, error } = await supabase
        .from('lms_enrollments')
        .insert({
          course_id: selectedCourse.id,
          employee_id: parseInt(enrollTarget),
          enrolled_by: 'admin',
          organization_id: profile.organization_id,
          status: '進行中',
        })
        .select('*, employees(name, email)')
        .single()
      if (error) throw error
      setCourseEnrollments(prev => [data, ...prev])
      setEnrollments(prev => [...prev, { id: data.id, course_id: selectedCourse.id, status: '進行中', employee_id: data.employee_id }])
      setEnrollTarget('')
      toast.success('已手動加入報名')
      await getEventBus().publish('lms.enrollment.created', {
        enrollment_id: String(data.id), course_id: String(selectedCourse.id),
        course_title: selectedCourse.title, employee_id: String(data.employee_id),
        employee_name: data.employees?.name || '', enrolled_by: 'admin',
      })
    } catch (err) {
      toast.error(err.message.includes('unique') ? '此學員已在報名名單中' : err.message)
    } finally {
      setEnrolling(false)
    }
  }

  // 批次把本課指派給指定的一組員工(全體/多選共用)
  const assignEmployees = async (targets) => {
    if (!selectedCourse || bulkAssigning) return 0
    if (!targets.length) { toast.info('沒有可指派的對象'); return 0 }
    setBulkAssigning(true)
    try {
      const rows = targets.map(emp => ({
        course_id: selectedCourse.id, employee_id: emp.id,
        enrolled_by: 'admin', organization_id: profile.organization_id, status: '進行中',
      }))
      const { data, error } = await supabase
        .from('lms_enrollments').insert(rows).select('*, employees(name, email)')
      if (error) throw error
      const added = data || []
      setCourseEnrollments(prev => [...added, ...prev])
      setEnrollments(prev => [...prev, ...added.map(d => ({ id: d.id, course_id: selectedCourse.id, status: '進行中', employee_id: d.employee_id }))])
      for (const d of added) {
        await getEventBus().publish('lms.enrollment.created', {
          enrollment_id: String(d.id), course_id: String(selectedCourse.id),
          course_title: selectedCourse.title, employee_id: String(d.employee_id),
          employee_name: d.employees?.name || '', enrolled_by: 'admin',
        })
      }
      toast.success(`已指派 ${added.length} 位員工`)
      return added.length
    } catch (err) {
      toast.error(`批次指派失敗：${err.message}`)
      return 0
    } finally {
      setBulkAssigning(false)
    }
  }

  // 一鍵指派全體尚未報名的在職員工
  const handleBulkEnroll = async () => {
    const targets = unenrolledEmployees
    if (!targets.length) { toast.info('所有在職員工都已在名單中'); return }
    const ok = await confirm(`將「${selectedCourse.title}」指派給 ${targets.length} 位尚未報名的在職員工？`)
    if (!ok) return
    await assignEmployees(targets)
  }

  // 多選指派:送出勾選的人
  const handleAssignSelected = async () => {
    const targets = unenrolledEmployees.filter(e => assignSelected.has(e.id))
    if (!targets.length) { toast.warning('請至少勾選一位'); return }
    const n = await assignEmployees(targets)
    if (n > 0) { setShowAssign(false); setAssignSelected(new Set()); setAssignSearch(''); setAssignStore('') }
  }

  const toggleAssign = (id) => setAssignSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleRemoveEnroll = async (enr) => {
    const ok = await confirm(`確定移除 ${enr.employees?.name || '此學員'} 的報名？`)
    if (!ok) return
    const { error } = await supabase.from('lms_enrollments').delete().eq('id', enr.id)
    if (error) { toast.error('移除失敗'); return }
    setCourseEnrollments(prev => prev.filter(e => e.id !== enr.id))
    setEnrollments(prev => prev.filter(e => e.id !== enr.id))
  }

  if (loading) return <LoadingSpinner />

  const totalEnrolled = enrollments.length
  const totalCompleted = enrollments.filter(e => e.status === '已完成').length
  const completionRate = totalEnrolled ? Math.round((totalCompleted / totalEnrolled) * 100) : 0

  const courseStats = {}
  enrollments.forEach(e => {
    if (!courseStats[e.course_id]) courseStats[e.course_id] = { enrolled: 0, completed: 0, certs: 0 }
    courseStats[e.course_id].enrolled++
    if (e.status === '已完成') courseStats[e.course_id].completed++
  })
  certificates.forEach(c => {
    if (courseStats[c.course_id]) courseStats[c.course_id].certs++
  })

  const enrolledIds = new Set(courseEnrollments.map(e => e.employee_id))
  const unenrolledEmployees = employees.filter(e => !enrolledIds.has(e.id))

  return (
    <div style={{ padding: 24, paddingRight: selectedCourse ? 420 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, color: 'var(--text-primary)' }}>學習管理後台</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>課程與學員總覽</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setShowImport(true)}>
            <Upload size={14} /> 匯入舊訓練課程
          </button>
          <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => navigate('/lms/builder')}>
            <Plus size={15} /> 新增課程
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        {[
          { label: '課程總數', value: courses.length, icon: BookOpen, color: 'var(--accent-cyan)' },
          { label: '報名總數', value: totalEnrolled, icon: Users, color: 'var(--accent-blue)' },
          { label: '完課人數', value: totalCompleted, icon: TrendingUp, color: 'var(--accent-green)' },
          { label: '整體完成率', value: `${completionRate}%`, icon: Award, color: 'var(--accent-purple)' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: color + '22',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={18} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Course table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>課程一覽</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                {['課程名稱', '狀態', '難度', '報名', '完課', '完成率', '證書', '操作'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600,
                    color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courses.map(course => {
                const stats = courseStats[course.id] || { enrolled: 0, completed: 0, certs: 0 }
                const rate = stats.enrolled ? Math.round((stats.completed / stats.enrolled) * 100) : 0
                const sc = STATUS_COLOR[course.status] || STATUS_COLOR['草稿']
                const isSelected = selectedCourse?.id === course.id
                return (
                  <tr key={course.id}
                    style={{ borderBottom: '1px solid var(--border-primary)', cursor: 'pointer',
                      background: isSelected ? 'var(--accent-cyan-dim)' : 'transparent' }}
                    onClick={() => handleSelectCourse(course)}>
                    <td style={{ padding: '11px 14px', color: 'var(--text-primary)', fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {course.title}
                        {course.is_required && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-red)',
                            background: 'var(--accent-red-dim)', padding: '1px 6px', borderRadius: 3 }}>必修</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '11px 14px' }} onClick={e => e.stopPropagation()}>
                      <select
                        value={course.status}
                        onChange={e => handleStatusChange(course.id, e.target.value)}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                          color: sc.color, background: sc.bg, border: `1px solid ${sc.color}44`,
                        }}>
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '11px 14px', color: 'var(--text-secondary)' }}>{course.difficulty}</td>
                    <td style={{ padding: '11px 14px', color: 'var(--text-secondary)' }}>{stats.enrolled}</td>
                    <td style={{ padding: '11px 14px', color: 'var(--text-secondary)' }}>{stats.completed}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 5, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                          <div style={{ height: '100%', borderRadius: 3, width: `${rate}%`,
                            background: rate >= 80 ? 'var(--accent-green)' : rate >= 50 ? 'var(--accent-orange)' : 'var(--accent-cyan)' }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rate}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 14px', color: 'var(--text-secondary)' }}>{stats.certs}</td>
                    <td style={{ padding: '11px 14px' }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => navigate(`/lms/builder/${course.id}`)}>
                        <Edit size={12} /> 編輯
                      </button>
                    </td>
                  </tr>
                )
              })}
              {courses.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    尚未建立任何課程
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 必修合規追蹤 */}
      {(() => {
        const required = courses.filter(c => c.is_required && c.status === '發布')
        if (!required.length) return null
        const totalEmp = employees.length
        return (
          <div className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Award size={16} style={{ color: 'var(--accent-orange)' }} />
              <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>必修課合規追蹤</h3>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{required.length} 門必修</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    {['課程名稱', '應修人數', '已完成', '進行中', '未開始', '合規率'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {required.map(course => {
                    const enrs = enrollments.filter(e => e.course_id === course.id)
                    const completed = enrs.filter(e => e.status === '已完成').length
                    const inProgress = enrs.filter(e => e.status === '進行中').length
                    const notStarted = totalEmp - enrs.length
                    const rate = totalEmp ? Math.round((completed / totalEmp) * 100) : 0
                    return (
                      <tr key={course.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                        <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>{course.title}</td>
                        <td style={{ padding: '11px 14px', color: 'var(--text-secondary)' }}>{totalEmp}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{completed}</span>
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ color: 'var(--accent-cyan)' }}>{inProgress}</span>
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ color: notStarted > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>{notStarted}</span>
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 80, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                              <div style={{ height: '100%', borderRadius: 3, width: `${rate}%`,
                                background: rate >= 80 ? 'var(--accent-green)' : rate >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)' }} />
                            </div>
                            <span style={{ fontWeight: 600, color: rate >= 80 ? 'var(--accent-green)' : rate >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
                              {rate}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* 團隊學習狀況（依角色顯示） */}
      {['super_admin','admin','manager'].includes(profile?.role) && employees.length > 0 && (
        <div className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={16} style={{ color: 'var(--accent-blue)' }} />
            <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>團隊學習狀況</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  {['員工', '已報名', '完課', '完成率', '取得證書'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => {
                  const empEnrs = enrollments.filter(e => e.employee_id === emp.id)
                  const empDone = empEnrs.filter(e => e.status === '已完成').length
                  const empCertList = certificates.filter(c => c.employee_id === emp.id)
                  const empCerts = empCertList.length
                  const cG = empCertList.filter(c => c.tier === '金').length
                  const cS = empCertList.filter(c => c.tier === '銀').length
                  const cB = empCertList.filter(c => c.tier === '銅').length
                  const empRate = empEnrs.length ? Math.round((empDone / empEnrs.length) * 100) : 0
                  return (
                    <tr key={emp.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--text-primary)' }}>{emp.name}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{empEnrs.length}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--accent-green)', fontWeight: 600 }}>{empDone}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {empEnrs.length > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 60, height: 5, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                              <div style={{ height: '100%', borderRadius: 3, width: `${empRate}%`, background: 'var(--accent-cyan)' }} />
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{empRate}%</span>
                          </div>
                        ) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未報名</span>}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {empCerts > 0 ? (
                          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            🥇{cG} 🥈{cS} 🥉{cB}
                            <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>共 {empCerts}</span>
                          </span>
                        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Enrollment side panel */}
      {selectedCourse && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
          background: 'var(--bg-card)', borderLeft: '1px solid var(--border-primary)',
          zIndex: 200, display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedCourse.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {courseEnrollments.length} 位學員
              </div>
            </div>
            <button className="btn btn-ghost" onClick={() => setSelectedCourse(null)} style={{ padding: 4, flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>

          {/* 實體課:場次與簽到 */}
          {selectedCourse.delivery_mode === '實體' && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-secondary)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>場次與現場簽到</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                <input className="form-input" style={{ fontSize: 13 }} placeholder="場次名稱（如：第一梯次）"
                  value={sessionForm.title} onChange={e => setSessionForm(f => ({ ...f, title: e.target.value }))} />
                <input className="form-input" style={{ fontSize: 13 }} type="datetime-local"
                  value={sessionForm.starts_at} onChange={e => setSessionForm(f => ({ ...f, starts_at: e.target.value }))} />
                <input className="form-input" style={{ fontSize: 13 }} placeholder="地點"
                  value={sessionForm.location} onChange={e => setSessionForm(f => ({ ...f, location: e.target.value }))} />
                <button className="btn btn-secondary" style={{ fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                  onClick={addSession}><Plus size={13} /> 新增場次</button>
              </div>
              {sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無場次</div>
              ) : sessions.map(s => {
                const open = activeSession === s.id
                const cnt = attendance[s.id]?.size || 0
                return (
                  <div key={s.id} className="card" style={{ padding: 0, marginBottom: 8, overflow: 'hidden' }}>
                    <div onClick={() => setActiveSession(open ? null : s.id)} style={{ padding: '10px 12px', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{s.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>已簽到 {cnt}/{courseEnrollments.length}</span>
                        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {s.starts_at && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Calendar size={11} />{new Date(s.starts_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                        {s.location && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={11} />{s.location}</span>}
                      </div>
                    </div>
                    {open && (
                      <div style={{ borderTop: '1px solid var(--border-primary)', padding: '6px 0' }}>
                        {courseEnrollments.length === 0 ? (
                          <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>尚無學員報名，先在下方加入</div>
                        ) : courseEnrollments.map(enr => {
                          const present = attendance[s.id]?.has(enr.employee_id)
                          return (
                            <label key={enr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!!present} disabled={attnBusy} onChange={() => toggleAttendance(s, enr)} />
                              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{enr.employees?.name || `員工 #${enr.employee_id}`}</span>
                              {present && <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>已簽到</span>}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Add enrollment */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-primary)',
            background: 'var(--bg-secondary)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>手動加入學員</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="form-input" style={{ flex: 1, fontSize: 13 }}
                value={enrollTarget} onChange={e => setEnrollTarget(e.target.value)}>
                <option value="">選擇員工...</option>
                {unenrolledEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
              <button className="btn btn-primary" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                onClick={handleEnrollEmployee} disabled={!enrollTarget || enrolling}>
                <UserPlus size={13} />{enrolling ? '加入中...' : '加入'}
              </button>
            </div>
            {unenrolledEmployees.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1, fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => { setAssignSelected(new Set()); setAssignSearch(''); setAssignStore(''); setShowAssign(true) }}
                  disabled={bulkAssigning}>
                  <UserPlus size={13} /> 指定特定的人
                </button>
                <button className="btn btn-secondary" style={{ flex: 1, fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={handleBulkEnroll} disabled={bulkAssigning}>
                  <UsersRound size={13} />
                  {bulkAssigning ? '指派中...' : `全體（${unenrolledEmployees.length}）`}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>所有在職員工均已報名</div>
            )}
          </div>

          {/* Enrollment list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {enrollLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>載入中...</div>
            ) : courseEnrollments.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                <Users size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <p>尚無學員報名</p>
              </div>
            ) : courseEnrollments.map(enr => {
              const statusColor = enr.status === '已完成' ? 'var(--accent-green)'
                : enr.status === '進行中' ? 'var(--accent-cyan)' : 'var(--text-muted)'
              return (
                <div key={enr.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 20px', borderBottom: '1px solid var(--border-primary)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-tertiary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {(enr.employees?.name || '?')[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {enr.employees?.name || `員工 #${enr.employee_id}`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {enr.enrolled_by === 'self' ? '自主報名' : enr.enrolled_by === 'admin' ? '管理員指派' : enr.enrolled_by || '—'}
                      {enr.enrolled_at && ` · ${new Date(enr.enrolled_at).toLocaleDateString('zh-TW')}`}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                    color: statusColor, background: statusColor + '22', flexShrink: 0 }}>
                    {enr.status}
                  </span>
                  <button className="btn btn-ghost" style={{ padding: 4, color: 'var(--accent-red)', flexShrink: 0 }}
                    onClick={() => handleRemoveEnroll(enr)} title="移除報名">
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Footer: go to course builder */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-primary)' }}>
            <button className="btn btn-secondary" style={{ width: '100%', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              onClick={() => navigate(`/lms/builder/${selectedCourse.id}`)}>
              <Edit size={13} /> 編輯課程內容
            </button>
          </div>
        </div>
      )}

      {showAssign && selectedCourse && (() => {
        const stores = [...new Set(unenrolledEmployees.map(e => e.store).filter(Boolean))].sort()
        const list = unenrolledEmployees.filter(e =>
          (!assignSearch || (e.name || '').includes(assignSearch)) &&
          (!assignStore || e.store === assignStore)
        )
        const allChecked = list.length > 0 && list.every(e => assignSelected.has(e.id))
        const toggleAll = () => setAssignSelected(prev => {
          const next = new Set(prev)
          if (allChecked) list.forEach(e => next.delete(e.id))
          else list.forEach(e => next.add(e.id))
          return next
        })
        return createPortal((
          <div onClick={() => setShowAssign(false)} style={{ position: 'fixed', inset: 0, zIndex: 3000,
            background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div className="card" onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '100%',
              maxHeight: '82vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
              {/* Header */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>指定學員指派</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedCourse.title}</div>
                </div>
                <button className="btn btn-ghost" onClick={() => setShowAssign(false)} style={{ padding: 4, flexShrink: 0 }}>
                  <X size={18} />
                </button>
              </div>
              {/* Filters */}
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', gap: 8 }}>
                <input className="form-input" style={{ flex: 1, fontSize: 13 }} placeholder="搜尋姓名..."
                  value={assignSearch} onChange={e => setAssignSearch(e.target.value)} />
                {stores.length > 0 && (
                  <select className="form-input" style={{ width: 130, fontSize: 13 }}
                    value={assignStore} onChange={e => setAssignStore(e.target.value)}>
                    <option value="">所有門市</option>
                    {stores.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
              {/* Select all */}
              <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-secondary)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  全選目前 {list.length} 位
                </label>
                <span style={{ fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 600 }}>已選 {assignSelected.size} 位</span>
              </div>
              {/* List */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {list.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>查無符合的員工</div>
                ) : list.map(e => {
                  const checked = assignSelected.has(e.id)
                  return (
                    <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
                      borderBottom: '1px solid var(--border-primary)', cursor: 'pointer',
                      background: checked ? 'var(--accent-cyan-dim)' : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAssign(e.id)} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{e.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {[e.store, e.position || e.job_category].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
              {/* Footer */}
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-primary)', display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAssign(false)}>取消</button>
                <button className="btn btn-primary" style={{ flex: 2 }}
                  onClick={handleAssignSelected} disabled={bulkAssigning || assignSelected.size === 0}>
                  {bulkAssigning ? '指派中...' : `指派選取的 ${assignSelected.size} 位`}
                </button>
              </div>
            </div>
          </div>
        ), document.body)
      })()}

      {showImport && (
        <TrainingImportModal
          orgId={profile?.organization_id}
          existingTitles={new Set(courses.map(c => c.title))}
          onClose={() => setShowImport(false)}
          onImported={(newCourses) => {
            setCourses(prev => [...newCourses, ...prev])
            setShowImport(false)
          }}
        />
      )}
    </div>
  )
}

// ── 匯入舊訓練課程 Modal ───────────────────────────────────────────
function TrainingImportModal({ orgId, existingTitles, onClose, onImported }) {
  const [oldCourses, setOldCourses] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    supabase.from('training_courses')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setOldCourses(data || [])
        const newOnes = new Set((data || []).filter(c => !existingTitles.has(c.title)).map(c => c.id))
        setSelected(newOnes)
      })
      .finally(() => setLoading(false))
  }, [orgId])

  const mapStatus = (s) => s === '開課中' ? '發布' : s === '已結束' ? '封存' : '草稿'

  const handleImport = async () => {
    if (!selected.size) return
    setImporting(true)
    const toImport = oldCourses.filter(c => selected.has(c.id)).map(c => ({
      title: c.title,
      description: c.description || null,
      category: c.category || '一般',
      estimated_hours: Number(c.duration_hours) || 1,
      difficulty: '初級',
      passing_score: 80,
      is_required: false,
      status: mapStatus(c.status),
      organization_id: orgId,
    }))

    const { data, error } = await supabase.from('lms_courses').insert(toImport).select()
    setImporting(false)
    if (error) { toast.error(`匯入失敗：${error.message}`); return }
    setResult(data)
    toast.success(`已匯入 ${data.length} 門課程`)
    onImported(data)
  }

  const toggle = (id) => setSelected(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 'min(580px, calc(100vw - 32px))', maxHeight: 'min(85vh, calc(100vh - 32px))', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>匯入舊訓練課程</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              從舊系統 training_courses 匯入至 LMS，勾選要匯入的課程
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 4 }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 22px' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>載入中...</div>
          ) : oldCourses.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              <BookOpen size={36} style={{ marginBottom: 8, opacity: 0.3 }} />
              <p>舊系統無訓練課程資料</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                <span>共 {oldCourses.length} 筆，已選 {selected.size} 筆</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '2px 8px' }}
                    onClick={() => setSelected(new Set(oldCourses.map(c => c.id)))}>全選</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '2px 8px' }}
                    onClick={() => setSelected(new Set())}>全取消</button>
                </div>
              </div>
              {oldCourses.map(c => {
                const alreadyExists = existingTitles.has(c.title)
                return (
                  <div key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    borderRadius: 8, marginBottom: 6,
                    background: alreadyExists ? 'var(--bg-tertiary)' : selected.has(c.id) ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                    opacity: alreadyExists ? 0.55 : 1,
                  }}>
                    <input type="checkbox" checked={selected.has(c.id)} disabled={alreadyExists}
                      onChange={() => toggle(c.id)}
                      style={{ accentColor: 'var(--accent-cyan)', cursor: alreadyExists ? 'not-allowed' : 'pointer' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.title}
                        {alreadyExists && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>（已存在）</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {c.category} · {c.duration_hours}h · {mapStatus(c.status)}
                        {c.instructor && ` · 講師：${c.instructor}`}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                      color: mapStatus(c.status) === '發布' ? 'var(--accent-green)' : 'var(--text-muted)',
                      background: mapStatus(c.status) === '發布' ? 'var(--accent-green-dim)' : 'var(--bg-tertiary)' }}>
                      {mapStatus(c.status)}
                    </span>
                  </div>
                )
              })}
            </>
          )}
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border-primary)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            匯入後需至 CourseBuilder 補充章節與單元內容
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={handleImport}
              disabled={!selected.size || importing || loading}>
              {importing ? '匯入中...' : `匯入 ${selected.size} 門課程`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
