import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { toast } from 'sonner'
import { Plus, Trash2, ChevronDown, ChevronUp, Save, ArrowLeft, FileText, Video, HelpCircle } from 'lucide-react'
import { getEventBus } from '../../lib/events/EventBus'

const LESSON_TYPE_ICON = { text: FileText, video: Video, quiz: HelpCircle }
const LESSON_TYPE_LABEL = { text: '文字', video: '影片', quiz: '測驗' }

const DEFAULT_COURSE = {
  title: '', description: '', category: '一般', difficulty: '初級',
  estimated_hours: 1.0, passing_score: 80, is_required: false, status: '草稿',
}

export default function CourseBuilder() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [course, setCourse] = useState(DEFAULT_COURSE)
  const [sections, setSections] = useState([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    Promise.all([
      supabase.from('lms_courses').select('*').eq('id', id).single(),
      supabase.from('lms_sections').select('*, lms_lessons(*)').eq('course_id', id).order('sort_order'),
    ]).then(([c, s]) => {
      if (c.data) setCourse(c.data)
      if (s.data) setSections(s.data.map(sec => ({
        ...sec,
        lessons: (sec.lms_lessons || []).sort((a, b) => a.sort_order - b.sort_order),
      })))
    }).finally(() => setLoading(false))
  }, [id, isEdit])

  if (loading) return <LoadingSpinner />

  const addSection = () => setSections(prev => [...prev, {
    _tempId: Date.now(), title: '新章節', lessons: [], sort_order: prev.length,
  }])

  const removeSection = idx => setSections(prev => prev.filter((_, i) => i !== idx))

  const addLesson = sectionIdx => setSections(prev => prev.map((sec, i) =>
    i !== sectionIdx ? sec : {
      ...sec,
      lessons: [...sec.lessons, {
        _tempId: Date.now(), title: '新單元', type: 'text',
        content: '', quiz_data: [], duration_minutes: 5, sort_order: sec.lessons.length,
      }],
    }
  ))

  const removeLesson = (sectionIdx, lessonIdx) => setSections(prev => prev.map((sec, i) =>
    i !== sectionIdx ? sec : { ...sec, lessons: sec.lessons.filter((_, j) => j !== lessonIdx) }
  ))

  const updateLesson = (sectionIdx, lessonIdx, patch) => setSections(prev => prev.map((sec, i) =>
    i !== sectionIdx ? sec : {
      ...sec, lessons: sec.lessons.map((l, j) => j !== lessonIdx ? l : { ...l, ...patch }),
    }
  ))

  const handleSave = async () => {
    if (!course.title.trim()) { toast.error('請輸入課程名稱'); return }
    setSaving(true)
    try {
      let courseId = id
      const courseData = { ...course, updated_at: new Date().toISOString() }
      delete courseData.id

      if (isEdit) {
        const { error } = await supabase.from('lms_courses').update(courseData).eq('id', id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('lms_courses').insert(courseData).select().single()
        if (error) throw error
        courseId = data.id
      }

      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si]
        const secData = { course_id: courseId, title: sec.title, sort_order: si }
        let secId = sec.id

        if (sec.id) {
          await supabase.from('lms_sections').update(secData).eq('id', sec.id)
        } else {
          const { data } = await supabase.from('lms_sections').insert(secData).select().single()
          secId = data.id
        }

        for (let li = 0; li < sec.lessons.length; li++) {
          const lesson = sec.lessons[li]
          const lessonData = {
            course_id: courseId, section_id: secId,
            title: lesson.title, type: lesson.type,
            content: lesson.content || '', quiz_data: lesson.quiz_data || [],
            duration_minutes: lesson.duration_minutes || 5, sort_order: li,
          }
          if (lesson.id) {
            await supabase.from('lms_lessons').update(lessonData).eq('id', lesson.id)
          } else {
            await supabase.from('lms_lessons').insert(lessonData)
          }
        }
      }

      if (!isEdit && courseData.status === '發布') {
        await getEventBus().publish('lms.course.published', {
          course_id: String(courseId), title: course.title, category: course.category || '',
        })
      }

      toast.success(isEdit ? '課程已更新' : '課程已建立')
      navigate('/lms/courses')
    } catch (err) {
      toast.error(`儲存失敗：${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className="btn btn-ghost" onClick={() => navigate('/lms/courses')} style={{ padding: '6px 10px' }}>
          <ArrowLeft size={16} />
        </button>
        <h1 style={{ margin: 0, fontSize: 20, color: 'var(--text-primary)' }}>{isEdit ? '編輯課程' : '新增課程'}</h1>
        <button className="btn btn-primary" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={handleSave} disabled={saving}>
          <Save size={14} />{saving ? '儲存中...' : '儲存'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, color: 'var(--text-primary)' }}>課程基本資訊</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">課程名稱 *</label>
            <input className="form-input" value={course.title}
              onChange={e => setCourse(p => ({ ...p, title: e.target.value }))} placeholder="輸入課程名稱" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">課程描述</label>
            <textarea className="form-input" rows={3} value={course.description || ''}
              onChange={e => setCourse(p => ({ ...p, description: e.target.value }))} placeholder="簡述課程內容..." />
          </div>
          <div>
            <label className="form-label">分類</label>
            <input className="form-input" value={course.category || ''}
              onChange={e => setCourse(p => ({ ...p, category: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">難度</label>
            <select className="form-input" value={course.difficulty}
              onChange={e => setCourse(p => ({ ...p, difficulty: e.target.value }))}>
              {['初級', '中級', '進階'].map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">預估時數 (h)</label>
            <input className="form-input" type="number" min={0.5} step={0.5} value={course.estimated_hours}
              onChange={e => setCourse(p => ({ ...p, estimated_hours: parseFloat(e.target.value) || 1 }))} />
          </div>
          <div>
            <label className="form-label">及格分數</label>
            <input className="form-input" type="number" min={0} max={100} value={course.passing_score}
              onChange={e => setCourse(p => ({ ...p, passing_score: parseInt(e.target.value) || 80 }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="is_required" checked={course.is_required}
              onChange={e => setCourse(p => ({ ...p, is_required: e.target.checked }))} />
            <label htmlFor="is_required" style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>設為必修課程</label>
          </div>
          <div>
            <label className="form-label">狀態</label>
            <select className="form-input" value={course.status}
              onChange={e => setCourse(p => ({ ...p, status: e.target.value }))}>
              {['草稿', '發布', '封存'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>章節與單元</h3>
        <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          onClick={addSection}><Plus size={14} /> 新增章節</button>
      </div>

      {sections.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <p>尚未新增章節，點擊「新增章節」開始建立課程內容</p>
        </div>
      ) : sections.map((sec, si) => (
        <SectionEditor key={sec.id || sec._tempId} section={sec} sectionIdx={si}
          onChange={patch => setSections(prev => prev.map((s, i) => i === si ? { ...s, ...patch } : s))}
          onRemove={() => removeSection(si)}
          onAddLesson={() => addLesson(si)}
          onRemoveLesson={li => removeLesson(si, li)}
          onUpdateLesson={(li, patch) => updateLesson(si, li, patch)}
        />
      ))}
    </div>
  )
}

function SectionEditor({ section, sectionIdx, onChange, onRemove, onAddLesson, onRemoveLesson, onUpdateLesson }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        background: 'var(--bg-tertiary)', cursor: 'pointer' }} onClick={() => setCollapsed(p => !p)}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
          {sectionIdx + 1}. {section.title}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{section.lessons.length} 個單元</span>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}
          onClick={e => { e.stopPropagation(); onRemove() }}><Trash2 size={14} /></button>
      </div>
      {!collapsed && (
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label className="form-label">章節名稱</label>
            <input className="form-input" value={section.title} onChange={e => onChange({ title: e.target.value })} />
          </div>
          {section.lessons.map((lesson, li) => (
            <LessonEditor key={lesson.id || lesson._tempId} lesson={lesson} lessonIdx={li}
              onChange={patch => onUpdateLesson(li, patch)} onRemove={() => onRemoveLesson(li)} />
          ))}
          <button className="btn btn-secondary" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}
            onClick={onAddLesson}><Plus size={13} /> 新增單元</button>
        </div>
      )}
    </div>
  )
}

function LessonEditor({ lesson, onChange, onRemove }) {
  const Icon = LESSON_TYPE_ICON[lesson.type] || FileText
  return (
    <div style={{ border: '1px solid var(--border-primary)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Icon size={14} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
        <input className="form-input" style={{ flex: 1 }} value={lesson.title}
          onChange={e => onChange({ title: e.target.value })} placeholder="單元標題" />
        <select className="form-input" style={{ width: 90 }} value={lesson.type}
          onChange={e => onChange({ type: e.target.value })}>
          {Object.entries(LESSON_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="form-input" style={{ width: 80 }} type="number" min={1} value={lesson.duration_minutes}
          onChange={e => onChange({ duration_minutes: parseInt(e.target.value) || 5 })} placeholder="分鐘" />
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}
          onClick={onRemove}><Trash2 size={13} /></button>
      </div>
      {lesson.type !== 'quiz' ? (
        <textarea className="form-input" rows={3} value={lesson.content || ''}
          onChange={e => onChange({ content: e.target.value })}
          placeholder={lesson.type === 'video' ? '貼上影片網址（YouTube / Vimeo）' : '輸入課程內容（支援 Markdown）'} />
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
          測驗題目儲存後可於學員端作答
        </div>
      )}
    </div>
  )
}
