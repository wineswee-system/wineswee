import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { BookOpen, Video, HelpCircle, Clock, Award, CheckCircle, Play, ChevronRight } from 'lucide-react'
import { getEventBus } from '../../lib/events/EventBus'

const DIFF_COLOR = { '初級': 'var(--accent-green)', '中級': 'var(--accent-orange)', '進階': 'var(--accent-red)' }

export default function CourseDetail() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [course, setCourse] = useState(null)
  const [sections, setSections] = useState([])
  const [enrollment, setEnrollment] = useState(null)
  const [progress, setProgress] = useState({})
  const [allLessons, setAllLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)

  useEffect(() => {
    // 防呆:courseId 非數字(如網址誤帶 /lms/course/courses)不查 int 欄,導回課程列表
    if (!/^\d+$/.test(String(courseId))) { navigate('/lms/courses', { replace: true }); return }
    Promise.all([
      supabase.from('lms_courses').select('*').eq('id', courseId).single(),
      supabase.from('lms_sections').select('*, lms_lessons(*)').eq('course_id', courseId).order('sort_order'),
      supabase.from('lms_enrollments').select('*').eq('course_id', courseId).eq('employee_id', profile?.id).maybeSingle(),
    ]).then(([c, s, e]) => {
      setCourse(c.data)
      setEnrollment(e.data)
      const secs = (s.data || []).map(sec => ({
        ...sec, lessons: (sec.lms_lessons || []).sort((a, b) => a.sort_order - b.sort_order),
      }))
      setSections(secs)
      const flat = secs.flatMap(sec => sec.lessons)
      setAllLessons(flat)
      if (e.data) {
        supabase.from('lms_progress').select('lesson_id, completed').eq('enrollment_id', e.data.id)
          .then(({ data }) => {
            const map = {}
            ;(data || []).forEach(p => { map[p.lesson_id] = p.completed })
            setProgress(map)
          })
      }
    }).finally(() => setLoading(false))
  }, [courseId])

  const handleEnroll = async () => {
    if (enrolling) return
    setEnrolling(true)
    try {
      const { data: enr, error } = await supabase.from('lms_enrollments').insert({
        course_id: parseInt(courseId),
        employee_id: profile.id,
        enrolled_by: 'self',
        organization_id: profile.organization_id,
        status: '進行中',
      }).select().single()
      if (error) throw error
      setEnrollment(enr)
      toast.success('已成功報名課程')
      await getEventBus().publish('lms.enrollment.created', {
        enrollment_id: String(enr.id),
        course_id: String(courseId),
        course_title: course.title,
        employee_id: String(profile.id),
        employee_name: profile.name || '',
        enrolled_by: 'self',
      })
    } catch (err) {
      toast.error(`報名失敗：${err.message}`)
    } finally {
      setEnrolling(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (!course) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>找不到課程</div>

  const diffColor = DIFF_COLOR[course.difficulty] || 'var(--accent-blue)'
  const completedCount = allLessons.filter(l => progress[l.id]).length
  const progressPct = allLessons.length ? Math.round((completedCount / allLessons.length) * 100) : 0
  const isCompleted = enrollment?.status === '已完成'
  const firstLesson = allLessons[0]
  const nextLesson = allLessons.find(l => !progress[l.id]) || firstLesson

  return (
    <div style={{ padding: 28, maxWidth: 800, margin: '0 auto' }}>
      {/* Course header */}
      <div className="card" style={{ padding: '24px 28px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 4,
            background: diffColor + '22', color: diffColor }}>{course.difficulty}</span>
          {course.category && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{course.category}</span>}
          {course.is_required && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-red)' }}>必修</span>}
          {isCompleted && (
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--accent-green)',
              background: 'var(--accent-green-dim)', padding: '2px 10px', borderRadius: 4 }}>已完成</span>
          )}
        </div>

        <h1 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--text-primary)' }}>{course.title}</h1>
        {course.description && (
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {course.description}
          </p>
        )}

        <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={13} />{course.estimated_hours} 小時
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <BookOpen size={13} />{allLessons.length} 個單元
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Award size={13} />及格 {course.passing_score || 80} 分
          </span>
        </div>

        {enrollment ? (
          <div>
            {!isCompleted && allLessons.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12,
                  color: 'var(--text-muted)', marginBottom: 5 }}>
                  <span>學習進度</span>
                  <span>{completedCount} / {allLessons.length} 單元</span>
                </div>
                <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                  <div style={{ height: '100%', borderRadius: 3, width: `${progressPct}%`,
                    background: 'var(--accent-cyan)', transition: 'width 0.3s' }} />
                </div>
              </div>
            )}
            <button className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              disabled={!nextLesson}
              onClick={() => nextLesson && navigate(`/lms/course/${courseId}/lesson/${nextLesson.id}`)}>
              <Play size={14} />
              {isCompleted ? '重新觀看' : completedCount > 0 ? '繼續學習' : '開始學習'}
            </button>
          </div>
        ) : (
          <button className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleEnroll} disabled={enrolling}>
            <BookOpen size={14} />
            {enrolling ? '報名中...' : '立即報名'}
          </button>
        )}
      </div>

      {/* Lesson list */}
      <h3 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--text-primary)', fontWeight: 600 }}>
        課程內容
      </h3>
      {sections.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          此課程尚未建立任何單元
        </div>
      ) : sections.map(sec => (
        <div key={sec.id} className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-primary)',
            fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {sec.title}
          </div>
          {sec.lessons.map((l, idx) => {
            const done = progress[l.id]
            const canPlay = !!enrollment
            const Icon = l.type === 'video' ? Video : l.type === 'quiz' ? HelpCircle : BookOpen
            return (
              <div key={l.id}
                onClick={() => canPlay && navigate(`/lms/course/${courseId}/lesson/${l.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                  cursor: canPlay ? 'pointer' : 'default',
                  borderBottom: idx < sec.lessons.length - 1 ? '1px solid var(--border-primary)' : 'none',
                }}
                onMouseEnter={e => canPlay && (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <Icon size={14} style={{ color: done ? 'var(--accent-green)' : 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, color: done ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  {l.title}
                </span>
                {l.duration_minutes > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.duration_minutes} 分</span>
                )}
                {done
                  ? <CheckCircle size={14} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                  : canPlay ? <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : null}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
