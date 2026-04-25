import { useState, useEffect } from 'react'
import { Plus, ChevronUp, ChevronDown } from 'lucide-react'
import { getPerformanceReviews } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'

const PERIODS = ['2026 Q1', '2026 Q2', '2026 Q3', '2026 Q4', '2025 Q4']
const RATINGS = ['S', 'A+', 'A', 'B+', 'B', 'C']
const GOAL_CATEGORIES = ['業績', '學習', '專案', '品質', '協作', '其他']

export default function Performance() {
  const [tab, setTab] = useState('reviews')
  const [reviews, setReviews] = useState([])
  const [goals, setGoals] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [showGoalModal, setShowGoalModal] = useState(false)
  const [reviewForm, setReviewForm] = useState({ employee: '', period: PERIODS[0], overall_score: '', goals_completed: '', goals: '', rating: 'A', reviewer: '', status: '自評中' })
  const [goalForm, setGoalForm] = useState({ employee: '', category: GOAL_CATEGORIES[0], title: '', target: '', current: '0', unit: '', deadline: '', note: '' })

  useEffect(() => {
    Promise.all([
      getPerformanceReviews(),
      supabase.from('performance_goals').select('*').order('id'),
      supabase.from('employees').select('id, name, dept, department_id, position, departments!department_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([r, g, e, d]) => {
      setReviews(r.data || [])
      setGoals(g.data || [])
      setEmployees(e.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const setR = (k, v) => setReviewForm(f => ({ ...f, [k]: v }))
  const setG = (k, v) => setGoalForm(f => ({ ...f, [k]: v }))

  const handleAddReview = async () => {
    if (!reviewForm.employee || !reviewForm.overall_score) return
    const { data } = await supabase.from('performance_reviews').insert({
      ...reviewForm,
      overall_score: Number(reviewForm.overall_score),
      goals_completed: Number(reviewForm.goals_completed),
      goals: Number(reviewForm.goals),
    }).select().single()
    if (data) { setReviews(prev => [...prev, data]); setShowReviewModal(false) }
  }

  const handleAddGoal = async () => {
    if (!goalForm.employee || !goalForm.title) return
    const currentVal = Number(goalForm.current) || 0
    const { data } = await supabase.from('performance_goals').insert({
      ...goalForm,
      target: Number(goalForm.target),
      current: currentVal,
      progress: currentVal,  // 雙寫：schema 主欄位是 progress，LIFF 也讀 progress
    }).select().single()
    if (data) { setGoals(prev => [...prev, data]); setShowGoalModal(false) }
    setGoalForm({ employee: '', category: GOAL_CATEGORIES[0], title: '', target: '', current: '0', unit: '', deadline: '', note: '' })
  }

  const updateProgress = async (goal, delta) => {
    // 讀進度 prefer progress（schema 主欄位），fallback current（legacy）
    const cur = Number(goal.progress ?? goal.current ?? 0)
    const targetNum = Number(goal.target) || Infinity
    const newVal = Math.max(0, Math.min(targetNum, cur + delta))
    // 雙寫保持兩欄位同步
    const { data } = await supabase.from('performance_goals')
      .update({ current: newVal, progress: newVal })
      .eq('id', goal.id).select().single()
    if (data) setGoals(prev => prev.map(g => g.id === goal.id ? data : g))
  }

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''
  const filteredReviews = reviews.filter(r => deptFilter === '' || getEmpDept(r.employee) === deptFilter)
  const filteredGoals = goals.filter(g => deptFilter === '' || getEmpDept(g.employee) === deptFilter)
  const avg = filteredReviews.length ? Math.round(filteredReviews.reduce((s, p) => s + (p.overall_score || 0), 0) / filteredReviews.length) : 0


  const EmpSelect = ({ value, onChange }) => (
    <select className="form-input" style={{ width: '100%' }} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">請選擇員工</option>
      {departments.map(d => (
        <optgroup key={d.id} label={d.name}>
          {employees.filter(e => e.dept === d.name).map(e => (
            <option key={e.id} value={e.name}>{empLabel(e)}｜{e.position}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⭐</span> 績效管理</h2>
            <p>員工個人績效追蹤與考核</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {tab === 'reviews'
              ? <button className="btn btn-primary" onClick={() => setShowReviewModal(true)}><Plus size={14} /> 新增考核</button>
              : <button className="btn btn-primary" onClick={() => setShowGoalModal(true)}><Plus size={14} /> 新增目標</button>
            }
          </div>
        </div>
      </div>

      {/* 部門篩選 */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      {/* Tab 切換 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {[['reviews', '📋 考核紀錄'], ['goals', '🎯 目標追蹤']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            background: tab === key ? 'var(--accent-cyan)' : 'transparent',
            color: tab === key ? '#fff' : 'var(--text-muted)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'reviews' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">已完成考核</div>
              <div className="stat-card-value">{filteredReviews.filter(p => p.status === '已完成').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">評核中</div>
              <div className="stat-card-value">{filteredReviews.filter(p => p.status === '評核中').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">自評中</div>
              <div className="stat-card-value">{filteredReviews.filter(p => p.status === '自評中').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">平均分數</div>
              <div className="stat-card-value">{avg}</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📋</span> 績效考核紀錄</div>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>員工</th><th>部門</th><th>考核期</th><th>分數</th><th>目標達成</th><th>等級</th><th>評核人</th><th>狀態</th></tr>
                </thead>
                <tbody>
                  {filteredReviews.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.employee}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(p.employee) || '-'}</td>
                      <td>{p.period}</td>
                      <td style={{ fontWeight: 700, color: p.overall_score >= 90 ? 'var(--accent-green)' : p.overall_score >= 80 ? 'var(--accent-cyan)' : 'var(--accent-orange)' }}>
                        {p.overall_score}
                      </td>
                      <td>{p.goals_completed}/{p.goals}</td>
                      <td><span className={`badge ${p.rating?.startsWith('A') || p.rating === 'S' ? 'badge-success' : 'badge-info'}`}>{p.rating}</span></td>
                      <td>{p.reviewer}</td>
                      <td>
                        <span className={`badge ${p.status === '已完成' ? 'badge-success' : p.status === '評核中' ? 'badge-info' : 'badge-warning'}`}>
                          <span className="badge-dot"></span>{p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'goals' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">已達成</div>
              <div className="stat-card-value">{filteredGoals.filter(g => g.current >= g.target).length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">進行中</div>
              <div className="stat-card-value">{filteredGoals.filter(g => g.current > 0 && g.current < g.target).length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">未開始</div>
              <div className="stat-card-value">{filteredGoals.filter(g => !g.current || g.current === 0).length}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredGoals.length === 0 && (
              <div className="card"><div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無目標，點擊「新增目標」開始設定</div></div>
            )}
            {filteredGoals.map(g => {
              const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0
              const done = g.current >= g.target
              return (
                <div key={g.id} className="card">
                  <div className="card-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span className="badge badge-cyan">{g.category}</span>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{g.title}</span>
                          {done && <span className="badge badge-success">✓ 達成</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          負責人：{g.employee}
                          {g.deadline && <span style={{ marginLeft: 12 }}>截止：{g.deadline}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button onClick={() => updateProgress(g, -1)} style={{ background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                          <ChevronDown size={14} />
                        </button>
                        <span style={{ fontSize: 13, fontWeight: 700, minWidth: 60, textAlign: 'center' }}>
                          {g.current} / {g.target} {g.unit}
                        </span>
                        <button onClick={() => updateProgress(g, 1)} style={{ background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', color: 'var(--accent-cyan)' }}>
                          <ChevronUp size={14} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="progress-track" style={{ flex: 1 }}>
                        <div className="progress-fill" style={{
                          width: `${pct}%`,
                          background: done ? 'var(--accent-green)' : pct >= 70 ? 'var(--accent-cyan)' : pct >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)',
                        }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: done ? 'var(--accent-green)' : 'var(--text-secondary)', minWidth: 36 }}>{pct}%</span>
                    </div>
                    {g.note && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{g.note}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* 新增考核 Modal */}
      {showReviewModal && (
        <Modal title="新增績效考核" onClose={() => setShowReviewModal(false)} onSubmit={handleAddReview}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工 *">
              <EmpSelect value={reviewForm.employee} onChange={v => setR('employee', v)} />
            </Field>
            <Field label="考核期">
              <select className="form-input" style={{ width: '100%' }} value={reviewForm.period} onChange={e => setR('period', e.target.value)}>
                {PERIODS.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="總分 *">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0-100" min="0" max="100" value={reviewForm.overall_score} onChange={e => setR('overall_score', e.target.value)} />
            </Field>
            <Field label="達成目標數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={reviewForm.goals_completed} onChange={e => setR('goals_completed', e.target.value)} />
            </Field>
            <Field label="總目標數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={reviewForm.goals} onChange={e => setR('goals', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="等級">
              <select className="form-input" style={{ width: '100%' }} value={reviewForm.rating} onChange={e => setR('rating', e.target.value)}>
                {RATINGS.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="評核人">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="主管姓名" value={reviewForm.reviewer} onChange={e => setR('reviewer', e.target.value)} />
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={reviewForm.status} onChange={e => setR('status', e.target.value)}>
                <option>自評中</option>
                <option>評核中</option>
                <option>已完成</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}

      {/* 新增目標 Modal */}
      {showGoalModal && (
        <Modal title="新增績效目標" onClose={() => setShowGoalModal(false)} onSubmit={handleAddGoal}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工 *">
              <EmpSelect value={goalForm.employee} onChange={v => setG('employee', v)} />
            </Field>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={goalForm.category} onChange={e => setG('category', e.target.value)}>
                {GOAL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="目標名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：完成 5 個客戶提案" value={goalForm.title} onChange={e => setG('title', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="目標值 *">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="5" value={goalForm.target} onChange={e => setG('target', e.target.value)} />
            </Field>
            <Field label="目前進度">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={goalForm.current} onChange={e => setG('current', e.target.value)} />
            </Field>
            <Field label="單位">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="個 / 件 / % ..." value={goalForm.unit} onChange={e => setG('unit', e.target.value)} />
            </Field>
          </div>
          <Field label="截止日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={goalForm.deadline} onChange={e => setG('deadline', e.target.value)} />
          </Field>
          <Field label="備註">
            <textarea className="form-input" style={{ width: '100%', height: 72, resize: 'vertical' }} placeholder="目標說明或達成標準" value={goalForm.note} onChange={e => setG('note', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
