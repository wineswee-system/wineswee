import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { toast } from 'sonner'
import { CheckCircle, XCircle, ArrowRight, Trophy } from 'lucide-react'
import { getEventBus } from '../../lib/events/EventBus'

export default function QuizEngine() {
  const { courseId, lessonId } = useParams()
  const navigate = useNavigate()

  const [lesson, setLesson] = useState(null)
  const [enrollment, setEnrollment] = useState(null)
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('lms_lessons').select('*').eq('id', lessonId).single(),
      supabase.from('lms_enrollments').select('*').eq('course_id', courseId).maybeSingle(),
      supabase.from('lms_courses').select('id, title, passing_score').eq('id', courseId).single(),
    ]).then(([l, e, c]) => {
      setLesson(l.data)
      setEnrollment(e.data)
      setCourse(c.data)
    }).finally(() => setLoading(false))
  }, [courseId, lessonId])

  if (loading) return <LoadingSpinner />
  if (!lesson) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>找不到測驗</div>

  const questions = Array.isArray(lesson.quiz_data) ? lesson.quiz_data : []
  const passingScore = course?.passing_score || 80

  const handleSelect = (qIdx, optIdx) => {
    if (submitted) return
    setAnswers(prev => ({ ...prev, [qIdx]: optIdx }))
  }

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      toast.warning('請回答所有題目再提交')
      return
    }
    const correct = questions.filter((q, i) => answers[i] === q.answer_index).length
    const pct = questions.length ? Math.round((correct / questions.length) * 100) : 0
    setScore(pct)
    setSubmitted(true)

    if (!enrollment) return
    setSaving(true)
    try {
      await supabase.from('lms_progress').upsert({
        enrollment_id: enrollment.id, lesson_id: parseInt(lessonId),
        completed: true, score: pct, completed_at: new Date().toISOString(),
      }, { onConflict: 'enrollment_id,lesson_id' })

      await getEventBus().publish('lms.quiz.submitted', {
        enrollment_id: String(enrollment.id), lesson_id: String(lessonId),
        employee_id: String(enrollment.employee_id),
        score: pct, passed: pct >= passingScore,
      })
    } catch (err) {
      console.warn('[Quiz] Save failed:', err.message)
    } finally {
      setSaving(false)
    }
  }

  const passed = score >= passingScore

  if (submitted) {
    return (
      <div style={{ padding: 40, maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ marginBottom: 20 }}>
          {passed
            ? <Trophy size={52} style={{ color: 'var(--accent-green)' }} />
            : <XCircle size={52} style={{ color: 'var(--accent-red)' }} />}
        </div>
        <h2 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: 22 }}>
          {passed ? '測驗通過！' : '未達標準'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 28, fontSize: 15 }}>
          得分：<strong style={{ color: passed ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 20 }}>{score}</strong> 分
          　及格分數：{passingScore} 分
        </p>

        <div style={{ textAlign: 'left', marginBottom: 28 }}>
          {questions.map((q, i) => {
            const isRight = answers[i] === q.answer_index
            return (
              <div key={i} className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                  {isRight
                    ? <CheckCircle size={15} style={{ color: 'var(--accent-green)', flexShrink: 0, marginTop: 1 }} />
                    : <XCircle size={15} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 1 }} />}
                  <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{i + 1}. {q.question}</span>
                </div>
                <div style={{ paddingLeft: 25, fontSize: 13, color: 'var(--text-secondary)' }}>
                  {!isRight && (
                    <p style={{ margin: '0 0 2px', color: 'var(--accent-red)' }}>
                      您的答案：{q.options?.[answers[i]] ?? '—'}
                    </p>
                  )}
                  <p style={{ margin: '0 0 2px', color: 'var(--accent-green)' }}>
                    正確答案：{q.options?.[q.answer_index]}
                  </p>
                  {q.explanation && (
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>{q.explanation}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {!passed && (
            <button className="btn btn-secondary" onClick={() => { setSubmitted(false); setAnswers({}) }}>
              重新作答
            </button>
          )}
          <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => navigate(`/lms/course/${courseId}/lesson/${lessonId}`)}>
            返回課程 <ArrowRight size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 20, color: 'var(--text-primary)' }}>{lesson.title}</h2>
      <p style={{ margin: '0 0 28px', fontSize: 13, color: 'var(--text-muted)' }}>
        共 {questions.length} 題　及格分數：{passingScore} 分
      </p>

      {questions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          此測驗尚未設定題目
        </div>
      ) : (
        <>
          {questions.map((q, i) => (
            <div key={i} className="card" style={{ marginBottom: 16, padding: '18px 20px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 15, color: 'var(--text-primary)', fontWeight: 500 }}>
                {i + 1}. {q.question}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(q.options || []).map((opt, oi) => {
                  const selected = answers[i] === oi
                  return (
                    <button key={oi} onClick={() => handleSelect(i, oi)} style={{
                      textAlign: 'left', padding: '10px 14px', borderRadius: 8, fontSize: 14,
                      border: `1px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
                      background: selected ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                      color: selected ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                      {opt}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <button className="btn btn-primary" style={{ minWidth: 120 }}
              onClick={handleSubmit} disabled={saving}>
              {saving ? '提交中...' : '提交測驗'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
