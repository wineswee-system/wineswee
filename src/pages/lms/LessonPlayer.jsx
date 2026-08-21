import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, CheckCircle, BookOpen, Video, HelpCircle, Clock, Upload } from 'lucide-react'
import { getEventBus } from '../../lib/events/EventBus'
import { maybeCompleteCourse } from '../../lib/lms/completion'

export default function LessonPlayer() {
  const { courseId, lessonId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [course, setCourse] = useState(null)
  const [sections, setSections] = useState([])
  const [allLessons, setAllLessons] = useState([])
  const [lesson, setLesson] = useState(null)
  const [enrollment, setEnrollment] = useState(null)
  const [progress, setProgress] = useState({})
  const [submissions, setSubmissions] = useState({}) // lesson_id → { status, score }
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const startTimeRef = useRef(Date.now())

  useEffect(() => {
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
      setLesson(flat.find(l => String(l.id) === String(lessonId)) || flat[0])
      if (e.data) {
        supabase.from('lms_progress').select('*').eq('enrollment_id', e.data.id)
          .then(({ data }) => {
            const map = {}
            ;(data || []).forEach(p => { map[p.lesson_id] = p })
            setProgress(map)
          })
        supabase.from('lms_quiz_submissions').select('lesson_id, status, score').eq('enrollment_id', e.data.id)
          .then(({ data }) => {
            const map = {}
            ;(data || []).forEach(s => { map[s.lesson_id] = s })
            setSubmissions(map)
          })
      }
    }).finally(() => setLoading(false))
  }, [courseId, lessonId, profile?.id])

  useEffect(() => { startTimeRef.current = Date.now() }, [lessonId])

  if (loading) return <LoadingSpinner />
  if (!course || !lesson) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>找不到課程內容</div>

  const currentIdx = allLessons.findIndex(l => l.id === lesson.id)
  const prevLesson = allLessons[currentIdx - 1]
  const nextLesson = allLessons[currentIdx + 1]
  const isCompleted = progress[lesson.id]?.completed

  const goToLesson = (l) => { navigate(`/lms/course/${courseId}/lesson/${l.id}`); setLesson(l) }

  const handleUpload = async (file) => {
    if (!file || !enrollment || uploading) return
    if (file.size > 50 * 1024 * 1024) { toast.error('檔案過大（上限約 50MB）'); return }
    setUploading(true)
    try {
      const org = enrollment.organization_id ?? profile?.organization_id
      const safe = file.name.replace(/[^\w.\-]+/g, '_')
      const path = `${org}/${enrollment.id}/${lesson.id}/${Date.now()}_${safe}`
      const { error: upErr } = await supabase.storage.from('lms-uploads').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('lms-uploads').getPublicUrl(path)
      const { error } = await supabase.from('lms_quiz_submissions').upsert({
        enrollment_id: enrollment.id, lesson_id: lesson.id,
        course_id: parseInt(courseId), employee_id: enrollment.employee_id,
        answers: [{ type: 'file', url: pub.publicUrl, name: file.name, path }],
        auto_points: 0, total_points: 0, needs_review: true, status: 'submitted',
        grades: {}, score: null, graded_by: null, graded_at: null,
        organization_id: org,
      }, { onConflict: 'enrollment_id,lesson_id' })
      if (error) throw error
      setSubmissions(prev => ({ ...prev, [lesson.id]: { status: 'submitted', score: null } }))
      toast.success('作業已上傳，等待批閱')
    } catch (err) {
      toast.error(`上傳失敗：${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  const markComplete = async () => {
    if (!enrollment || marking) return
    // 測驗/作業單元不能用「標記完成」略過(測驗要作答通過、作業要上傳並通過批閱)
    if (lesson.type === 'quiz' || lesson.type === 'assignment') {
      toast.info(lesson.type === 'quiz' ? '此單元為測驗,請作答並達及格分才算完成' : '此單元為作業,請上傳檔案並通過批閱才算完成')
      return
    }
    setMarking(true)
    const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000)
    try {
      const { error } = await supabase.from('lms_progress').upsert({
        enrollment_id: enrollment.id, lesson_id: lesson.id,
        completed: true, time_spent_seconds: timeSpent,
        completed_at: new Date().toISOString(),
      }, { onConflict: 'enrollment_id,lesson_id' })
      if (error) throw error

      setProgress({ ...progress, [lesson.id]: { ...progress[lesson.id], completed: true } })

      await getEventBus().publish('lms.lesson.completed', {
        enrollment_id: String(enrollment.id), lesson_id: String(lesson.id),
        lesson_title: lesson.title, course_id: String(courseId),
        employee_id: String(enrollment.employee_id), time_spent_seconds: timeSpent,
      })

      // 以 DB 為準判定整門是否完成(含 quiz 是否通過),避免前端 state 漏算
      const done = await maybeCompleteCourse({ enrollment, course })
      if (done) {
        toast.success('恭喜完成課程！')
        navigate('/lms/progress')
        return
      }
      toast.success('單元完成！')
      if (nextLesson) goToLesson(nextLesson)
    } catch (err) {
      toast.error(`標記失敗：${err.message}`)
    } finally {
      setMarking(false)
    }
  }

  const completedCount = allLessons.filter(l => progress[l.id]?.completed).length
  const progressPct = allLessons.length ? Math.round((completedCount / allLessons.length) * 100) : 0

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)' }}>
      {/* Sidebar */}
      <div style={{ width: 272, flexShrink: 0, borderRight: '1px solid var(--border-primary)', overflowY: 'auto' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3 }}>{course.title}</h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{completedCount}/{allLessons.length} 完成</div>
          <div style={{ height: 4, background: 'var(--bg-tertiary)', borderRadius: 2 }}>
            <div style={{ height: '100%', borderRadius: 2, width: `${progressPct}%`, background: 'var(--accent-cyan)', transition: 'width 0.3s' }} />
          </div>
        </div>
        {sections.map(sec => (
          <div key={sec.id}>
            <div style={{ padding: '7px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg-tertiary)' }}>
              {sec.title}
            </div>
            {sec.lessons.map(l => {
              const done = progress[l.id]?.completed
              const active = l.id === lesson.id
              const Icon = l.type === 'video' ? Video : l.type === 'quiz' ? HelpCircle : BookOpen
              return (
                <div key={l.id} onClick={() => goToLesson(l)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: 'pointer',
                    background: active ? 'var(--accent-cyan-dim)' : 'transparent',
                    borderLeft: active ? '3px solid var(--accent-cyan)' : '3px solid transparent' }}>
                  <Icon size={13} style={{ color: done ? 'var(--accent-green)' : active ? 'var(--accent-cyan)' : 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)', flex: 1, lineHeight: 1.3 }}>{l.title}</span>
                  {done && <CheckCircle size={12} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 28px', borderBottom: '1px solid var(--border-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: '0 0 3px', fontSize: 17, color: 'var(--text-primary)' }}>{lesson.title}</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={12} />{lesson.duration_minutes} 分鐘
            </span>
          </div>
          {['quiz', 'assignment'].includes(lesson.type) ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
              color: isCompleted ? 'var(--accent-green)'
                : submissions[lesson.id]?.status === 'submitted' ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
              <CheckCircle size={14} />
              {isCompleted ? '已通過'
                : submissions[lesson.id]?.status === 'submitted' ? '批閱中'
                : lesson.type === 'quiz' ? '待完成測驗' : '待繳交作業'}
            </span>
          ) : (
            <button className={isCompleted ? 'btn btn-secondary' : 'btn btn-primary'}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={markComplete} disabled={isCompleted || marking || !enrollment}>
              <CheckCircle size={14} />
              {isCompleted ? '已完成' : marking ? '標記中...' : '標記完成'}
            </button>
          )}
        </div>

        <div style={{ flex: 1, padding: 28 }}>
          {lesson.type === 'video' && lesson.content ? (
            <VideoPlayer url={lesson.content} />
          ) : lesson.type === 'quiz' ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <HelpCircle size={40} style={{ color: 'var(--accent-purple)', marginBottom: 12 }} />
              {isCompleted ? (
                <p style={{ color: 'var(--accent-green)', marginBottom: 20, fontWeight: 600 }}>
                  ✓ 已通過此測驗{typeof progress[lesson.id]?.score === 'number' ? `（${progress[lesson.id].score} 分）` : ''}
                </p>
              ) : submissions[lesson.id]?.status === 'submitted' ? (
                <p style={{ color: 'var(--accent-orange)', marginBottom: 20, fontWeight: 600 }}>
                  📝 已提交，批閱中—管理者評分後才會計算成績
                </p>
              ) : (
                <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
                  此單元為測驗，需達 {course.passing_score || 80} 分才算通過
                </p>
              )}
              {submissions[lesson.id]?.status === 'submitted' && !isCompleted ? (
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>請等待批閱結果</span>
              ) : (
                <button className="btn btn-primary" onClick={() => navigate(`/lms/course/${courseId}/quiz/${lesson.id}`)}>
                  {isCompleted ? '重新測驗' : '開始測驗'}
                </button>
              )}
            </div>
          ) : lesson.type === 'assignment' ? (
            <div style={{ maxWidth: 640 }}>
              <div style={{ lineHeight: 1.8, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontSize: 15, marginBottom: 20 }}>
                {lesson.content || <span style={{ color: 'var(--text-muted)' }}>（此作業尚無說明）</span>}
              </div>
              {isCompleted ? (
                <div className="card" style={{ padding: '14px 16px', background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontSize: 14 }}>
                  ✓ 作業已通過批閱
                </div>
              ) : submissions[lesson.id]?.status === 'submitted' ? (
                <div className="card" style={{ padding: '14px 16px', background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', fontSize: 14 }}>
                  📤 已上傳，批閱中—管理者確認後才算完成
                </div>
              ) : (
                <div>
                  {submissions[lesson.id]?.status === 'graded' && (
                    <p style={{ color: 'var(--accent-red)', fontSize: 13, marginBottom: 10 }}>上一份未通過,請重新上傳。</p>
                  )}
                  <label className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: uploading ? 'default' : 'pointer' }}>
                    <Upload size={14} />{uploading ? '上傳中...' : '上傳作業檔案'}
                    <input type="file" hidden disabled={uploading || !enrollment}
                      accept="video/*,image/*,application/pdf" onChange={e => handleUpload(e.target.files?.[0])} />
                  </label>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>支援影片 / 圖片 / PDF,上限約 50MB。</p>
                </div>
              )}
            </div>
          ) : (
            <div style={{ maxWidth: 720, lineHeight: 1.8, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontSize: 15 }}>
              {lesson.content || <span style={{ color: 'var(--text-muted)' }}>（此單元尚無內容）</span>}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 28px', borderTop: '1px solid var(--border-primary)',
          display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            disabled={!prevLesson} onClick={() => prevLesson && goToLesson(prevLesson)}>
            <ArrowLeft size={14} /> 上一單元
          </button>
          <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            disabled={!nextLesson} onClick={() => nextLesson && goToLesson(nextLesson)}>
            下一單元 <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function VideoPlayer({ url }) {
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be')
  const isVimeo = url.includes('vimeo.com')
  if (isYoutube) {
    const videoId = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1]
    return (
      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 8, overflow: 'hidden' }}>
        <iframe style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
          src={`https://www.youtube.com/embed/${videoId}`} allowFullScreen title="lesson video" />
      </div>
    )
  }
  if (isVimeo) {
    const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1]
    return (
      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 8, overflow: 'hidden' }}>
        <iframe style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
          src={`https://player.vimeo.com/video/${videoId}`} allowFullScreen title="lesson video" />
      </div>
    )
  }
  return <video controls style={{ width: '100%', borderRadius: 8, background: '#000' }} src={url}>您的瀏覽器不支援影片播放</video>
}
