import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { BookOpen, Award, Clock, TrendingUp, ChevronRight } from 'lucide-react'

export default function ProgressDashboard() {
  const navigate = useNavigate()
  const [enrollments, setEnrollments] = useState([])
  const [courseMap, setCourseMap] = useState({})
  const [progressMap, setProgressMap] = useState({})
  const [lessonCountMap, setLessonCountMap] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('lms_enrollments').select('*').order('enrolled_at', { ascending: false })
      .then(async ({ data: enrs }) => {
        if (!enrs?.length) { setLoading(false); return }
        setEnrollments(enrs)

        const courseIds = [...new Set(enrs.map(e => e.course_id))]
        const enrollmentIds = enrs.map(e => e.id)

        const [cRes, pRes, lRes] = await Promise.all([
          supabase.from('lms_courses').select('id, title, difficulty, estimated_hours').in('id', courseIds),
          supabase.from('lms_progress').select('enrollment_id, lesson_id, completed').in('enrollment_id', enrollmentIds),
          supabase.from('lms_lessons').select('id, course_id').in('course_id', courseIds),
        ])

        const cm = {}
        ;(cRes.data || []).forEach(c => { cm[c.id] = c })
        setCourseMap(cm)

        const pm = {}
        ;(pRes.data || []).forEach(p => {
          if (!pm[p.enrollment_id]) pm[p.enrollment_id] = { total: 0, done: 0 }
          pm[p.enrollment_id].total++
          if (p.completed) pm[p.enrollment_id].done++
        })
        setProgressMap(pm)

        const lm = {}
        ;(lRes.data || []).forEach(l => { lm[l.course_id] = (lm[l.course_id] || 0) + 1 })
        setLessonCountMap(lm)
      }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />

  const completed = enrollments.filter(e => e.status === '已完成')
  const inProgress = enrollments.filter(e => e.status === '進行中')

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: '0 0 6px', fontSize: 22, color: 'var(--text-primary)' }}>學習進度</h1>
      <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 13 }}>追蹤您的課程學習狀況</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        {[
          { label: '已報名', value: enrollments.length, icon: BookOpen, color: 'var(--accent-cyan)' },
          { label: '進行中', value: inProgress.length, icon: TrendingUp, color: 'var(--accent-orange)' },
          { label: '已完成', value: completed.length, icon: Award, color: 'var(--accent-green)' },
          {
            label: '完成率',
            value: enrollments.length ? `${Math.round((completed.length / enrollments.length) * 100)}%` : '—',
            icon: Clock, color: 'var(--accent-purple)',
          },
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

      {inProgress.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--text-primary)' }}>進行中</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {inProgress.map(enr => (
              <EnrollmentRow key={enr.id} enrollment={enr} course={courseMap[enr.course_id]}
                progress={progressMap[enr.id]} lessonCount={lessonCountMap[enr.course_id] || 0}
                onClick={() => navigate(`/lms/course/${enr.course_id}`)} />
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--text-primary)' }}>已完成</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {completed.map(enr => (
              <EnrollmentRow key={enr.id} enrollment={enr} course={courseMap[enr.course_id]}
                progress={progressMap[enr.id]} lessonCount={lessonCountMap[enr.course_id] || 0}
                onClick={() => navigate(`/lms/course/${enr.course_id}`)} />
            ))}
          </div>
        </section>
      )}

      {enrollments.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>
          <BookOpen size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p>您尚未報名任何課程</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/lms/courses')}>
            瀏覽課程
          </button>
        </div>
      )}
    </div>
  )
}

function EnrollmentRow({ enrollment, course, progress, lessonCount, onClick }) {
  if (!course) return null
  const done = progress?.done || 0
  const total = lessonCount || progress?.total || 1
  const pct = total ? Math.round((done / total) * 100) : 0
  const isCompleted = enrollment.status === '已完成'

  return (
    <div className="card" onClick={onClick}
      style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{course.title}</span>
          {isCompleted && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-green)',
              background: 'var(--accent-green-dim)', padding: '1px 7px', borderRadius: 4, flexShrink: 0 }}>已完成</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 5, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
            <div style={{ height: '100%', borderRadius: 3, width: `${isCompleted ? 100 : pct}%`,
              background: isCompleted ? 'var(--accent-green)' : 'var(--accent-cyan)', transition: 'width 0.3s' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{isCompleted ? 100 : pct}%</span>
        </div>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
        <Clock size={12} />{course.estimated_hours}h
      </span>
      <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
    </div>
  )
}
