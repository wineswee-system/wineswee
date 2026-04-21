import React, { useState, useEffect } from 'react'
import { Workflow, ListChecks, CheckSquare, TrendingUp, Clock, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import { getWorkflows, getWorkflowInstances, getTasks, getChecklists } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { advanceWorkflow } from '../../lib/workflowIntegration'
import { checkAndNotifyDueTasks } from '../../lib/taskDueChecker'
import LoadingSpinner from '../../components/LoadingSpinner'

const STATUS_CONFIG = {
  '進行中': { color: 'var(--accent-cyan)', icon: Clock, badge: 'badge-info' },
  '已完成': { color: 'var(--accent-green)', icon: CheckCircle, badge: 'badge-success' },
  '已退回': { color: 'var(--accent-red)', icon: XCircle, badge: 'badge-danger' },
}

export default function ProcessOverview() {
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [steps, setSteps] = useState([])
  const [tasks, setTasks] = useState([])
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      getWorkflowInstances(),
      supabase.from('workflow_steps').select('*').order('step_order'),
      getTasks(),
      getChecklists(),
    ]).then(([w, inst, st, t, c]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
      setTasks(t.data || [])
      setChecklists(c.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
      // 每次 session 自動檢查今天到期的任務，發 LINE 提醒
      checkAndNotifyDueTasks().catch(() => {})
    })
  }, [])

  const reload = () => {
    setLoading(true)
    Promise.all([
      getWorkflows(), getWorkflowInstances(),
      supabase.from('workflow_steps').select('*').order('step_order'),
      getTasks(), getChecklists(),
    ]).then(([w, inst, st, t, c]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
      setTasks(t.data || [])
      setChecklists(c.data || [])
    }).finally(() => setLoading(false))
  }

  const handleApprove = async (stepId) => {
    setActionLoading(true)
    await advanceWorkflow(stepId, '主管', '核准')
    reload()
    setActionLoading(false)
  }

  const handleReject = async (stepId) => {
    const reason = prompt('請輸入退回原因：')
    if (!reason?.trim()) return
    setActionLoading(true)
    await advanceWorkflow(stepId, '主管', '退回', reason.trim())
    reload()
    setActionLoading(false)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const activeInstances = instances.filter(i => i.status === '進行中')
  const completedInstances = instances.filter(i => i.status === '已完成')
  const rejectedInstances = instances.filter(i => i.status === '已退回')
  const pendingSteps = steps.filter(s => s.status === '待處理')
  const completedTasks = tasks.filter(t => t.status === '已完成').length
  const checklistProgress = checklists.reduce((s, c) => s + (c.completed || 0), 0)
  const checklistTotal = checklists.reduce((s, c) => s + (c.items || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">👁️</span> 流程總覽</h2>
        <p>所有簽核流程、任務與查核清單的即時狀態</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-icon"><Workflow size={16} /></div>
          <div className="stat-card-label">進行中簽核</div>
          <div className="stat-card-value">{activeInstances.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-icon"><AlertCircle size={16} /></div>
          <div className="stat-card-label">待處理步驟</div>
          <div className="stat-card-value">{pendingSteps.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-icon"><CheckCircle size={16} /></div>
          <div className="stat-card-label">已完成簽核</div>
          <div className="stat-card-value">{completedInstances.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-icon"><TrendingUp size={16} /></div>
          <div className="stat-card-label">任務完成率</div>
          <div className="stat-card-value">{tasks.length ? Math.round(completedTasks / tasks.length * 100) : 0}%</div>
        </div>
      </div>

      {/* 簽核流程實例（從 HR 產生的） */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 簽核流程</div>
          <span className="badge badge-neutral">{instances.length} 筆</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>流程名稱</th><th>申請人</th><th>審核人</th><th>開始時間</th><th>狀態</th><th>進度</th></tr></thead>
            <tbody>
              {instances.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                  尚無簽核流程 — 當員工提交請假/加班/報帳/出差/採購時會自動產生
                </td></tr>
              ) : instances.map(inst => {
                const instSteps = steps.filter(s => s.instance_id === inst.id)
                const completed = instSteps.filter(s => s.status === '已完成').length
                const total = instSteps.length
                const cfg = STATUS_CONFIG[inst.status] || STATUS_CONFIG['進行中']
                const isExpanded = expandedId === inst.id
                const currentStep = instSteps.find(s => s.status === '待處理')
                return (
                  <React.Fragment key={inst.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : inst.id)}>
                      <td style={{ fontWeight: 600 }}>
                        {isExpanded ? <ChevronUp size={14} style={{ marginRight: 4 }} /> : <ChevronDown size={14} style={{ marginRight: 4 }} />}
                        {inst.template_name}
                      </td>
                      <td>{inst.started_by || '-'}</td>
                      <td>{currentStep?.assignee || inst.assignee || '-'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.started_at?.slice(0, 10)}</td>
                      <td><span className={`badge ${cfg.badge}`}><span className="badge-dot"></span>{inst.status}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--border)' }}>
                            <div style={{ height: '100%', borderRadius: 3, width: `${total ? (completed / total * 100) : 0}%`, background: cfg.color, transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{completed}/{total}</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0 16px 16px', background: 'var(--glass-light)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
                            {instSteps.map(s => (
                              <div key={s.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                                borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                              }}>
                                <div style={{
                                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: s.status === '已完成' ? 'var(--accent-green)' : s.status === '已退回' ? 'var(--accent-red)' : 'var(--border-medium)',
                                  color: '#fff', fontSize: 12, fontWeight: 700,
                                }}>{s.step_order}</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    {s.assignee || '未指派'} · {s.role || '-'}
                                    {s.confirmed_by && ` · ${s.confirmed_by} ${s.confirmed_at?.slice(0, 10) || ''}`}
                                    {s.notes && ` · ${s.notes}`}
                                  </div>
                                </div>
                                <span className={`badge ${s.status === '已完成' ? 'badge-success' : s.status === '已退回' ? 'badge-danger' : 'badge-warning'}`}>
                                  <span className="badge-dot"></span>{s.status}
                                </span>
                                {s.status === '待處理' && inst.status === '進行中' && (
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <button className="btn btn-sm btn-primary" disabled={actionLoading}
                                      onClick={e => { e.stopPropagation(); handleApprove(s.id) }}>
                                      <Check size={12} /> 核准
                                    </button>
                                    <button className="btn btn-sm" style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}
                                      disabled={actionLoading}
                                      onClick={e => { e.stopPropagation(); handleReject(s.id) }}>
                                      <X size={12} /> 退回
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        {/* 流程模板 */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔄</span> 流程模板</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>流程名稱</th><th>步驟數</th><th>狀態</th></tr></thead>
              <tbody>
                {workflows.length === 0 ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無流程模板</td></tr>
                ) : workflows.map(w => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td>{w.steps}</td>
                    <td><span className={`badge ${w.status === '已啟用' ? 'badge-success' : 'badge-warning'}`}><span className="badge-dot"></span>{w.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 查核清單 */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">✅</span> 查核清單進度</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {checklists.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>尚無查核清單</div>
            ) : checklists.map(c => {
              const pct = c.items ? Math.round((c.completed || 0) / c.items * 100) : 0
              return (
                <div key={c.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.completed || 0}/{c.items || 0}</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--accent-green)' : pct > 50 ? 'var(--accent-cyan)' : 'var(--accent-orange)' }}></div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{c.assignee} · {c.category}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
