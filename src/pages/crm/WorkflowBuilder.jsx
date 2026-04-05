import { useState } from 'react'
import { Zap, Play, Pause, Plus, Trash2, Settings, ChevronDown, ChevronRight, Copy, ArrowDown } from 'lucide-react'
import Modal, { Field } from '../../components/Modal'
import LoadingSpinner from '../../components/LoadingSpinner'
import { WORKFLOW_TRIGGERS, WORKFLOW_ACTIONS, createWorkflow } from '../../lib/crmEngine'

// --- Action config field definitions ---
const ACTION_CONFIG_FIELDS = {
  send_email: [
    { key: 'to', label: '收件人', type: 'text', placeholder: '{{contact.email}}' },
    { key: 'subject', label: '主旨', type: 'text', placeholder: '歡迎加入！' },
    { key: 'body', label: '內容', type: 'textarea', placeholder: '親愛的 {{contact.name}}...' },
  ],
  send_line: [
    { key: 'to', label: '接收者', type: 'text', placeholder: '{{contact.line_id}}' },
    { key: 'message', label: '訊息', type: 'textarea', placeholder: '您好...' },
  ],
  send_sms: [
    { key: 'to', label: '手機號碼', type: 'text', placeholder: '{{contact.phone}}' },
    { key: 'message', label: '訊息', type: 'textarea', placeholder: '簡訊內容...' },
  ],
  create_task: [
    { key: 'title', label: '任務名稱', type: 'text', placeholder: '跟進客戶' },
    { key: 'assignee', label: '負責人', type: 'text', placeholder: '業務A' },
    { key: 'due_days', label: '期限(天)', type: 'number', placeholder: '3' },
  ],
  assign_to: [
    { key: 'person', label: '指派給', type: 'select', options: ['業務主管', '資深客服', '業務A', '業務B', '客服C'] },
  ],
  update_field: [
    { key: 'field', label: '欄位名稱', type: 'text', placeholder: 'status' },
    { key: 'value', label: '新值', type: 'text', placeholder: 'VIP' },
  ],
  add_tag: [
    { key: 'tag', label: '標籤名稱', type: 'text', placeholder: 'VIP' },
  ],
  create_deal: [
    { key: 'name', label: '商機名稱', type: 'text', placeholder: '自動建立商機' },
    { key: 'amount', label: '金額', type: 'number', placeholder: '0' },
    { key: 'stage', label: '階段', type: 'text', placeholder: '初步接觸' },
  ],
  create_ticket: [
    { key: 'subject', label: '工單主旨', type: 'text', placeholder: '客戶問題' },
    { key: 'priority', label: '優先級', type: 'select', options: ['低', '一般', '高', '緊急'] },
  ],
  add_points: [
    { key: 'points', label: '點數', type: 'number', placeholder: '100' },
    { key: 'reason', label: '原因', type: 'text', placeholder: '歡迎獎勵' },
  ],
  wait: [
    { key: 'duration', label: '等待時間', type: 'number', placeholder: '1' },
    { key: 'unit', label: '單位', type: 'select', options: ['小時', '天', '週'] },
  ],
  condition: [
    { key: 'field', label: '欄位', type: 'text', placeholder: 'total_spent' },
    { key: 'operator', label: '運算子', type: 'select', options: ['等於', '不等於', '大於', '小於', '包含'] },
    { key: 'value', label: '值', type: 'text', placeholder: '10000' },
  ],
  webhook: [
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
    { key: 'method', label: '方法', type: 'select', options: ['POST', 'GET', 'PUT'] },
  ],
  notify: [
    { key: 'message', label: '通知內容', type: 'text', placeholder: '有新的事件需要處理' },
    { key: 'recipients', label: '通知對象', type: 'text', placeholder: '業務主管' },
  ],
}

// --- Action colors ---
const ACTION_COLORS = {
  send_email: 'var(--accent-blue)',
  send_line: 'var(--accent-green)',
  send_sms: 'var(--accent-cyan)',
  create_task: 'var(--accent-orange)',
  assign_to: 'var(--accent-purple)',
  update_field: 'var(--accent-cyan)',
  add_tag: 'var(--accent-yellow, #f59e0b)',
  create_deal: 'var(--accent-green)',
  create_ticket: 'var(--accent-red)',
  add_points: 'var(--accent-orange)',
  wait: 'var(--accent-purple)',
  condition: 'var(--accent-red)',
  webhook: 'var(--accent-cyan)',
  notify: 'var(--accent-blue)',
}

// --- Demo templates ---
const TEMPLATES = [
  {
    name: '新客戶歡迎',
    description: '新聯絡人建立後自動發送歡迎信、等待後建立跟進任務',
    trigger: 'contact_created',
    steps: [
      { id: 's1', action: 'send_email', config: { to: '{{contact.email}}', subject: '歡迎加入！', body: '親愛的 {{contact.name}}，歡迎成為我們的客戶！' } },
      { id: 's2', action: 'wait', config: { duration: '1', unit: '天' } },
      { id: 's3', action: 'create_task', config: { title: '跟進新客戶', assignee: '業務A', due_days: '3' } },
    ],
  },
  {
    name: 'SLA 逾期通知',
    description: '工單 SLA 逾期後通知主管並指派給資深客服',
    trigger: 'ticket_sla_breached',
    steps: [
      { id: 's1', action: 'notify', config: { message: '工單 SLA 已逾期，請立即處理', recipients: '業務主管' } },
      { id: 's2', action: 'assign_to', config: { person: '資深客服' } },
    ],
  },
  {
    name: '贏單後續',
    description: '商機贏單後自動感謝信、贈送點數並建立 onboard 任務',
    trigger: 'deal_won',
    steps: [
      { id: 's1', action: 'send_email', config: { to: '{{contact.email}}', subject: '感謝您的訂單！', body: '感謝您選擇我們，我們會盡快為您安排後續事宜。' } },
      { id: 's2', action: 'add_points', config: { points: '500', reason: '贏單獎勵' } },
      { id: 's3', action: 'create_task', config: { title: '客戶 Onboard 流程', assignee: '業務A', due_days: '5' } },
    ],
  },
]

// --- Demo saved workflows ---
const INITIAL_WORKFLOWS = [
  createWorkflow({ id: 'WF-001', name: '新客戶歡迎流程', description: '自動歡迎新聯絡人', trigger: 'contact_created', status: 'active', steps: TEMPLATES[0].steps }),
  createWorkflow({ id: 'WF-002', name: 'SLA 逾期自動指派', description: '逾期工單自動通知與指派', trigger: 'ticket_sla_breached', status: 'active', steps: TEMPLATES[1].steps }),
  createWorkflow({ id: 'WF-003', name: '贏單感謝流程', description: '自動發送感謝信與建立後續任務', trigger: 'deal_won', status: 'paused', steps: TEMPLATES[2].steps }),
  createWorkflow({ id: 'WF-004', name: '潛客養成流程', description: '草稿中', trigger: 'form_submitted', status: 'draft', steps: [] }),
]
INITIAL_WORKFLOWS[0].executions = 47
INITIAL_WORKFLOWS[1].executions = 12
INITIAL_WORKFLOWS[2].executions = 23
INITIAL_WORKFLOWS[3].executions = 0

// --- Demo execution log ---
const INITIAL_LOGS = [
  { id: 'L1', timestamp: '2026-04-05 09:15:00', workflow: '新客戶歡迎流程', trigger: '新聯絡人建立', stepsExecuted: 3, status: '成功' },
  { id: 'L2', timestamp: '2026-04-05 08:42:00', workflow: 'SLA 逾期自動指派', trigger: '工單 SLA 已逾期', stepsExecuted: 2, status: '成功' },
  { id: 'L3', timestamp: '2026-04-04 17:30:00', workflow: '贏單感謝流程', trigger: '商機贏單', stepsExecuted: 3, status: '成功' },
  { id: 'L4', timestamp: '2026-04-04 14:10:00', workflow: '新客戶歡迎流程', trigger: '新聯絡人建立', stepsExecuted: 2, status: '部分失敗' },
  { id: 'L5', timestamp: '2026-04-04 11:05:00', workflow: 'SLA 逾期自動指派', trigger: '工單 SLA 已逾期', stepsExecuted: 2, status: '成功' },
  { id: 'L6', timestamp: '2026-04-03 16:20:00', workflow: '新客戶歡迎流程', trigger: '新聯絡人建立', stepsExecuted: 3, status: '成功' },
  { id: 'L7', timestamp: '2026-04-03 10:45:00', workflow: '贏單感謝流程', trigger: '商機贏單', stepsExecuted: 3, status: '失敗' },
  { id: 'L8', timestamp: '2026-04-02 15:00:00', workflow: '新客戶歡迎流程', trigger: '新聯絡人建立', stepsExecuted: 3, status: '成功' },
]

// --- Helpers ---
const getTriggerLabel = (val) => WORKFLOW_TRIGGERS.find(t => t.value === val)?.label || val
const getActionDef = (val) => WORKFLOW_ACTIONS.find(a => a.value === val) || { value: val, label: val, icon: '?' }
const statusBadge = (status) => {
  const map = {
    draft: { label: '草稿', bg: 'var(--accent-purple)', dim: 'var(--accent-purple-dim, rgba(139,92,246,0.15))' },
    active: { label: '啟用', bg: 'var(--accent-green)', dim: 'var(--accent-green-dim, rgba(34,197,94,0.15))' },
    paused: { label: '暫停', bg: 'var(--accent-orange)', dim: 'var(--accent-orange-dim, rgba(249,115,22,0.15))' },
  }
  const s = map[status] || map.draft
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600,
      background: s.dim, color: s.bg, border: `1px solid ${s.bg}33`,
    }}>{s.label}</span>
  )
}

export default function WorkflowBuilder() {
  const [tab, setTab] = useState('list')
  const [workflows, setWorkflows] = useState(INITIAL_WORKFLOWS)
  const [logs] = useState(INITIAL_LOGS)

  // Builder state
  const [builderName, setBuilderName] = useState('')
  const [builderDesc, setBuilderDesc] = useState('')
  const [builderTrigger, setBuilderTrigger] = useState('contact_created')
  const [builderSteps, setBuilderSteps] = useState([])
  const [editingWorkflowId, setEditingWorkflowId] = useState(null)

  // Modal for adding step
  const [showAddStep, setShowAddStep] = useState(false)
  const [selectedAction, setSelectedAction] = useState(null)
  const [stepConfig, setStepConfig] = useState({})

  // Modal for step config editing
  const [editingStepIdx, setEditingStepIdx] = useState(null)

  // Template modal
  const [showTemplates, setShowTemplates] = useState(false)

  // --- Tab style ---
  const tabStyle = (active) => ({
    padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
    borderBottom: active ? '2px solid var(--accent-cyan)' : '2px solid transparent',
    color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
    background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid',
    borderBottomColor: active ? 'var(--accent-cyan)' : 'transparent',
    transition: 'all 0.15s',
  })

  // --- Workflow CRUD ---
  const toggleStatus = (id) => {
    setWorkflows(prev => prev.map(w => {
      if (w.id !== id) return w
      const next = w.status === 'active' ? 'paused' : 'active'
      return { ...w, status: next }
    }))
  }

  const deleteWorkflow = (id) => {
    if (!confirm('確定要刪除此工作流程？')) return
    setWorkflows(prev => prev.filter(w => w.id !== id))
  }

  const editWorkflow = (wf) => {
    setEditingWorkflowId(wf.id)
    setBuilderName(wf.name)
    setBuilderDesc(wf.description)
    setBuilderTrigger(wf.trigger)
    setBuilderSteps([...wf.steps])
    setTab('builder')
  }

  const resetBuilder = () => {
    setEditingWorkflowId(null)
    setBuilderName('')
    setBuilderDesc('')
    setBuilderTrigger('contact_created')
    setBuilderSteps([])
  }

  const saveWorkflow = () => {
    if (!builderName.trim()) { alert('請輸入流程名稱'); return }
    if (editingWorkflowId) {
      setWorkflows(prev => prev.map(w => w.id === editingWorkflowId
        ? { ...w, name: builderName, description: builderDesc, trigger: builderTrigger, steps: builderSteps }
        : w
      ))
    } else {
      const wf = createWorkflow({
        name: builderName,
        description: builderDesc,
        trigger: builderTrigger,
        steps: builderSteps,
        status: 'draft',
      })
      setWorkflows(prev => [wf, ...prev])
    }
    resetBuilder()
    setTab('list')
  }

  // --- Step management ---
  const addStep = () => {
    if (!selectedAction) return
    const step = {
      id: `s-${Date.now()}`,
      action: selectedAction,
      config: { ...stepConfig },
    }
    if (editingStepIdx !== null) {
      setBuilderSteps(prev => prev.map((s, i) => i === editingStepIdx ? step : s))
      setEditingStepIdx(null)
    } else {
      setBuilderSteps(prev => [...prev, step])
    }
    setShowAddStep(false)
    setSelectedAction(null)
    setStepConfig({})
  }

  const removeStep = (idx) => {
    setBuilderSteps(prev => prev.filter((_, i) => i !== idx))
  }

  const openEditStep = (idx) => {
    const step = builderSteps[idx]
    setSelectedAction(step.action)
    setStepConfig({ ...step.config })
    setEditingStepIdx(idx)
    setShowAddStep(true)
  }

  const applyTemplate = (tpl) => {
    setBuilderName(tpl.name)
    setBuilderDesc(tpl.description)
    setBuilderTrigger(tpl.trigger)
    setBuilderSteps([...tpl.steps])
    setShowTemplates(false)
    setEditingWorkflowId(null)
    setTab('builder')
  }

  // --- Render ---
  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon"><Zap size={22} /></span> 工作流程自動化</h2>
        <p>視覺化建立自動化流程，提升團隊效率</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)', marginBottom: 20 }}>
        <button style={tabStyle(tab === 'list')} onClick={() => setTab('list')}>📋 工作流程</button>
        <button style={tabStyle(tab === 'builder')} onClick={() => { setTab('builder'); if (!editingWorkflowId) resetBuilder() }}>✏️ 建立流程</button>
        <button style={tabStyle(tab === 'logs')} onClick={() => setTab('logs')}>📊 執行紀錄</button>
      </div>

      {/* ======== TAB: Workflow List ======== */}
      {tab === 'list' && (
        <div>
          {/* Stats */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">全部流程</div>
              <div className="stat-card-value">{workflows.length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">啟用中</div>
              <div className="stat-card-value">{workflows.filter(w => w.status === 'active').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">已暫停</div>
              <div className="stat-card-value">{workflows.filter(w => w.status === 'paused').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">總執行次數</div>
              <div className="stat-card-value">{workflows.reduce((s, w) => s + (w.executions || 0), 0)}</div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => { resetBuilder(); setTab('builder') }}>
              <Plus size={14} style={{ marginRight: 4 }} /> 新增流程
            </button>
            <button className="btn btn-secondary" onClick={() => setShowTemplates(true)}>
              <Copy size={14} style={{ marginRight: 4 }} /> 從範本建立
            </button>
          </div>

          {/* Table */}
          <div className="card">
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>流程名稱</th>
                  <th>觸發條件</th>
                  <th>步驟數</th>
                  <th>狀態</th>
                  <th>執行次數</th>
                  <th style={{ width: 140 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map(wf => (
                  <tr key={wf.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{wf.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{wf.description}</div>
                    </td>
                    <td><span style={{ fontSize: 12 }}>{getTriggerLabel(wf.trigger)}</span></td>
                    <td>{wf.steps.length}</td>
                    <td>{statusBadge(wf.status)}</td>
                    <td style={{ fontWeight: 600 }}>{wf.executions}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {wf.status !== 'draft' && (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={() => toggleStatus(wf.id)}
                            title={wf.status === 'active' ? '暫停' : '啟用'}
                          >
                            {wf.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                        )}
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={() => editWorkflow(wf)}
                          title="編輯"
                        >
                          <Settings size={13} />
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-red)' }}
                          onClick={() => deleteWorkflow(wf.id)}
                          title="刪除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {workflows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>尚無工作流程</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ======== TAB: Builder ======== */}
      {tab === 'builder' && (
        <div>
          {/* Workflow meta */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>
                {editingWorkflowId ? '編輯工作流程' : '建立新工作流程'}
              </h3>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>流程名稱 *</label>
                  <input
                    className="form-input"
                    value={builderName}
                    onChange={e => setBuilderName(e.target.value)}
                    placeholder="例：新客戶歡迎流程"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>觸發條件 *</label>
                  <select
                    className="form-input"
                    value={builderTrigger}
                    onChange={e => setBuilderTrigger(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    {WORKFLOW_TRIGGERS.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>描述</label>
                <input
                  className="form-input"
                  value={builderDesc}
                  onChange={e => setBuilderDesc(e.target.value)}
                  placeholder="簡述此流程的用途"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>

          {/* Trigger display */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px',
              background: 'var(--accent-cyan-dim, rgba(6,182,212,0.12))', border: '2px solid var(--accent-cyan)',
              borderRadius: 12, fontWeight: 700, fontSize: 13, color: 'var(--accent-cyan)',
            }}>
              <Zap size={16} /> 觸發：{getTriggerLabel(builderTrigger)}
            </div>
          </div>

          {/* Steps visual flow */}
          {builderSteps.map((step, idx) => {
            const def = getActionDef(step.action)
            const color = ACTION_COLORS[step.action] || 'var(--accent-blue)'
            return (
              <div key={step.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {/* Connector */}
                <div style={{ width: 2, height: 28, background: 'var(--border-medium)' }} />
                <ArrowDown size={14} style={{ color: 'var(--text-muted)', margin: '-4px 0' }} />

                {/* Step card */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
                  background: 'var(--bg-card)', border: `1.5px solid ${color}44`,
                  borderRadius: 10, minWidth: 320, position: 'relative',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, background: `${color}18`,
                  }}>
                    {def.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 6 }}>#{idx + 1}</span>
                      {def.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {Object.entries(step.config || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ') || '未設定'}
                    </div>
                  </div>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                    onClick={() => openEditStep(idx)}
                    title="編輯步驟"
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}
                    onClick={() => removeStep(idx)}
                    title="刪除步驟"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Condition branches hint */}
                {step.action === 'condition' && (
                  <div style={{ display: 'flex', gap: 40, marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--accent-green)' }}>✓ True 分支</span>
                    <span style={{ color: 'var(--accent-red)' }}>✗ False 分支</span>
                  </div>
                )}
              </div>
            )
          })}

          {/* Add step button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: builderSteps.length > 0 ? 0 : 12 }}>
            {builderSteps.length > 0 && (
              <>
                <div style={{ width: 2, height: 28, background: 'var(--border-medium)' }} />
                <ArrowDown size={14} style={{ color: 'var(--text-muted)', margin: '-4px 0' }} />
              </>
            )}
            <button
              className="btn btn-secondary"
              style={{ borderStyle: 'dashed', padding: '10px 28px', fontSize: 13, marginTop: 8 }}
              onClick={() => { setSelectedAction(null); setStepConfig({}); setEditingStepIdx(null); setShowAddStep(true) }}
            >
              <Plus size={14} style={{ marginRight: 6 }} /> 新增步驟
            </button>
          </div>

          {/* Save / Cancel */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 28 }}>
            <button className="btn btn-primary" onClick={saveWorkflow}>
              {editingWorkflowId ? '儲存變更' : '建立流程'}
            </button>
            <button className="btn btn-secondary" onClick={() => { resetBuilder(); setTab('list') }}>取消</button>
          </div>
        </div>
      )}

      {/* ======== TAB: Execution Logs ======== */}
      {tab === 'logs' && (
        <div>
          <div className="card">
            <div className="card-header" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>近期執行紀錄</h3>
            </div>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>時間</th>
                  <th>工作流程</th>
                  <th>觸發條件</th>
                  <th>已執行步驟</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{log.timestamp}</td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{log.workflow}</td>
                    <td style={{ fontSize: 12 }}>{log.trigger}</td>
                    <td>{log.stepsExecuted}</td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                        background: log.status === '成功'
                          ? 'var(--accent-green-dim, rgba(34,197,94,0.15))'
                          : log.status === '部分失敗'
                            ? 'var(--accent-orange-dim, rgba(249,115,22,0.15))'
                            : 'var(--accent-red-dim, rgba(239,68,68,0.15))',
                        color: log.status === '成功'
                          ? 'var(--accent-green)'
                          : log.status === '部分失敗'
                            ? 'var(--accent-orange)'
                            : 'var(--accent-red)',
                      }}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ======== MODAL: Add / Edit Step ======== */}
      {showAddStep && (
        <Modal
          title={editingStepIdx !== null ? '編輯步驟' : '新增步驟'}
          onClose={() => { setShowAddStep(false); setEditingStepIdx(null) }}
          onSubmit={addStep}
          submitLabel={editingStepIdx !== null ? '更新' : '新增'}
        >
          <Field label="選擇動作">
            <select
              className="form-input"
              value={selectedAction || ''}
              onChange={e => { setSelectedAction(e.target.value); setStepConfig({}) }}
              style={{ width: '100%' }}
            >
              <option value="">-- 請選擇 --</option>
              {WORKFLOW_ACTIONS.map(a => (
                <option key={a.value} value={a.value}>{a.icon} {a.label}</option>
              ))}
            </select>
          </Field>

          {selectedAction && ACTION_CONFIG_FIELDS[selectedAction]?.map(f => (
            <Field key={f.key} label={f.label}>
              {f.type === 'select' ? (
                <select
                  className="form-input"
                  value={stepConfig[f.key] || ''}
                  onChange={e => setStepConfig(prev => ({ ...prev, [f.key]: e.target.value }))}
                  style={{ width: '100%' }}
                >
                  <option value="">-- 請選擇 --</option>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  className="form-input"
                  value={stepConfig[f.key] || ''}
                  onChange={e => setStepConfig(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                  rows={3}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              ) : (
                <input
                  className="form-input"
                  type={f.type || 'text'}
                  value={stepConfig[f.key] || ''}
                  onChange={e => setStepConfig(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                  style={{ width: '100%' }}
                />
              )}
            </Field>
          ))}
        </Modal>
      )}

      {/* ======== MODAL: Templates ======== */}
      {showTemplates && (
        <Modal
          title="選擇流程範本"
          onClose={() => setShowTemplates(false)}
          onSubmit={() => setShowTemplates(false)}
          submitLabel="關閉"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TEMPLATES.map((tpl, i) => (
              <div
                key={i}
                style={{
                  padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                  background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
                  transition: 'border-color 0.15s',
                }}
                onClick={() => applyTemplate(tpl)}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
              >
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                  <Zap size={13} style={{ marginRight: 4, verticalAlign: -2, color: 'var(--accent-cyan)' }} />
                  {tpl.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{tpl.description}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 10, padding: '1px 8px', borderRadius: 99,
                    background: 'var(--accent-cyan-dim, rgba(6,182,212,0.12))', color: 'var(--accent-cyan)',
                  }}>
                    {getTriggerLabel(tpl.trigger)}
                  </span>
                  {tpl.steps.map((s, j) => (
                    <span key={j} style={{
                      fontSize: 10, padding: '1px 8px', borderRadius: 99,
                      background: `${ACTION_COLORS[s.action] || 'var(--accent-blue)'}18`,
                      color: ACTION_COLORS[s.action] || 'var(--accent-blue)',
                    }}>
                      {getActionDef(s.action).icon} {getActionDef(s.action).label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
