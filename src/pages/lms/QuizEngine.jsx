import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { CheckCircle, XCircle, ArrowRight, Trophy } from 'lucide-react'
import { getEventBus } from '../../lib/events/EventBus'
import { maybeCompleteCourse } from '../../lib/lms/completion'

export default function QuizEngine() {
  const { courseId, lessonId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [lesson, setLesson] = useState(null)
  const [enrollment, setEnrollment] = useState(null)
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState(0)
  const [saving, setSaving] = useState(false)
  const [courseDone, setCourseDone] = useState(false)
  const [pendingReview, setPendingReview] = useState(false) // 含申論、已送出待批閱

  useEffect(() => {
    Promise.all([
      supabase.from('lms_lessons').select('*').eq('id', lessonId).single(),
      supabase.from('lms_enrollments').select('*').eq('course_id', courseId).eq('employee_id', profile?.id).maybeSingle(),
      supabase.from('lms_courses').select('id, title, passing_score').eq('id', courseId).single(),
    ]).then(async ([l, e, c]) => {
      setLesson(l.data)
      setEnrollment(e.data)
      setCourse(c.data)
      if (e.data) {
        const { data: sub } = await supabase.from('lms_quiz_submissions')
          .select('status').eq('enrollment_id', e.data.id).eq('lesson_id', lessonId).maybeSingle()
        if (sub?.status === 'submitted') setPendingReview(true)
      }
    }).finally(() => setLoading(false))
  }, [courseId, lessonId, profile?.id])

  if (loading) return <LoadingSpinner />
  if (!lesson) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>找不到測驗</div>

  const questions = Array.isArray(lesson.quiz_data) ? lesson.quiz_data : []
  const passingScore = course?.passing_score || 80

  const qType = (q) => q.type || 'single'
  const hasEssay = questions.some(q => qType(q) === 'essay')
  const isAnswered = (q, i) => {
    if (qType(q) === 'multiple') return Array.isArray(answers[i]) && answers[i].length > 0
    if (qType(q) === 'essay') return typeof answers[i] === 'string' && answers[i].trim().length > 0
    return answers[i] !== undefined
  }
  const setEssay = (i, text) => { if (submitted) return; setAnswers(prev => ({ ...prev, [i]: text })) }
  // 客觀題自動判分:複選須全對才給分
  const isCorrect = (q, ans) => {
    if (qType(q) === 'multiple') {
      const correct = [...(q.answer_indices || [])].sort((a, b) => a - b)
      const given = Array.isArray(ans) ? [...ans].sort((a, b) => a - b) : []
      return correct.length > 0 && correct.length === given.length && correct.every((v, k) => v === given[k])
    }
    return ans === q.answer_index
  }

  const handleSelect = (qIdx, optIdx) => {
    if (submitted) return
    const q = questions[qIdx]
    if (qType(q) === 'multiple') {
      setAnswers(prev => {
        const set = new Set(Array.isArray(prev[qIdx]) ? prev[qIdx] : [])
        set.has(optIdx) ? set.delete(optIdx) : set.add(optIdx)
        return { ...prev, [qIdx]: [...set].sort((a, b) => a - b) }
      })
    } else {
      setAnswers(prev => ({ ...prev, [qIdx]: optIdx }))
    }
  }

  const handleSubmit = async () => {
    if (!questions.every(isAnswered)) {
      toast.warning('請回答所有題目再提交')
      return
    }
    const totalPoints = questions.reduce((s, q) => s + (q.points || 1), 0)
    // 客觀題自動得分(申論不計入自動分,由後台批閱)
    const autoPoints = questions.reduce((s, q, i) =>
      s + (qType(q) !== 'essay' && isCorrect(q, answers[i]) ? (q.points || 1) : 0), 0)

    if (!enrollment) {
      // 未報名的預覽:只顯示客觀分數,不寫入
      setScore(totalPoints ? Math.round((autoPoints / totalPoints) * 100) : 0)
      setSubmitted(true)
      return
    }

    setSaving(true)
    try {
      if (hasEssay) {
        // 含申論 → 存作答等後台批閱,先不算最終分數、不標記完成
        const answerArr = questions.map((q, i) => answers[i] ?? null)
        const { error } = await supabase.from('lms_quiz_submissions').upsert({
          enrollment_id: enrollment.id, lesson_id: parseInt(lessonId),
          course_id: parseInt(courseId), employee_id: enrollment.employee_id,
          answers: answerArr, auto_points: autoPoints, total_points: totalPoints,
          needs_review: true, status: 'submitted', score: null,
          grades: {}, graded_by: null, graded_at: null,
          organization_id: enrollment.organization_id ?? profile?.organization_id,
        }, { onConflict: 'enrollment_id,lesson_id' })
        if (error) throw error
        setPendingReview(true)
        toast.success('已提交,等待批閱')
        return
      }

      // 純客觀 → 系統自動改分
      const pct = totalPoints ? Math.round((autoPoints / totalPoints) * 100) : 0
      const didPass = pct >= passingScore
      setScore(pct)
      setSubmitted(true)
      const { error } = await supabase.from('lms_progress').upsert({
        enrollment_id: enrollment.id, lesson_id: parseInt(lessonId),
        completed: didPass, score: pct, completed_at: didPass ? new Date().toISOString() : null,
      }, { onConflict: 'enrollment_id,lesson_id' })
      if (error) throw error

      await getEventBus().publish('lms.quiz.submitted', {
        enrollment_id: String(enrollment.id), lesson_id: String(lessonId),
        employee_id: String(enrollment.employee_id),
        score: pct, passed: didPass,
      })

      // 通過後,若這是最後一個未完成的單元,整門課即完成(觸發自動發證)
      if (didPass) {
        const done = await maybeCompleteCourse({ enrollment, course })
        if (done) setCourseDone(true)
      }
    } catch (err) {
      toast.error(`提交失敗:${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const passed = score >= passingScore

  if (pendingReview) {
    return (
      <div style={{ padding: 40, maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📝</div>
        <h2 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: 22 }}>已提交，等待批閱</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 28, fontSize: 15, lineHeight: 1.7 }}>
          本測驗含申論題，需由管理者人工批閱。<br />批閱完成後會計算成績，通過即完成此單元。
        </p>
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 auto' }}
          onClick={() => navigate(`/lms/course/${courseId}/lesson/${lessonId}`)}>
          返回課程 <ArrowRight size={14} />
        </button>
      </div>
    )
  }

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
            const isRight = isCorrect(q, answers[i])
            const yourAns = qType(q) === 'multiple'
              ? ((Array.isArray(answers[i]) ? answers[i] : []).map(oi => q.options?.[oi]).filter(Boolean).join('、') || '—')
              : (q.options?.[answers[i]] ?? '—')
            const rightAns = qType(q) === 'multiple'
              ? (q.answer_indices || []).map(oi => q.options?.[oi]).filter(Boolean).join('、')
              : q.options?.[q.answer_index]
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
                    <p style={{ margin: '0 0 2px', color: 'var(--accent-red)' }}>您的答案：{yourAns}</p>
                  )}
                  <p style={{ margin: '0 0 2px', color: 'var(--accent-green)' }}>正確答案：{rightAns}</p>
                  {q.explanation && (
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>{q.explanation}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {courseDone && (
          <div className="card" style={{ padding: '14px 16px', marginBottom: 20,
            background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontSize: 14 }}>
            🎉 已完成整門課程,結業證書將自動發放
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {!passed && (
            <button className="btn btn-secondary" onClick={() => { setSubmitted(false); setAnswers({}); setScore(0) }}>
              重新作答
            </button>
          )}
          {courseDone ? (
            <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => navigate('/lms/progress')}>
              查看我的進度 <ArrowRight size={14} />
            </button>
          ) : (
            <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => navigate(`/lms/course/${courseId}/lesson/${lessonId}`)}>
              返回課程 <ArrowRight size={14} />
            </button>
          )}
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
          {questions.map((q, i) => {
            const multi = qType(q) === 'multiple'
            const essay = qType(q) === 'essay'
            return (
            <div key={i} className="card" style={{ marginBottom: 16, padding: '18px 20px' }}>
              <p style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--text-primary)', fontWeight: 500 }}>
                {i + 1}. {q.question}
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                {essay ? '申論題・人工批閱' : multi ? '複選題・可選多個' : qType(q) === 'truefalse' ? '是非題' : '單選題'}
                {(q.points || 1) !== 1 ? `　${q.points} 分` : ''}
              </p>
              {essay ? (
                <textarea className="form-input" rows={5} placeholder="請輸入你的作答…"
                  value={typeof answers[i] === 'string' ? answers[i] : ''}
                  onChange={e => setEssay(i, e.target.value)} />
              ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(q.options || []).map((opt, oi) => {
                  const selected = multi ? (Array.isArray(answers[i]) && answers[i].includes(oi)) : answers[i] === oi
                  return (
                    <button key={oi} onClick={() => handleSelect(i, oi)} style={{
                      textAlign: 'left', padding: '10px 14px', borderRadius: 8, fontSize: 14,
                      display: 'flex', alignItems: 'center', gap: 10,
                      border: `1px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
                      background: selected ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                      color: selected ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                      <span style={{ width: 16, height: 16, flexShrink: 0, borderRadius: multi ? 4 : '50%',
                        border: `2px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
                        background: selected ? 'var(--accent-cyan)' : 'transparent' }} />
                      {opt}
                    </button>
                  )
                })}
              </div>
              )}
            </div>
            )
          })}
          {hasEssay && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              ※ 本測驗含申論題,提交後需管理者批閱才會計算成績。
            </p>
          )}
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
