import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, BookOpen, Users, ChevronDown, ChevronRight, Award } from 'lucide-react'
import { getTrainingCourses, createTrainingCourse, updateTrainingCourse, deleteTrainingCourse, getTrainingEnrollments, createTrainingEnrollment, updateTrainingEnrollment } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const CATEGORIES = ['一般', '安全', '技術', '管理', '合規']
const STATUSES = ['開課中', '已結束', '草稿']
const ENROLL_STATUSES = ['已報名', '進行中', '已完成', '未通過']

const emptyForm = { title: '', description: '', category: '一般', duration_hours: '1', instructor: '', max_enrollment: '30', status: '開課中' }

export default function Training() {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [enrollments, setEnrollments] = useState([])
  const [enrollForm, setEnrollForm] = useState({ employee: '', status: '已報名' })
  const [showEnrollModal, setShowEnrollModal] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const { data, error } = await getTrainingCourses()
    if (error) setError(error.message)
    else setCourses(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.title) return
    setSaving(true)
    const payload = { ...form, duration_hours: Number(form.duration_hours), max_enrollment: Number(form.max_enrollment) }
    delete payload.id
    if (editingId) {
      const { error } = await updateTrainingCourse(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await createTrainingCourse(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false); setShowModal(false); setForm(emptyForm); setEditingId(null); load()
  }

  const handleEdit = (c) => {
    setForm({ title: c.title, description: c.description || '', category: c.category, duration_hours: String(c.duration_hours), instructor: c.instructor || '', max_enrollment: String(c.max_enrollment), status: c.status })
    setEditingId(c.id); setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('確定刪除此課程？')) return
    await deleteTrainingCourse(id); load()
  }

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    const { data } = await getTrainingEnrollments(id)
    setEnrollments(data || [])
  }

  const handleEnroll = async () => {
    if (!enrollForm.employee) return
    const { error } = await createTrainingEnrollment({ course_id: expandedId, employee: enrollForm.employee, status: '已報名' })
    if (error) { setError(error.message); return }
    setShowEnrollModal(false); setEnrollForm({ employee: '', status: '已報名' })
    const { data } = await getTrainingEnrollments(expandedId)
    setEnrollments(data || [])
  }

  const updateEnrollStatus = async (id, status, score) => {
    const update = { status }
    if (status === '已完成') update.completed_at = new Date().toISOString()
    if (score !== undefined) update.score = score
    await updateTrainingEnrollment(id, update)
    const { data } = await getTrainingEnrollments(expandedId)
    setEnrollments(data || [])
  }

  const catColor = (c) => {
    switch (c) { case '安全': return '#f87171'; case '技術': return '#3b82f6'; case '管理': return '#a78bfa'; case '合規': return '#fb923c'; default: return '#34d399' }
  }

  if (loading) return <LoadingSpinner />

  const totalEnrolled = courses.reduce((s, c) => s, 0) // placeholder
  const activeCourses = courses.filter(c => c.status === '開課中').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🎓</span> 教育訓練</h2>
            <p>Training / LMS — 課程管理、報名、完課追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增課程
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">總課程數</div>
          <div className="stat-card-value">{courses.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">開課中</div>
          <div className="stat-card-value">{activeCourses}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">分類數</div>
          <div className="stat-card-value">{new Set(courses.map(c => c.category)).size}</div>
        </div>
      </div>

      {courses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>尚無課程</div>
      ) : courses.map(course => (
        <div key={course.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', gap: 10 }} onClick={() => toggleExpand(course.id)}>
            {expandedId === course.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <BookOpen size={18} style={{ color: catColor(course.category) }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{course.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {course.instructor && <span>講師：{course.instructor} | </span>}
                {course.duration_hours}h
              </div>
            </div>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: `color-mix(in srgb, ${catColor(course.category)} 15%, transparent)`, color: catColor(course.category) }}>{course.category}</span>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: course.status === '開課中' ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)', color: course.status === '開課中' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{course.status}</span>
            <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={e => { e.stopPropagation(); handleEdit(course) }}><Edit3 size={13} /></button>
            <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={e => { e.stopPropagation(); handleDelete(course.id) }}><Trash2 size={13} /></button>
          </div>

          {expandedId === course.id && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
              {course.description && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>{course.description}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>學員 ({enrollments.length} / {course.max_enrollment})</span>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setShowEnrollModal(true)}>
                  <Plus size={12} /> 新增學員
                </button>
              </div>
              {enrollments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>尚無學員</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>員工</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>狀態</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px' }}>分數</th>
                      <th style={{ padding: '6px 8px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.map(e => (
                      <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{e.employee}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <select value={e.status} onChange={ev => updateEnrollStatus(e.id, ev.target.value)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 12 }}>
                            {ENROLL_STATUSES.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{e.score ?? '-'}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {e.status === '已完成' && <Award size={14} style={{ color: 'var(--accent-green)' }} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Course Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 460, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>{editingId ? '編輯課程' : '新增課程'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="text" placeholder="課程名稱 *" value={form.title} onChange={e => set('title', e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <textarea placeholder="說明" value={form.description} onChange={e => set('description', e.target.value)} rows={2} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', resize: 'vertical' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <select value={form.category} onChange={e => set('category', e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
                <input type="number" placeholder="時數" value={form.duration_hours} onChange={e => set('duration_hours', e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input type="text" placeholder="講師" value={form.instructor} onChange={e => set('instructor', e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                <input type="number" placeholder="人數上限" value={form.max_enrollment} onChange={e => set('max_enrollment', e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Enroll Modal */}
      {showEnrollModal && (
        <ModalOverlay onClose={() => setShowEnrollModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 340, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>新增學員</h3>
            <input type="text" placeholder="員工姓名" value={enrollForm.employee} onChange={e => setEnrollForm(f => ({ ...f, employee: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowEnrollModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleEnroll}>報名</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
