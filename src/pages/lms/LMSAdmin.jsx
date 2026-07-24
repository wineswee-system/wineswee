import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { confirm } from '../../lib/confirm'
import { BookOpen, Users, Award, TrendingUp, Edit, Plus, X, UserPlus, Trash2, Upload } from 'lucide-react'

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

  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    if (!profile?.organization_id) return
    Promise.all([
      supabase.from('lms_courses').select('*').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }),
      supabase.from('lms_enrollments').select('course_id, status, employee_id, id').eq('organization_id', profile.organization_id),
      supabase.from('lms_certificates').select('course_id, employee_id, issued_at').eq('organization_id', profile.organization_id),
      supabase.from('employees').select('id, name, email').eq('organization_id', profile.organization_id).eq('status', '在職').order('name'),
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
    setEnrollLoading(true)
    const { data } = await supabase
      .from('lms_enrollments')
      .select('*, employees(name, email)')
      .eq('course_id', course.id)
      .order('enrolled_at', { ascending: false })
    setCourseEnrollments(data || [])
    setEnrollLoading(false)
  }

  const handleStatusChange = async (courseId, newStatus) => {
    const { data, error } = await supabase
      .from('lms_courses').update({ status: newStatus }).eq('id', courseId).select().single()
    if (error) { toast.error('狀態更新失敗'); return }
    setCourses(prev => prev.map(c => c.id === courseId ? data : c))
    if (selectedCourse?.id === courseId) setSelectedCourse(data)
    toast.success(`已更新為「${newStatus}」`)
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
    } catch (err) {
      toast.error(err.message.includes('unique') ? '此學員已在報名名單中' : err.message)
    } finally {
      setEnrolling(false)
    }
  }

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
                  const empCerts = certificates.filter(c => c.employee_id === emp.id).length
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
                      <td style={{ padding: '10px 14px', color: empCerts > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                        {empCerts > 0 ? `${empCerts} 張` : '—'}
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
            {unenrolledEmployees.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>所有員工均已報名</div>
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
