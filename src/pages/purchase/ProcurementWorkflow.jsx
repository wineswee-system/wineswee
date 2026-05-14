import React, { useState, useEffect } from 'react'
import { Plus, Search, ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, AlertTriangle, ArrowRight, User, Play, Pause } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const WORKFLOW_STATUSES = ['啟用中', '草稿', '已停用']
const APPROVAL_TYPES = ['線性審批', '會簽', '或簽']
const TRIGGER_EVENTS = ['採購申請建立', '採購單建立', '金額超過門檻', '供應商變更', '驗收完成']

const STATUS_BADGE = {
  '啟用中': 'badge-success',
  '草稿': 'badge-warning',
  '已停用': 'badge-danger',
}

const INSTANCE_STATUS_BADGE = {
  '進行中': 'badge-info',
  '已完成': 'badge-success',
  '已駁回': 'badge-danger',
  '已取消': 'badge-warning',
}

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

export default function ProcurementWorkflow() {
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('workflows')
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState(null)

  const emptyForm = {
    name: '', description: '', status: '草稿', trigger_event: '採購申請建立',
    approval_type: '線性審批', amount_threshold: '', steps: [{ role: '', approver: '', condition: '' }],
  }
  const [form, setForm] = useState({ ...emptyForm })

  useEffect(() => {
    Promise.all([
      supabase.from('procurement_workflows').select('*').order('created_at', { ascending: false }),
      supabase.from('procurement_workflow_instances').select('*').order('created_at', { ascending: false }),
    ]).then(([w, i]) => {
      setWorkflows(w.data || [])
      setInstances(i.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const updateStep = (idx, key, value) => {
    setForm(f => {
      const steps = [...f.steps]
      steps[idx] = { ...steps[idx], [key]: value }
      return { ...f, steps }
    })
  }
  const addStep = () => setForm(f => ({ ...f, steps: [...f.steps, { role: '', approver: '', condition: '' }] }))
  const removeStep = (idx) => {
    if (form.steps.length <= 1) return
    setForm(f => ({ ...f, steps: f.steps.filter((_, i) => i !== idx) }))
  }

  const handleSubmit = async () => {
    if (!form.name) return
    const insertData = {
      name: form.name,
      description: form.description || null,
      status: form.status,
      trigger_event: form.trigger_event,
      approval_type: form.approval_type,
      amount_threshold: Number(form.amount_threshold) || null,
      steps: form.steps.filter(s => s.role || s.approver),
    }
    const { data } = await supabase.from('procurement_workflows').insert(insertData).select().single()
    if (data) {
      setWorkflows(prev => [data, ...prev])
      setShowModal(false)
      setForm({ ...emptyForm })
    }
  }

  const toggleWorkflowStatus = async (wf) => {
    const newStatus = wf.status === '啟用中' ? '已停用' : '啟用中'
    const { data } = await supabase.from('procurement_workflows')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', wf.id).select().single()
    if (data) setWorkflows(prev => prev.map(w => w.id === wf.id ? data : w))
  }

  const approveInstance = async (inst, action) => {
    const newStatus = action === 'approve' ? '已完成' : '已駁回'
    const currentStep = (inst.current_step || 0) + (action === 'approve' ? 1 : 0)
    const wf = workflows.find(w => w.id === inst.workflow_id)
    const totalSteps = wf?.steps?.length || 1
    const finalStatus = action === 'approve' && currentStep >= totalSteps ? '已完成' : (action === 'reject' ? '已駁回' : '進行中')

    const { data } = await supabase.from('procurement_workflow_instances')
      .update({ status: finalStatus, current_step: currentStep, updated_at: new Date().toISOString() })
      .eq('id', inst.id).select().single()
    if (data) setInstances(prev => prev.map(i => i.id === inst.id ? data : i))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filteredWf = workflows.filter(w =>
    search === '' || w.name?.includes(search) || w.trigger_event?.includes(search)
  )
  const filteredInst = instances.filter(i =>
    search === '' || i.reference?.includes(search) || i.requester?.includes(search)
  )

  const activeWf = workflows.filter(w => w.status === '啟用中').length
  const pendingInst = instances.filter(i => i.status === '進行中').length
  const completedInst = instances.filter(i => i.status === '已完成').length
  const rejectedInst = instances.filter(i => i.status === '已駁回').length

  const tabStyle = (active) => ({
    padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
    background: active ? 'var(--accent-cyan)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">{'\u{2699}\u{FE0F}'}</span> 採購工作流程</h2>
            <p>設定採購審批流程與追蹤審批進度</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm({ ...emptyForm }); setShowModal(true) }}>
            <Plus size={14} /> 新增工作流程
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用中流程</div>
          <div className="stat-card-value">{activeWf}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">待審批</div>
          <div className="stat-card-value">{pendingInst}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">已完成</div>
          <div className="stat-card-value">{completedInst}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已駁回</div>
          <div className="stat-card-value">{rejectedInst}</div>
        </div>
      </div>

      {/* Tabs + Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
          <button onClick={() => setTab('workflows')} style={tabStyle(tab === 'workflows')}>{'\u{1F4D0}'} 流程範本</button>
          <button onClick={() => setTab('instances')} style={tabStyle(tab === 'instances')}>{'\u{1F4CB}'} 審批紀錄</button>
        </div>
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <Search className="search-icon" />
          <input type="text" placeholder="搜尋..." className="form-input" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Workflows Tab */}
      {tab === 'workflows' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">{'\u{1F504}'}</span> 流程範本</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>流程名稱</th>
                  <th>觸發事件</th>
                  <th>審批類型</th>
                  <th>金額門檻</th>
                  <th>審批步驟</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredWf.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無工作流程</td></tr>
                )}
                {filteredWf.map(wf => {
                  const isExpanded = expandedRow === wf.id
                  const steps = wf.steps || []
                  return (
                    <React.Fragment key={wf.id}>
                      <tr>
                        <td>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                            onClick={() => setExpandedRow(isExpanded ? null : wf.id)}>
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td style={{ fontWeight: 600 }}>{wf.name}</td>
                        <td><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 500 }}>{wf.trigger_event}</span></td>
                        <td>{wf.approval_type}</td>
                        <td>{wf.amount_threshold ? fmt(wf.amount_threshold) : '-'}</td>
                        <td>{steps.length} 步</td>
                        <td><span className={`badge ${STATUS_BADGE[wf.status] || 'badge-info'}`}><span className="badge-dot"></span>{wf.status}</span></td>
                        <td>
                          <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }}
                            onClick={() => toggleWorkflowStatus(wf)}>
                            {wf.status === '啟用中' ? <><Pause size={12} /> 停用</> : <><Play size={12} /> 啟用</>}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--bg-tertiary)', padding: '16px 24px' }}>
                            {wf.description && <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>{wf.description}</p>}
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>審批步驟流程：</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {steps.map((step, idx) => (
                                <React.Fragment key={idx}>
                                  <div style={{
                                    padding: '8px 16px', borderRadius: 8, background: 'var(--bg-card)',
                                    border: '1px solid var(--border-medium)', fontSize: 12,
                                  }}>
                                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{step.role || `步驟 ${idx + 1}`}</div>
                                    {step.approver && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}><User size={10} /> {step.approver}</div>}
                                    {step.condition && <div style={{ color: 'var(--accent-orange)', fontSize: 10, marginTop: 2 }}>{step.condition}</div>}
                                  </div>
                                  {idx < steps.length - 1 && <ArrowRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                                </React.Fragment>
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
      )}

      {/* Instances Tab */}
      {tab === 'instances' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">{'\u{1F4CB}'}</span> 審批紀錄</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>參考編號</th>
                  <th>流程名稱</th>
                  <th>申請人</th>
                  <th>金額</th>
                  <th>目前步驟</th>
                  <th>進度</th>
                  <th>狀態</th>
                  <th>建立日期</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredInst.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無審批紀錄</td></tr>
                )}
                {filteredInst.map(inst => {
                  const wf = workflows.find(w => w.id === inst.workflow_id)
                  const totalSteps = wf?.steps?.length || 1
                  const currentStep = inst.current_step || 0
                  const progress = Math.round((currentStep / totalSteps) * 100)
                  return (
                    <tr key={inst.id}>
                      <td style={{ fontWeight: 600 }}>{inst.reference || `WF-${inst.id}`}</td>
                      <td>{wf?.name || '-'}</td>
                      <td>{inst.requester || '-'}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(inst.amount)}</td>
                      <td style={{ fontSize: 12 }}>
                        {wf?.steps?.[currentStep]?.role || `步驟 ${currentStep + 1}`}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${progress}%`, height: '100%', background: inst.status === '已駁回' ? 'var(--accent-red)' : 'var(--accent-green)', borderRadius: 3, transition: 'width 0.3s ease' }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{currentStep}/{totalSteps}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${INSTANCE_STATUS_BADGE[inst.status] || 'badge-info'}`}>
                          <span className="badge-dot"></span>{inst.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{inst.created_at ? new Date(inst.created_at).toLocaleDateString() : '-'}</td>
                      <td>
                        {inst.status === '進行中' && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn" style={{ fontSize: 11, padding: '4px 8px', color: 'var(--accent-green)' }}
                              onClick={() => approveInstance(inst, 'approve')}>
                              <CheckCircle size={12} /> 核准
                            </button>
                            <button className="btn" style={{ fontSize: 11, padding: '4px 8px', color: 'var(--accent-red)' }}
                              onClick={() => approveInstance(inst, 'reject')}>
                              <XCircle size={12} /> 駁回
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Workflow Modal */}
      {showModal && (
        <Modal title="新增工作流程" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="流程名稱" required>
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：大額採購審批" />
            </Field>
            <Field label="狀態">
              <select className="form-input" value={form.status} onChange={e => set('status', e.target.value)}>
                {WORKFLOW_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="觸發事件">
              <select className="form-input" value={form.trigger_event} onChange={e => set('trigger_event', e.target.value)}>
                {TRIGGER_EVENTS.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="審批類型">
              <select className="form-input" value={form.approval_type} onChange={e => set('approval_type', e.target.value)}>
                {APPROVAL_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="金額門檻">
              <input className="form-input" type="number" value={form.amount_threshold} onChange={e => set('amount_threshold', e.target.value)} placeholder="超過此金額觸發（選填）" />
            </Field>
          </div>
          <Field label="說明">
            <textarea className="form-input" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="流程說明..." />
          </Field>

          {/* Approval Steps */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>審批步驟</div>
              <button type="button" className="btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={addStep}>
                <Plus size={12} /> 新增步驟
              </button>
            </div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>步驟</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>角色/職位</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>審批人</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>條件</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {form.steps.map((step, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--accent-cyan)' }}>{idx + 1}</td>
                    <td style={{ padding: '6px 4px' }}>
                      <input className="form-input" style={{ fontSize: 12, padding: '4px 8px' }}
                        value={step.role} onChange={e => updateStep(idx, 'role', e.target.value)} placeholder="例：部門主管" />
                    </td>
                    <td style={{ padding: '6px 4px' }}>
                      <input className="form-input" style={{ fontSize: 12, padding: '4px 8px' }}
                        value={step.approver} onChange={e => updateStep(idx, 'approver', e.target.value)} placeholder="審批人姓名" />
                    </td>
                    <td style={{ padding: '6px 4px' }}>
                      <input className="form-input" style={{ fontSize: 12, padding: '4px 8px' }}
                        value={step.condition} onChange={e => updateStep(idx, 'condition', e.target.value)} placeholder="選填條件" />
                    </td>
                    <td style={{ padding: '6px 4px' }}>
                      {form.steps.length > 1 && (
                        <button type="button" onClick={() => removeStep(idx)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 14, padding: 0 }}>
                          &times;
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  )
}
