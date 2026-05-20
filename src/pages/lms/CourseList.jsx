import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useAuth } from '../../contexts/AuthContext'
import { BookOpen, Clock, Plus, Search } from 'lucide-react'

const DIFFICULTY_COLOR = {
  '初級': 'var(--accent-green)',
  '中級': 'var(--accent-orange)',
  '進階': 'var(--accent-red)',
}

export default function CourseList() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [courses, setCourses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [categories, setCategories] = useState([])

  useEffect(() => {
    if (!profile?.organization_id) return
    const courseQuery = supabase.from('lms_courses').select('*').eq('status', '發布').eq('organization_id', profile.organization_id).order('created_at', { ascending: false })
    const enrollQuery = supabase.from('lms_enrollments').select('course_id, status, completed_at').eq('employee_id', profile.id)
    Promise.all([courseQuery, enrollQuery]).then(([c, e]) => {
      const list = c.data || []
      setCourses(list)
      setEnrollments(e.data || [])
      setCategories([...new Set(list.map(x => x.category).filter(Boolean))])
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />

  const enrollmentMap = Object.fromEntries(enrollments.map(e => [e.course_id, e]))
  const filtered = courses.filter(c => {
    const matchSearch = !search || c.title.includes(search) || (c.description || '').includes(search)
    const matchCat = !categoryFilter || c.category === categoryFilter
    return matchSearch && matchCat
  })

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text-primary)' }}>課程總覽</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{filtered.length} 門課程</p>
        </div>
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => navigate('/lms/builder')}>
          <Plus size={15} /> 新增課程
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="搜尋課程名稱..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-input" style={{ width: 160 }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">所有分類</option>
          {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>
          <BookOpen size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p>目前沒有符合條件的課程</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map(course => (
            <CourseCard
              key={course.id}
              course={course}
              enrollment={enrollmentMap[course.id]}
              onClick={() => navigate(`/lms/course/${course.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CourseCard({ course, enrollment, onClick }) {
  const diffColor = DIFFICULTY_COLOR[course.difficulty] || 'var(--accent-blue)'
  return (
    <div className="card" style={{ cursor: 'pointer', padding: 0, overflow: 'hidden', transition: 'transform 0.15s' }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
      <div style={{ height: 110, background: course.thumbnail_url ? `url(${course.thumbnail_url}) center/cover` : 'var(--bg-tertiary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!course.thumbnail_url && <BookOpen size={34} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />}
      </div>
      <div style={{ padding: '12px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: diffColor + '22', color: diffColor }}>{course.difficulty}</span>
          {course.category && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{course.category}</span>}
          {course.is_required && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-red)', marginLeft: 'auto' }}>必修</span>}
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.4 }}>{course.title}</h3>
        {course.description && (
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {course.description}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} />{course.estimated_hours}h</span>
        </div>
        {enrollment ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>{enrollment.status}</span>
              {enrollment.status === '已完成' && <span style={{ color: 'var(--accent-green)' }}>✓ 完成</span>}
            </div>
            <div style={{ height: 4, background: 'var(--bg-tertiary)', borderRadius: 2 }}>
              <div style={{ height: '100%', borderRadius: 2,
                width: enrollment.status === '已完成' ? '100%' : '40%',
                background: enrollment.status === '已完成' ? 'var(--accent-green)' : 'var(--accent-cyan)' }} />
            </div>
          </div>
        ) : (
          <button className="btn btn-primary" style={{ width: '100%', fontSize: 13 }}>開始學習</button>
        )}
      </div>
    </div>
  )
}
