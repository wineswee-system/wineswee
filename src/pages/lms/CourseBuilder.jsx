import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useAuth } from '../../contexts/AuthContext'
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
  const { profile } = useAuth()
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
      const courseData = { ...course, updated_at: new Date().toISOString(), organization_id: profile?.organization_id }
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
        <QuizEditor quizData={lesson.quiz_data} onChange={quiz_data => onChange({ quiz_data })} />
      )}
    </div>
  )
}

// ── QuizEditor ──────────────────────────────────────────────────
function QuizEditor({ quizData, onChange }) {
  const questions = Array.isArray(quizData) ? quizData : []
  const [showImport, setShowImport] = useState(false)

  const addQuestion = () => onChange([...questions, { question: '', options: ['', ''], answer_index: 0, explanation: '' }])
  const removeQuestion = (qi) => onChange(questions.filter((_, i) => i !== qi))
  const updateQuestion = (qi, patch) => onChange(questions.map((q, i) => i !== qi ? q : { ...q, ...patch }))
  const addOption = (qi) => updateQuestion(qi, { options: [...questions[qi].options, ''] })
  const removeOption = (qi, oi) => {
    const q = questions[qi]
    const opts = q.options.filter((_, i) => i !== oi)
    const ans = q.answer_index === oi ? 0 : q.answer_index > oi ? q.answer_index - 1 : q.answer_index
    updateQuestion(qi, { options: opts, answer_index: Math.min(ans, opts.length - 1) })
  }
  const updateOption = (qi, oi, val) =>
    updateQuestion(qi, { options: questions[qi].options.map((o, i) => i !== oi ? o : val) })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {questions.length} 題</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => setShowImport(true)}>匯入</button>
          <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={addQuestion}><Plus size={12} /> 新增題目</button>
        </div>
      </div>

      {questions.length === 0 && (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12,
          background: 'var(--bg-tertiary)', borderRadius: 8 }}>
          尚未新增題目，點「新增題目」或「匯入」開始
        </div>
      )}

      {questions.map((q, qi) => (
        <div key={qi} style={{ border: '1px solid var(--border-primary)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)', minWidth: 22 }}>Q{qi + 1}</span>
            <input className="form-input" style={{ flex: 1 }} placeholder="輸入題目文字…"
              value={q.question} onChange={e => updateQuestion(qi, { question: e.target.value })} />
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}
              onClick={() => removeQuestion(qi)}><Trash2 size={14} /></button>
          </div>

          <div style={{ paddingLeft: 28 }}>
            {q.options.map((opt, oi) => (
              <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <input type="radio" name={`q${qi}-answer`} checked={q.answer_index === oi}
                  onChange={() => updateQuestion(qi, { answer_index: oi })}
                  title="設為正確答案"
                  style={{ cursor: 'pointer', accentColor: 'var(--accent-green)', flexShrink: 0 }} />
                <input className="form-input" style={{ flex: 1, fontSize: 13 }} placeholder={`選項 ${oi + 1}`}
                  value={opt} onChange={e => updateOption(qi, oi, e.target.value)} />
                {q.options.length > 2 && (
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                    onClick={() => removeOption(qi, oi)}><Trash2 size={12} /></button>
                )}
              </div>
            ))}
            {q.options.length < 6 && (
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', marginBottom: 8 }}
                onClick={() => addOption(qi)}>＋ 新增選項</button>
            )}
            <input className="form-input" style={{ fontSize: 12, marginTop: 4 }} placeholder="解析說明（選填，學員答題後顯示）"
              value={q.explanation || ''} onChange={e => updateQuestion(qi, { explanation: e.target.value })} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              ● 點左側圓圈設定正確答案
            </div>
          </div>
        </div>
      ))}

      {showImport && (
        <QuizImportModal
          onClose={() => setShowImport(false)}
          onImport={(parsed) => { onChange([...questions, ...parsed]); setShowImport(false) }}
        />
      )}
    </div>
  )
}

// ── QuizImportModal ──────────────────────────────────────────────
function QuizImportModal({ onClose, onImport }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')

  const parse = () => {
    try {
      const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
      if (!lines.length) { setError('請貼上題目內容'); return }
      const dataLines = /題目|question/i.test(lines[0]) ? lines.slice(1) : lines
      const parsed = dataLines.map((line, i) => {
        const cols = line.includes('\t') ? line.split('\t') : line.split(',')
        const t = cols.map(c => c.trim().replace(/^"|"$/g, ''))
        if (t.length < 3) throw new Error(`第 ${i + 1} 行格式不符（至少需要：題目、選項A、選項B）`)
        // 判斷最後第2欄是否為數字（答案編號）
        const hasAnswer = /^\d+$/.test(t[t.length - 2])
        let options, answer_index, explanation
        if (hasAnswer) {
          options = t.slice(1, -2).filter(Boolean)
          answer_index = Math.max(0, parseInt(t[t.length - 2]) - 1)
          explanation = t[t.length - 1] || ''
        } else {
          options = t.slice(1).filter(Boolean)
          answer_index = 0
          explanation = ''
        }
        if (!t[0]) throw new Error(`第 ${i + 1} 行題目不可空白`)
        if (options.length < 2) throw new Error(`第 ${i + 1} 行選項不足 2 個`)
        return { question: t[0], options, answer_index: Math.min(answer_index, options.length - 1), explanation }
      })
      setPreview(parsed); setError('')
    } catch (e) { setError(e.message); setPreview(null) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 660, maxHeight: '82vh', overflowY: 'auto', padding: 24 }}>
        <h3 style={{ margin: '0 0 6px', color: 'var(--text-primary)' }}>匯入測驗題目</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, flex: 1 }}>
            格式（逗號或 Tab 分隔）：<br />
            <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
              題目, 選項A, 選項B, 選項C, 選項D, 正確答案(1起算), 解析說明
            </code><br />
            範例：收銀機如何開啟？, 按電源鍵, 插電就好, 叫主管開, 不需要開, 1, 按電源鍵後等待啟動<br />
            ※ 正確答案欄與解析欄可省略（省略時預設選項A為正確答案）
          </p>
          <button className="btn btn-ghost" style={{ fontSize: 12, whiteSpace: 'nowrap', marginLeft: 12 }}
            onClick={() => {
              const csv = '題目,選項A,選項B,選項C,選項D,正確答案(1-4),解析說明\n' +
                '收銀機如何開啟？,按電源鍵,插電就好,叫主管開,不需要開,1,按電源鍵後等待系統啟動約 30 秒\n' +
                '服務守則中禁止的行為？,對客戶不禮貌,主動問候,協助找商品,微笑服務,1,請參閱服務守則第三條\n' +
                '發現商品短缺應如何處理？,立即補貨,忽略,通知主管,詢問客戶,3,短缺需通報主管才可安排補貨'
              const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = '測驗題目範本.csv'
              a.click()
              URL.revokeObjectURL(a.href)
            }}>
            ↓ 下載範本
          </button>
        </div>
        <textarea className="form-input" rows={8} value={text} onChange={e => { setText(e.target.value); setPreview(null); setError('') }}
          placeholder="貼上題目資料…" style={{ fontFamily: 'monospace', fontSize: 12 }} />

        {error && <p style={{ color: 'var(--accent-red)', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}

        {preview && (
          <div style={{ margin: '12px 0 0', padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ color: 'var(--accent-green)', fontWeight: 600, marginBottom: 8 }}>✓ 解析成功，共 {preview.length} 題</div>
            {preview.map((q, i) => (
              <div key={i} style={{ marginBottom: 4, color: 'var(--text-secondary)' }}>
                Q{i + 1}. {q.question}
                <span style={{ color: 'var(--accent-green)', marginLeft: 8 }}>正確：{q.options[q.answer_index]}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          {!preview
            ? <button className="btn btn-primary" onClick={parse}>解析預覽</button>
            : <button className="btn btn-primary" onClick={() => onImport(preview)}>匯入 {preview.length} 題</button>
          }
        </div>
      </div>
    </div>
  )
}
