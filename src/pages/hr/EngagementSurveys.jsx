import { useState, useEffect, useMemo } from 'react'
import { Plus, Send, BarChart2, Eye, Trash2, Edit2, Copy, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEngagementSurveys, createEngagementSurvey, updateEngagementSurvey, deleteEngagementSurvey, getEngagementResponses, submitEngagementResponse } from '../../lib/db'
import { generateSurveyInsights, isConfigured as aiReady } from '../../lib/ai/hrAI'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'

const STATUS_MAP = {
  '草稿': { color: 'var(--text-muted)', bg: 'var(--bg-secondary)' },
  '進行中': { color: 'var(--accent-cyan)', bg: 'rgba(6,182,212,0.12)' },
  '已結束': { color: 'var(--accent-green)', bg: 'rgba(16,185,129,0.12)' },
}

const QUESTION_TYPES = [
  { value: 'rating', label: '評分 (1-5)' },
  { value: 'text', label: '開放文字' },
  { value: 'choice', label: '單選' },
]

const DEFAULT_QUESTIONS = [
  { id: 1, text: '我對目前的工作內容感到滿意', type: 'rating', category: '工作滿意' },
  { id: 2, text: '我認為公司的發展方向明確', type: 'rating', category: '組織認同' },
  { id: 3, text: '我的主管能提供足夠的支持與指導', type: 'rating', category: '管理支持' },
  { id: 4, text: '我有足夠的學習與成長機會', type: 'rating', category: '職涯發展' },
  { id: 5, text: '我覺得自己的薪資福利是公平的', type: 'rating', category: '薪酬福利' },
  { id: 6, text: '團隊合作氛圍良好', type: 'rating', category: '團隊協作' },
  { id: 7, text: '我願意向朋友推薦這間公司 (eNPS)', type: 'rating', category: 'eNPS' },
  { id: 8, text: '你最希望公司改善的一件事是什麼？', type: 'text', category: '建議' },
]

const EMPTY_SURVEY = {
  title: '',
  description: '',
  is_anonymous: true,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
  questions: DEFAULT_QUESTIONS,
}

export default function EngagementSurveys() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [surveys, setSurveys] = useState([])
  const [employees, setEmployees] = useState([])
  const [tab, setTab] = useState('list')
  const [showModal, setShowModal] = useState(false)
  const [surveyForm, setSurveyForm] = useState(EMPTY_SURVEY)
  const [editingId, setEditingId] = useState(null)
  const [selectedSurvey, setSelectedSurvey] = useState(null)
  const [responses, setResponses] = useState([])
  const [showFillModal, setShowFillModal] = useState(false)
  const [fillForm, setFillForm] = useState({})
  const [fillEmployee, setFillEmployee] = useState('')
  const [expandedQ, setExpandedQ] = useState(null)
  const [aiInsights, setAiInsights] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  const setS = (k, v) => setSurveyForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    Promise.all([
      getEngagementSurveys(),
      supabase.from('employees').select('id, name, dept, department_id, position, departments!department_id(name)').eq('status', '在職').order('name'),
    ]).then(([s, e]) => {
      setSurveys(s.data || [])
      setEmployees(e.data || [])
    }).catch(err => {
      console.error('Failed to load surveys:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  const handleCreateSurvey = async () => {
    if (!surveyForm.title) return alert('請填寫問卷標題')
    const payload = {
      title: surveyForm.title,
      description: surveyForm.description,
      is_anonymous: surveyForm.is_anonymous,
      start_date: surveyForm.start_date || null,
      end_date: surveyForm.end_date || null,
      questions: surveyForm.questions,
      status: '草稿',
    }
    const { data, error: err } = editingId
      ? await updateEngagementSurvey(editingId, payload)
      : await createEngagementSurvey(payload)

    if (err) return alert('儲存失敗：' + err.message)
    if (editingId) {
      setSurveys(prev => prev.map(s => s.id === editingId ? data : s))
    } else {
      setSurveys(prev => [data, ...prev])
    }
    setShowModal(false)
    setSurveyForm(EMPTY_SURVEY)
    setEditingId(null)
  }

  const handlePublish = async (id) => {
    const { data, error: err } = await updateEngagementSurvey(id, { status: '進行中' })
    if (!err) setSurveys(prev => prev.map(s => s.id === id ? data : s))
  }

  const handleClose = async (id) => {
    const { data, error: err } = await updateEngagementSurvey(id, { status: '已結束' })
    if (!err) setSurveys(prev => prev.map(s => s.id === id ? data : s))
  }

  const handleDelete = async (id) => {
    if (!confirm('確定刪除此問卷？')) return
    await deleteEngagementSurvey(id)
    setSurveys(prev => prev.filter(s => s.id !== id))
  }

  const handleViewResults = async (survey) => {
    setSelectedSurvey(survey)
    const { data } = await getEngagementResponses(survey.id)
    setResponses(data || [])
    setTab('results')
  }

  const handleOpenFill = (survey) => {
    setSelectedSurvey(survey)
    setFillForm({})
    setFillEmployee('')
    setShowFillModal(true)
  }

  const handleSubmitResponse = async () => {
    if (!selectedSurvey) return
    const ratingQs = (selectedSurvey.questions || []).filter(q => q.type === 'rating')
    const ratingScores = ratingQs.map(q => Number(fillForm[q.id]) || 0).filter(s => s > 0)
    const overall = ratingScores.length ? Math.round((ratingScores.reduce((a, b) => a + b, 0) / ratingScores.length) * 10) / 10 : null

    const { error: err } = await submitEngagementResponse({
      survey_id: selectedSurvey.id,
      employee: selectedSurvey.is_anonymous ? null : fillEmployee,
      dept: selectedSurvey.is_anonymous ? null : employees.find(e => e.name === fillEmployee)?.dept,
      answers: fillForm,
      overall_score: overall,
    })
    if (err) return alert('提交失敗：' + err.message)
    alert('問卷已提交，感謝您的回饋！')
    setShowFillModal(false)
  }

  // Analysis computations
  const analysis = useMemo(() => {
    if (!selectedSurvey || !responses.length) return null
    const questions = selectedSurvey.questions || []
    const qAnalysis = questions.filter(q => q.type === 'rating').map(q => {
      const scores = responses.map(r => Number(r.answers?.[q.id])).filter(s => s > 0)
      const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0
      const dist = [1, 2, 3, 4, 5].map(v => scores.filter(s => s === v).length)
      return { ...q, avg, count: scores.length, dist }
    })

    // eNPS calculation (question with category 'eNPS')
    const enpsQ = questions.find(q => q.category === 'eNPS')
    let enps = null
    if (enpsQ) {
      const scores = responses.map(r => Number(r.answers?.[enpsQ.id])).filter(s => s > 0)
      if (scores.length) {
        const promoters = scores.filter(s => s >= 4).length
        const detractors = scores.filter(s => s <= 2).length
        enps = Math.round(((promoters - detractors) / scores.length) * 100)
      }
    }

    // Category averages
    const catMap = {}
    qAnalysis.forEach(q => {
      if (!catMap[q.category]) catMap[q.category] = { total: 0, count: 0 }
      catMap[q.category].total += q.avg
      catMap[q.category].count++
    })
    const categories = Object.entries(catMap).map(([cat, v]) => ({
      category: cat,
      avg: Math.round((v.total / v.count) * 10) / 10,
    })).sort((a, b) => a.avg - b.avg)

    const overallAvg = responses.filter(r => r.overall_score).length
      ? Math.round((responses.filter(r => r.overall_score).reduce((s, r) => s + r.overall_score, 0) / responses.filter(r => r.overall_score).length) * 10) / 10
      : 0

    return { qAnalysis, enps, categories, overallAvg, responseCount: responses.length }
  }, [selectedSurvey, responses])

  // Stats
  const stats = useMemo(() => {
    const active = surveys.filter(s => s.status === '進行中').length
    const total = surveys.length
    const draft = surveys.filter(s => s.status === '草稿').length
    const closed = surveys.filter(s => s.status === '已結束').length
    return { active, total, draft, closed }
  }, [surveys])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💬</span> 員工滿意度調查</h2>
            <p>脈搏調查、eNPS 追蹤、匿名回饋分析</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => { setSurveyForm(EMPTY_SURVEY); setEditingId(null); setShowModal(true) }}>
              <Plus size={14} /> 建立問卷
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
          <div className="stat-card-label">進行中</div>
          <div className="stat-card-value">{stats.active}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--text-muted)', '--card-accent-dim': 'var(--bg-secondary)' }}>
          <div className="stat-card-label">草稿</div>
          <div className="stat-card-value">{stats.draft}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'rgba(16,185,129,0.12)' }}>
          <div className="stat-card-label">已結束</div>
          <div className="stat-card-value">{stats.closed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'rgba(139,92,246,0.12)' }}>
          <div className="stat-card-label">問卷總數</div>
          <div className="stat-card-value">{stats.total}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {[['list', '📋 問卷列表'], ['results', '📊 分析結果']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            background: tab === key ? 'var(--accent-cyan)' : 'transparent',
            color: tab === key ? '#fff' : 'var(--text-muted)',
          }}>{label}</button>
        ))}
      </div>

      {/* Survey List */}
      {tab === 'list' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📋</span> 問卷管理</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>標題</th>
                  <th>狀態</th>
                  <th>匿名</th>
                  <th>開始日期</th>
                  <th>結束日期</th>
                  <th>題數</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {surveys.map(s => {
                  const st = STATUS_MAP[s.status] || STATUS_MAP['草稿']
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.title}</td>
                      <td>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                          {s.status}
                        </span>
                      </td>
                      <td>{s.is_anonymous ? '✅' : '❌'}</td>
                      <td>{s.start_date || '-'}</td>
                      <td>{s.end_date || '-'}</td>
                      <td>{(s.questions || []).length}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {s.status === '草稿' && (
                            <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handlePublish(s.id)}>
                              <Send size={12} /> 發布
                            </button>
                          )}
                          {s.status === '進行中' && (
                            <>
                              <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handleOpenFill(s)}>
                                <Edit2 size={12} /> 填寫
                              </button>
                              <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handleClose(s.id)}>
                                結束
                              </button>
                            </>
                          )}
                          <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => handleViewResults(s)}>
                            <BarChart2 size={12} /> 結果
                          </button>
                          {s.status === '草稿' && (
                            <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--accent-red)' }} onClick={() => handleDelete(s.id)}>
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {surveys.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>尚無問卷，點擊「建立問卷」開始</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analysis Results */}
      {tab === 'results' && analysis && (
        <div>
          {/* Summary cards */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
              <div className="stat-card-label">整體滿意度</div>
              <div className="stat-card-value">{analysis.overallAvg} / 5</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': analysis.enps !== null && analysis.enps >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', '--card-accent-dim': analysis.enps !== null && analysis.enps >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)' }}>
              <div className="stat-card-label">eNPS 分數</div>
              <div className="stat-card-value">{analysis.enps !== null ? analysis.enps : '-'}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'rgba(139,92,246,0.12)' }}>
              <div className="stat-card-label">回覆數</div>
              <div className="stat-card-value">{analysis.responseCount}</div>
            </div>
          </div>

          {/* AI Insights */}
          {aiReady() && (
            <div className="card" style={{ marginBottom: 20, border: aiInsights ? '1px solid rgba(6,182,212,0.3)' : undefined }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-title"><span className="card-title-icon"><Sparkles size={16} /></span> AI 洞察分析</div>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={aiLoading}
                  onClick={async () => {
                    setAiLoading(true)
                    try {
                      const textQuestions = (selectedSurvey?.questions || []).filter(q => q.type === 'text')
                      const textResponses = textQuestions.map(q => ({
                        question: q.text,
                        answers: responses.map(r => r.answers?.[q.id]).filter(Boolean),
                      })).filter(tr => tr.answers.length > 0)
                      const result = await generateSurveyInsights({ ...analysis, title: selectedSurvey?.title, questions: selectedSurvey?.questions, textResponses })
                      setAiInsights(result)
                    } catch (err) { alert('AI 分析失敗：' + err.message) }
                    finally { setAiLoading(false) }
                  }}>
                  <Sparkles size={12} /> {aiLoading ? '分析中...' : aiInsights ? '重新分析' : '產生 AI 洞察'}
                </button>
              </div>
              {aiInsights && (
                <div style={{ padding: 16 }}>
                  {/* Executive summary */}
                  <div style={{ padding: '12px 16px', background: 'rgba(6,182,212,0.06)', borderRadius: 8, marginBottom: 16, fontSize: 14, lineHeight: 1.6, borderLeft: '3px solid var(--accent-cyan)' }}>
                    {aiInsights.executive_summary}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    {/* Strengths */}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--accent-green)' }}>優勢</div>
                      {(aiInsights.strengths || []).map((s, i) => (
                        <div key={i} style={{ fontSize: 13, marginBottom: 4, paddingLeft: 12, borderLeft: '2px solid var(--accent-green)' }}>{s}</div>
                      ))}
                    </div>
                    {/* Concerns */}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--accent-orange)' }}>待關注</div>
                      {(aiInsights.concerns || []).map((c, i) => (
                        <div key={i} style={{ fontSize: 13, marginBottom: 4, paddingLeft: 12, borderLeft: '2px solid var(--accent-orange)' }}>{c}</div>
                      ))}
                    </div>
                  </div>
                  {/* Themes from free text */}
                  {(aiInsights.themes || []).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>回饋主題</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {aiInsights.themes.map((t, i) => (
                          <span key={i} style={{ padding: '4px 12px', borderRadius: 14, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Action items */}
                  {(aiInsights.action_items || []).length > 0 && (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>行動建議</div>
                      {aiInsights.action_items.map((a, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                            color: a.priority === 'high' ? 'var(--accent-red)' : a.priority === 'medium' ? 'var(--accent-orange)' : 'var(--accent-green)',
                            background: a.priority === 'high' ? 'rgba(239,68,68,0.12)' : a.priority === 'medium' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                          }}>
                            {a.priority === 'high' ? '高' : a.priority === 'medium' ? '中' : '低'}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{a.area}：{a.action}</div>
                            {a.expected_impact && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{a.expected_impact}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* eNPS interpretation */}
                  {aiInsights.enps_interpretation && (
                    <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <strong>eNPS 解讀：</strong> {aiInsights.enps_interpretation}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Category breakdown */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📊</span> 維度分析 — {selectedSurvey?.title}</div>
            </div>
            <div style={{ padding: 16 }}>
              {analysis.categories.map(cat => (
                <div key={cat.category} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <span style={{ width: 80, fontSize: 13, fontWeight: 500, textAlign: 'right' }}>{cat.category}</span>
                  <div style={{ flex: 1, height: 20, borderRadius: 6, background: 'var(--border-subtle)', overflow: 'hidden', position: 'relative' }}>
                    <div style={{
                      width: `${(cat.avg / 5) * 100}%`, height: '100%', borderRadius: 6,
                      background: cat.avg >= 4 ? 'var(--accent-green)' : cat.avg >= 3 ? 'var(--accent-cyan)' : cat.avg >= 2 ? 'var(--accent-orange)' : 'var(--accent-red)',
                    }} />
                    <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: '#fff', mixBlendMode: 'difference' }}>
                      {cat.avg}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-question breakdown */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📝</span> 逐題分析</div>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>題目</th>
                    <th>類別</th>
                    <th>平均分</th>
                    <th>回覆數</th>
                    <th>分佈</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.qAnalysis.map((q, i) => (
                    <tr key={q.id}>
                      <td>{i + 1}</td>
                      <td style={{ maxWidth: 300 }}>{q.text}</td>
                      <td><span className="badge badge-info">{q.category}</span></td>
                      <td style={{ fontWeight: 600, color: q.avg >= 4 ? 'var(--accent-green)' : q.avg >= 3 ? 'var(--accent-cyan)' : 'var(--accent-red)' }}>
                        {q.avg}
                      </td>
                      <td>{q.count}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 2, alignItems: 'end', height: 24 }}>
                          {q.dist.map((count, idx) => (
                            <div key={idx} style={{
                              width: 14, height: q.count ? `${Math.max((count / q.count) * 24, 2)}px` : 2,
                              background: idx <= 1 ? 'var(--accent-red)' : idx === 2 ? 'var(--accent-orange)' : 'var(--accent-green)',
                              borderRadius: 2, title: `${idx + 1}分: ${count}人`,
                            }} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Free text responses */}
          {(selectedSurvey?.questions || []).filter(q => q.type === 'text').map(q => {
            const textResponses = responses.map(r => r.answers?.[q.id]).filter(Boolean)
            if (!textResponses.length) return null
            return (
              <div className="card" key={q.id} style={{ marginTop: 16 }}>
                <div className="card-header">
                  <div className="card-title"><span className="card-title-icon">💬</span> {q.text}</div>
                </div>
                <div style={{ padding: 16 }}>
                  {textResponses.map((t, i) => (
                    <div key={i} style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, borderLeft: '3px solid var(--accent-cyan)' }}>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'results' && !analysis && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          請從問卷列表點擊「結果」查看分析
        </div>
      )}

      {/* Create/Edit Survey Modal */}
      {showModal && (
        <Modal title={editingId ? '編輯問卷' : '建立問卷'} onClose={() => { setShowModal(false); setEditingId(null) }} onSubmit={handleCreateSurvey}>
          <Field label="問卷標題 *">
            <input className="form-input" style={{ width: '100%' }} value={surveyForm.title} onChange={e => setS('title', e.target.value)} placeholder="例：2026 Q2 員工脈搏調查" />
          </Field>
          <Field label="說明">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={surveyForm.description} onChange={e => setS('description', e.target.value)} placeholder="問卷目的說明..." />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="開始日期">
              <input type="date" className="form-input" style={{ width: '100%' }} value={surveyForm.start_date} onChange={e => setS('start_date', e.target.value)} />
            </Field>
            <Field label="結束日期">
              <input type="date" className="form-input" style={{ width: '100%' }} value={surveyForm.end_date} onChange={e => setS('end_date', e.target.value)} />
            </Field>
            <Field label="匿名">
              <select className="form-input" style={{ width: '100%' }} value={surveyForm.is_anonymous ? 'yes' : 'no'} onChange={e => setS('is_anonymous', e.target.value === 'yes')}>
                <option value="yes">匿名</option>
                <option value="no">具名</option>
              </select>
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>題目（{surveyForm.questions.length} 題）</div>
            {surveyForm.questions.map((q, idx) => (
              <div key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 20 }}>{idx + 1}.</span>
                <span style={{ flex: 1, fontSize: 13 }}>{q.text}</span>
                <span className="badge badge-info" style={{ fontSize: 11 }}>{q.category}</span>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}
                  onClick={() => setS('questions', surveyForm.questions.filter((_, i) => i !== idx))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button className="btn btn-secondary" style={{ fontSize: 12, marginTop: 4 }}
              onClick={() => setS('questions', [...surveyForm.questions, { id: Date.now(), text: '', type: 'rating', category: '' }])}>
              <Plus size={12} /> 新增題目
            </button>
          </div>
        </Modal>
      )}

      {/* Fill Survey Modal */}
      {showFillModal && selectedSurvey && (
        <Modal title={`填寫：${selectedSurvey.title}`} onClose={() => setShowFillModal(false)} onSubmit={handleSubmitResponse}>
          {!selectedSurvey.is_anonymous && (
            <Field label="員工 *">
              <select className="form-input" style={{ width: '100%' }} value={fillEmployee} onChange={e => setFillEmployee(e.target.value)}>
                <option value="">選擇員工</option>
                {employees.map(e => <option key={e.id} value={e.name}>{empLabel(e)} ({e.dept})</option>)}
              </select>
            </Field>
          )}
          {(selectedSurvey.questions || []).map((q, idx) => (
            <Field key={q.id} label={`${idx + 1}. ${q.text}`}>
              {q.type === 'rating' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  {[1, 2, 3, 4, 5].map(v => (
                    <button key={v} onClick={() => setFillForm(f => ({ ...f, [q.id]: v }))}
                      style={{
                        width: 36, height: 36, borderRadius: '50%', border: '2px solid',
                        borderColor: fillForm[q.id] === v ? 'var(--accent-cyan)' : 'var(--border-medium)',
                        background: fillForm[q.id] === v ? 'var(--accent-cyan)' : 'transparent',
                        color: fillForm[q.id] === v ? '#fff' : 'var(--text-primary)',
                        cursor: 'pointer', fontWeight: 600, fontSize: 14,
                      }}>
                      {v}
                    </button>
                  ))}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 8 }}>
                    1=非常不同意 5=非常同意
                  </span>
                </div>
              ) : (
                <textarea className="form-input" style={{ width: '100%', minHeight: 60 }}
                  value={fillForm[q.id] || ''} onChange={e => setFillForm(f => ({ ...f, [q.id]: e.target.value }))}
                  placeholder="請填寫您的想法..." />
              )}
            </Field>
          ))}
        </Modal>
      )}
    </div>
  )
}
