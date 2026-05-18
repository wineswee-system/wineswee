import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { BookOpen, Users, Award, TrendingUp, Edit, Plus } from 'lucide-react'

export default function LMSAdmin() {
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [certificates, setCertificates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('lms_courses').select('*').order('created_at', { ascending: false }),
      supabase.from('lms_enrollments').select('course_id, status, employee_id'),
      supabase.from('lms_certificates').select('course_id, employee_id, issued_at'),
    ]).then(([c, e, cert]) => {
      setCourses(c.data || [])
      setEnrollments(e.data || [])
      setCertificates(cert.data || [])
    }).finally(() => setLoading(false))
  }, [])

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

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, color: 'var(--text-primary)' }}>學習管理後台</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>課程與學員總覽</p>
        </div>
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => navigate('/lms/builder')}>
          <Plus size={15} /> 新增課程
        </button>
      </div>

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

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>課程一覽</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                {['課程名稱', '狀態', '難度', '報名', '完課', '完成率', '證書', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600,
                    color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courses.map(course => {
                const stats = courseStats[course.id] || { enrolled: 0, completed: 0, certs: 0 }
                const rate = stats.enrolled ? Math.round((stats.completed / stats.enrolled) * 100) : 0
                const statusColor = course.status === '發布' ? 'var(--accent-green)'
                  : course.status === '封存' ? 'var(--text-muted)' : 'var(--accent-orange)'
                const statusBg = course.status === '發布' ? 'var(--accent-green-dim)'
                  : course.status === '封存' ? 'var(--bg-tertiary)' : 'var(--accent-orange-dim)'
                return (
                  <tr key={course.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <td style={{ padding: '11px 14px', color: 'var(--text-primary)', fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {course.title}
                        {course.is_required && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-red)',
                            background: 'var(--accent-red-dim)', padding: '1px 6px', borderRadius: 3 }}>必修</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                        color: statusColor, background: statusBg }}>{course.status}</span>
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
                    <td style={{ padding: '11px 14px' }}>
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
    </div>
  )
}
