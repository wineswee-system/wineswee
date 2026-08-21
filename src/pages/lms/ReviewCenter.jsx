import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { ClipboardCheck, CheckCircle, XCircle, ChevronDown, ChevronUp, User } from 'lucide-react'
import { getEventBus } from '../../lib/events/EventBus'
import { maybeCompleteCourse } from '../../lib/lms/completion'

const qType = (q) => q.type || 'single'
// 客觀題自動判分(與 QuizEngine 一致):複選須全對才給分
const isObjCorrect = (q, ans) => {
  if (qType(q) === 'multiple') {
    const c = [...(q.answer_indices || [])].sort((a, b) => a - b)
    const g = Array.isArray(ans) ? [...ans].sort((a, b) => a - b) : []
    return c.length > 0 && c.length === g.length && c.every((v, k) => v === g[k])
  }
  return ans === q.answer_index
}
const fmtAnswer = (q, ans) => {
  if (qType(q) === 'essay') return typeof ans === 'string' ? ans : '（未作答）'
  if (qType(q) === 'multiple') return ((Array.isArray(ans) ? ans : []).map(i => q.options?.[i]).filter(Boolean).join('、') || '（未作答）')
  return q.options?.[ans] ?? '（未作答）'
}

export default function ReviewCenter() {
  const { profile } = useAuth()
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [essayPts, setEssayPts] = useState({}) // { 題index: 給分 }
  const [grading, setGrading] = useState(false)

  const load = () => {
    if (!profile?.organization_id) { setLoading(false); return }
    setLoading(true)
    supabase.from('lms_quiz_submissions')
      .select('*, lms_lessons(title, type, quiz_data), lms_courses(title, passing_score), employees(name)')
      .eq('status', 'submitted').eq('needs_review', true)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) { toast.error(`載入待批閱失敗：${error.message}`); return }
        setSubs(data || [])
      }).finally(() => setLoading(false))
  }
  useEffect(load, [profile?.organization_id])

  const openSub = (sub) => {
    if (activeId === sub.id) { setActiveId(null); return }
    setActiveId(sub.id)
    const quiz = Array.isArray(sub.lms_lessons?.quiz_data) ? sub.lms_lessons.quiz_data : []
    const init = {}
    quiz.forEach((q, i) => { if (qType(q) === 'essay') init[i] = 0 })
    setEssayPts(init)
  }

  const submitGrade = async (sub) => {
    if (grading) return
    const quiz = Array.isArray(sub.lms_lessons?.quiz_data) ? sub.lms_lessons.quiz_data : []
    // 檢查每個申論題給分不超過配分
    for (let i = 0; i < quiz.length; i++) {
      if (qType(quiz[i]) === 'essay') {
        const max = quiz[i].points || 1
        const v = Number(essayPts[i]) || 0
        if (v < 0 || v > max) { toast.warning(`第 ${i + 1} 題給分需在 0～${max} 之間`); return }
      }
    }
    setGrading(true)
    try {
      const manual = Object.values(essayPts).reduce((s, v) => s + (Number(v) || 0), 0)
      const total = Number(sub.total_points) || quiz.reduce((s, q) => s + (q.points || 1), 0)
      const auto = Number(sub.auto_points) || 0
      const finalScore = total ? Math.round(((auto + manual) / total) * 100) : 0
      const passing = sub.lms_courses?.passing_score ?? 80
      const didPass = finalScore >= passing

      const { error: e1 } = await supabase.from('lms_quiz_submissions').update({
        grades: essayPts, score: finalScore, needs_review: false, status: 'graded',
        graded_by: profile?.name || String(profile?.id || ''), graded_at: new Date().toISOString(),
      }).eq('id', sub.id)
      if (e1) throw e1

      const { error: e2 } = await supabase.from('lms_progress').upsert({
        enrollment_id: sub.enrollment_id, lesson_id: sub.lesson_id,
        completed: didPass, score: finalScore, completed_at: didPass ? new Date().toISOString() : null,
      }, { onConflict: 'enrollment_id,lesson_id' })
      if (e2) throw e2

      await getEventBus().publish('lms.quiz.submitted', {
        enrollment_id: String(sub.enrollment_id), lesson_id: String(sub.lesson_id),
        employee_id: String(sub.employee_id), score: finalScore, passed: didPass,
      })

      // 通過且為最後未完成單元 → 整門完成、自動發證
      if (didPass) {
        await maybeCompleteCourse({
          enrollment: { id: sub.enrollment_id, employee_id: sub.employee_id, status: '進行中' },
          course: { id: sub.course_id, title: sub.lms_courses?.title },
        })
      }
      toast.success(`已批閱：${finalScore} 分（${didPass ? '通過' : '未通過'}）`)
      setSubs(prev => prev.filter(s => s.id !== sub.id))
      setActiveId(null)
    } catch (err) {
      toast.error(`批閱失敗：${err.message}`)
    } finally {
      setGrading(false)
    }
  }

  // 作業批閱:通過 / 退回(無分數,以通過與否決定完成)
  const reviewAssignment = async (sub, approved) => {
    if (grading) return
    setGrading(true)
    try {
      const { error: e1 } = await supabase.from('lms_quiz_submissions').update({
        status: 'graded', needs_review: false, score: null,
        graded_by: profile?.name || String(profile?.id || ''), graded_at: new Date().toISOString(),
      }).eq('id', sub.id)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('lms_progress').upsert({
        enrollment_id: sub.enrollment_id, lesson_id: sub.lesson_id,
        completed: approved, score: null, completed_at: approved ? new Date().toISOString() : null,
      }, { onConflict: 'enrollment_id,lesson_id' })
      if (e2) throw e2
      if (approved) {
        await maybeCompleteCourse({
          enrollment: { id: sub.enrollment_id, employee_id: sub.employee_id, status: '進行中' },
          course: { id: sub.course_id, title: sub.lms_courses?.title },
        })
      }
      toast.success(approved ? '已通過此作業' : '已退回，學員可重新上傳')
      setSubs(prev => prev.filter(s => s.id !== sub.id))
      setActiveId(null)
    } catch (err) {
      toast.error(`操作失敗：${err.message}`)
    } finally {
      setGrading(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClipboardCheck size={22} style={{ color: 'var(--accent-cyan)' }} /> 測驗批閱
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>{subs.length} 份待批閱（含申論題的測驗、上傳作業）</p>
      </div>

      {subs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>
          <ClipboardCheck size={44} style={{ marginBottom: 12, opacity: 0.3 }} />
          <p>目前沒有待批閱的測驗</p>
        </div>
      ) : subs.map(sub => {
        const quiz = Array.isArray(sub.lms_lessons?.quiz_data) ? sub.lms_lessons.quiz_data : []
        const answers = Array.isArray(sub.answers) ? sub.answers : []
        const isAssignment = sub.lms_lessons?.type === 'assignment'
        const file = isAssignment ? answers[0] : null
        const isOpen = activeId === sub.id
        const total = Number(sub.total_points) || quiz.reduce((s, q) => s + (q.points || 1), 0)
        const manual = Object.values(essayPts).reduce((s, v) => s + (Number(v) || 0), 0)
        const projected = total ? Math.round((((Number(sub.auto_points) || 0) + manual) / total) * 100) : 0
        return (
          <div key={sub.id} className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
            <div onClick={() => openSub(sub)} style={{ display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 18px', cursor: 'pointer' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-tertiary)', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                <User size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {sub.employees?.name || `員工 #${sub.employee_id}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {sub.lms_courses?.title || '—'}　/　{sub.lms_lessons?.title || '測驗'}
                  {sub.created_at && `　·　${new Date(sub.created_at).toLocaleDateString('zh-TW')}`}
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', flexShrink: 0 }}>待批閱</span>
              {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>

            {isOpen && isAssignment && (
              <div style={{ padding: '12px 18px 18px', borderTop: '1px solid var(--border-primary)' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>學員上傳的作業：</div>
                {file?.url ? (
                  <div style={{ marginBottom: 14 }}>
                    {/\.(mp4|mov|webm|m4v)$/i.test(file.name || '') ? (
                      <video src={file.url} controls style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8, background: '#000' }} />
                    ) : /\.(png|jpe?g|gif|webp)$/i.test(file.name || '') ? (
                      <img src={file.url} alt="作業" style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8 }} />
                    ) : null}
                    <div style={{ marginTop: 8 }}>
                      <a href={file.url} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: 13 }}>
                        開啟 / 下載：{file.name || '檔案'}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>（找不到上傳檔案）</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn btn-secondary" onClick={() => reviewAssignment(sub, false)} disabled={grading}
                    style={{ color: 'var(--accent-red)' }}>退回重做</button>
                  <button className="btn btn-primary" onClick={() => reviewAssignment(sub, true)} disabled={grading}>
                    {grading ? '處理中...' : '通過'}
                  </button>
                </div>
              </div>
            )}

            {isOpen && !isAssignment && (
              <div style={{ padding: '4px 18px 18px', borderTop: '1px solid var(--border-primary)' }}>
                {quiz.map((q, i) => {
                  const essay = qType(q) === 'essay'
                  const ans = answers[i]
                  const correct = !essay && isObjCorrect(q, ans)
                  return (
                    <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-primary)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        {!essay && (correct
                          ? <CheckCircle size={15} style={{ color: 'var(--accent-green)', flexShrink: 0, marginTop: 2 }} />
                          : <XCircle size={15} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 2 }} />)}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
                            {i + 1}. {q.question}
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                              （{essay ? '申論' : qType(q) === 'multiple' ? '複選' : qType(q) === 'truefalse' ? '是非' : '單選'}・{q.points || 1} 分）
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)',
                            background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px',
                            whiteSpace: essay ? 'pre-wrap' : 'normal' }}>
                            學員作答：{fmtAnswer(q, ans)}
                          </div>
                          {!essay && !correct && (
                            <div style={{ fontSize: 12, color: 'var(--accent-green)', marginTop: 4 }}>
                              正解：{qType(q) === 'multiple'
                                ? (q.answer_indices || []).map(oi => q.options?.[oi]).filter(Boolean).join('、')
                                : q.options?.[q.answer_index]}
                            </div>
                          )}
                          {essay && q.explanation && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>參考／評分重點：{q.explanation}</div>
                          )}
                          {essay && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>給分</span>
                              <input className="form-input" type="number" min={0} max={q.points || 1} style={{ width: 80, fontSize: 13 }}
                                value={essayPts[i] ?? 0}
                                onChange={e => setEssayPts(p => ({ ...p, [i]: e.target.value === '' ? 0 : parseInt(e.target.value) }))} />
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {q.points || 1} 分</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    預估總分：<strong style={{ color: 'var(--accent-cyan)', fontSize: 16 }}>{projected}</strong> 分
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>及格 {sub.lms_courses?.passing_score ?? 80} 分</span>
                  </span>
                  <button className="btn btn-primary" onClick={() => submitGrade(sub)} disabled={grading}>
                    {grading ? '送出中...' : '完成批閱'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
