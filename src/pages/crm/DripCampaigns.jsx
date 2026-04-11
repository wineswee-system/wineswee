import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Search, Play, Pause, Sparkles, Edit3, Check
} from 'lucide-react'
import LoadingSpinner from '../../components/LoadingSpinner'
import { createDripCampaign, simulateDripCampaign, calculateDripMetrics, TRIGGER_TYPES } from '../../lib/dripCampaign'
import { generateEmailTemplate, generateSubjectLines, generateCTAVariations, improveContent, scoreEmailTemplate } from '../../lib/aiTemplateEngine'

import DripCampaignList from './components/DripCampaignList'
import DripCampaignBuilder from './components/DripCampaignBuilder'
import DripStepEditor from './components/DripStepEditor'
import DripTemplateSelector from './components/DripTemplateSelector'
import DripCampaignAnalytics from './components/DripCampaignAnalytics'

const STATUS_MAP = {
  draft: { label: '草稿', badge: 'badge-neutral', icon: <Edit3 size={12} /> },
  active: { label: '進行中', badge: 'badge-success', icon: <Play size={12} /> },
  paused: { label: '暫停', badge: 'badge-warning', icon: <Pause size={12} /> },
  completed: { label: '已完成', badge: 'badge-info', icon: <Check size={12} /> },
}

// Sample history data for analytics
function generateSampleHistory(campaign) {
  const events = []
  const contacts = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']
  const names = ['王小明', '李大華', '陳美麗', '張志偉', '林雅芳', '黃建國', '吳佳蓉', '周大偉']
  campaign.steps.forEach((step, idx) => {
    if (step.type === 'wait' || step.type === 'condition') return
    contacts.forEach((cid, ci) => {
      events.push({ contact_id: cid, contact_name: names[ci], step_index: idx, event: 'sent', timestamp: new Date().toISOString() })
      if (Math.random() > 0.05) events.push({ contact_id: cid, step_index: idx, event: 'delivered', timestamp: new Date().toISOString() })
      if (Math.random() > 0.35) events.push({ contact_id: cid, step_index: idx, event: 'opened', timestamp: new Date().toISOString() })
      if (Math.random() > 0.6) events.push({ contact_id: cid, step_index: idx, event: 'clicked', timestamp: new Date().toISOString() })
      if (Math.random() > 0.85) events.push({ contact_id: cid, step_index: idx, event: 'converted', timestamp: new Date().toISOString(), revenue: Math.floor(Math.random() * 3000) + 500 })
    })
  })
  return events
}

// Initial sample campaigns
const INITIAL_CAMPAIGNS = [
  {
    id: 'camp_demo_1',
    name: '新會員歡迎系列',
    description: '新客戶註冊後自動發送歡迎信件、產品推薦與首購優惠',
    trigger: 'new_customer',
    audience: { segment: '全部客戶' },
    status: 'active',
    created_at: '2026-03-01T08:00:00Z',
    updated_at: '2026-03-28T10:00:00Z',
    stats: { enrolled: 342, completed: 198, active: 144 },
    steps: [
      { id: 's1', step_index: 0, delay_days: 0, delay_hours: 0, type: 'email', subject: '歡迎加入！您的專屬旅程開始了', content: '親愛的 {{customer_name}} 您好，\n\n感謝您加入我們的大家庭！', template_id: null },
      { id: 's2', step_index: 1, delay_days: 1, delay_hours: 0, type: 'wait', content: null, subject: null, template_id: null },
      { id: 's3', step_index: 2, delay_days: 3, delay_hours: 0, type: 'email', subject: '來看看我們最受歡迎的產品吧！', content: '以下是本月最受歡迎的熱銷商品...', template_id: null },
      { id: 's4', step_index: 3, delay_days: 7, delay_hours: 0, type: 'condition', field: 'opened_email', operator: 'eq', value: true, true_branch_step: { type: 'email', subject: '專屬優惠來了', content: '限時85折' }, false_branch_step: { type: 'email', subject: '我們想念您', content: '距離上次...' }, content: null, subject: null, template_id: null },
    ],
  },
  {
    id: 'camp_demo_2',
    name: '購物車挽回',
    description: '當客戶放棄購物車時，自動發送提醒郵件與限時優惠',
    trigger: 'abandoned_cart',
    audience: { segment: '全部客戶' },
    status: 'active',
    created_at: '2026-03-10T08:00:00Z',
    updated_at: '2026-03-25T10:00:00Z',
    stats: { enrolled: 128, completed: 76, active: 52 },
    steps: [
      { id: 's5', step_index: 0, delay_days: 0, delay_hours: 1, type: 'email', subject: '您的購物車有商品等著您！', content: '親愛的 {{customer_name}}，您的購物車中還有未結帳的商品。', template_id: null },
      { id: 's6', step_index: 1, delay_days: 1, delay_hours: 0, type: 'line', content: '提醒：您的購物車中有 {{cart_count}} 件商品等著您唷！', subject: null, template_id: null },
      { id: 's7', step_index: 2, delay_days: 3, delay_hours: 0, type: 'email', subject: '最後機會！購物車商品即將釋出', content: '限時48小時，結帳享9折優惠！', template_id: null },
    ],
  },
  {
    id: 'camp_demo_3',
    name: '沉睡客戶喚回',
    description: '針對超過60天未互動的客戶進行再行銷',
    trigger: 'inactivity',
    audience: { segment: '半年未購買' },
    status: 'paused',
    created_at: '2026-02-15T08:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    stats: { enrolled: 89, completed: 34, active: 0 },
    steps: [
      { id: 's8', step_index: 0, delay_days: 0, delay_hours: 0, type: 'email', subject: '好久不見！我們想念您了', content: '親愛的 {{customer_name}}，已經有一段時間沒看到您了...', template_id: null },
      { id: 's9', step_index: 1, delay_days: 5, delay_hours: 0, type: 'sms', content: '{{customer_name}} 您好，專屬回歸禮等您領取！立即查看 {{link}}', subject: null, template_id: null },
    ],
  },
]

const SAMPLE_CONTACTS = [
  { id: 'c1', name: '王小明', email: 'wang@example.com', opened_email: true, clicked_link: true, purchased: true, tags: ['VIP'] },
  { id: 'c2', name: '李大華', email: 'lee@example.com', opened_email: true, clicked_link: false, purchased: false, tags: [] },
  { id: 'c3', name: '陳美麗', email: 'chen@example.com', opened_email: false, clicked_link: false, purchased: false, tags: ['潛力客戶'] },
  { id: 'c4', name: '張志偉', email: 'zhang@example.com', opened_email: true, clicked_link: true, purchased: false, tags: [] },
  { id: 'c5', name: '林雅芳', email: 'lin@example.com', opened_email: false, clicked_link: false, purchased: false, tags: ['老客戶'] },
]

export default function DripCampaigns() {
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState(INITIAL_CAMPAIGNS)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [triggerFilter, setTriggerFilter] = useState('')

  // Builder modal
  const [showBuilder, setShowBuilder] = useState(false)
  const [builderTab, setBuilderTab] = useState(0)
  const [editingCampaign, setEditingCampaign] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', trigger: 'manual', audience: '全部客戶', scheduleMode: 'immediate' })
  const [steps, setSteps] = useState([])
  const [editingStep, setEditingStep] = useState(null)
  const [showStepEditor, setShowStepEditor] = useState(false)
  const [stepForm, setStepForm] = useState({ type: 'email', delay_days: 0, delay_hours: 0, subject: '', content: '', field: 'opened_email', operator: 'eq', value: '' })

  // AI Template
  const [aiPurpose, setAiPurpose] = useState('welcome')
  const [aiTone, setAiTone] = useState('professional')
  const [aiDesign, setAiDesign] = useState('modern')
  const [generatedTemplate, setGeneratedTemplate] = useState(null)
  const [subjectLines, setSubjectLines] = useState([])
  const [ctaVariations, setCtaVariations] = useState([])
  const [improveType, setImproveType] = useState('shorter')
  const [improveInput, setImproveInput] = useState('')
  const [improvedResult, setImprovedResult] = useState(null)
  const [templateScore, setTemplateScore] = useState(null)

  // Preview & Test
  const [previewDevice, setPreviewDevice] = useState('desktop')
  const [simulationResult, setSimulationResult] = useState(null)
  const [testSent, setTestSent] = useState(false)

  // Analytics
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [analyticsCampaign, setAnalyticsCampaign] = useState(null)
  const [analyticsMetrics, setAnalyticsMetrics] = useState(null)

  // Templates panel
  const [showTemplates, setShowTemplates] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 400)
    return () => clearTimeout(timer)
  }, [])

  // Stats
  const stats = useMemo(() => {
    const active = campaigns.filter(c => c.status === 'active').length
    const totalSubs = campaigns.reduce((s, c) => s + (c.stats?.enrolled || 0), 0)
    const totalSent = campaigns.reduce((s, c) => s + (c.stats?.enrolled || 0) * (c.steps?.length || 1), 0)
    return { active, totalSubs, avgOpenRate: 42.5, totalSent }
  }, [campaigns])

  // Filtered campaigns
  const filtered = useMemo(() => {
    return campaigns.filter(c => {
      if (statusFilter && c.status !== statusFilter) return false
      if (triggerFilter && c.trigger !== triggerFilter) return false
      if (search && !c.name.includes(search) && !c.description.includes(search)) return false
      return true
    })
  }, [campaigns, search, statusFilter, triggerFilter])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setSF = (k, v) => setStepForm(f => ({ ...f, [k]: v }))

  // ── Campaign Actions ──
  const toggleStatus = (id) => {
    setCampaigns(prev => prev.map(c => {
      if (c.id !== id) return c
      const next = c.status === 'active' ? 'paused' : 'active'
      return { ...c, status: next, updated_at: new Date().toISOString() }
    }))
  }

  const deleteCampaign = (id) => {
    if (!confirm('確定要刪除此活動？')) return
    setCampaigns(prev => prev.filter(c => c.id !== id))
  }

  const cloneCampaign = (camp) => {
    const cloned = {
      ...camp,
      id: 'camp_' + Date.now(),
      name: camp.name + ' (複製)',
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stats: { enrolled: 0, completed: 0, active: 0 },
    }
    setCampaigns(prev => [cloned, ...prev])
  }

  const openBuilder = (camp = null) => {
    if (camp) {
      setEditingCampaign(camp)
      setForm({ name: camp.name, description: camp.description, trigger: camp.trigger, audience: camp.audience?.segment || '全部客戶', scheduleMode: 'immediate' })
      setSteps([...camp.steps])
    } else {
      setEditingCampaign(null)
      setForm({ name: '', description: '', trigger: 'manual', audience: '全部客戶', scheduleMode: 'immediate' })
      setSteps([])
    }
    setBuilderTab(0)
    setGeneratedTemplate(null)
    setSubjectLines([])
    setCtaVariations([])
    setImprovedResult(null)
    setTemplateScore(null)
    setSimulationResult(null)
    setTestSent(false)
    setShowBuilder(true)
  }

  const saveCampaign = () => {
    if (!form.name) { alert('請輸入活動名稱'); return }
    if (editingCampaign) {
      setCampaigns(prev => prev.map(c => c.id === editingCampaign.id ? {
        ...c, name: form.name, description: form.description, trigger: form.trigger,
        audience: { segment: form.audience }, steps: steps, updated_at: new Date().toISOString()
      } : c))
    } else {
      const newCamp = createDripCampaign({
        name: form.name, description: form.description, trigger: form.trigger,
        audience: { segment: form.audience }, steps: steps, status: 'draft',
      })
      setCampaigns(prev => [newCamp, ...prev])
    }
    setShowBuilder(false)
  }

  // ── Step Actions ──
  const openStepEditor = (step = null, index = null) => {
    if (step) {
      setStepForm({ ...step })
      setEditingStep(index)
    } else {
      setStepForm({ type: 'email', delay_days: 0, delay_hours: 0, subject: '', content: '', field: 'opened_email', operator: 'eq', value: '' })
      setEditingStep(null)
    }
    setShowStepEditor(true)
  }

  const saveStep = () => {
    if (stepForm.type === 'email' && !stepForm.subject) { alert('Email 步驟需輸入主旨'); return }
    if (editingStep !== null) {
      setSteps(prev => prev.map((s, i) => i === editingStep ? { ...s, ...stepForm, step_index: i } : s))
    } else {
      const newStep = { ...stepForm, id: 'step_' + Date.now(), step_index: steps.length }
      setSteps(prev => [...prev, newStep])
    }
    setShowStepEditor(false)
  }

  const deleteStep = (idx) => {
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_index: i })))
  }

  const moveStep = (idx, dir) => {
    const next = idx + dir
    if (next < 0 || next >= steps.length) return
    setSteps(prev => {
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr.map((s, i) => ({ ...s, step_index: i }))
    })
  }

  // ── AI Functions ──
  const handleGenerate = () => {
    const result = generateEmailTemplate({ purpose: aiPurpose, tone: aiTone, productName: '我們的產品', companyName: '我們的品牌' })
    setGeneratedTemplate(result)
    const score = scoreEmailTemplate(result)
    setTemplateScore(score)
  }

  const handleSubjectLines = () => {
    const lines = generateSubjectLines({ purpose: aiPurpose, tone: aiTone })
    setSubjectLines(lines)
  }

  const handleCTAVariations = () => {
    const vars = generateCTAVariations(aiPurpose)
    setCtaVariations(vars)
  }

  const handleImprove = () => {
    if (!improveInput) return
    const result = improveContent(improveInput, improveType)
    setImprovedResult(result)
  }

  // ── Analytics ──
  const openAnalytics = (camp) => {
    setAnalyticsCampaign(camp)
    const history = generateSampleHistory(camp)
    const metrics = calculateDripMetrics(camp, history)
    setAnalyticsMetrics(metrics)
    setShowAnalytics(true)
  }

  // ── Simulate ──
  const handleSimulate = () => {
    const tempCamp = { steps }
    const result = simulateDripCampaign(tempCamp, SAMPLE_CONTACTS)
    setSimulationResult(result)
  }

  // ── Use Template ──
  const applyTemplate = (tmpl) => {
    setForm(f => ({ ...f, name: tmpl.name, description: tmpl.description, trigger: tmpl.trigger }))
    setSteps(tmpl.steps.map((s, i) => ({ ...s, id: 'step_' + Date.now() + '_' + i, step_index: i })))
    setShowTemplates(false)
    setBuilderTab(1)
  }

  if (loading) return <LoadingSpinner />

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════
  return (
    <div className="fade-in" style={{ padding: 0 }}>
      {/* ── Page Header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span role="img" aria-label="email">📧</span> 自動化郵件行銷
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>Drip Campaign 設定與 AI 範本管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => { setShowTemplates(true); openBuilder() }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} /> 從範本建立
            </button>
            <button className="btn btn-primary" onClick={() => openBuilder()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> 新增活動
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>進行中活動</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-primary)' }}>{stats.active}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>總訂閱人數</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-primary)' }}>{stats.totalSubs.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>平均開信率</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#22c55e' }}>{stats.avgOpenRate}%</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>已發送郵件</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{stats.totalSent.toLocaleString()}</div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input placeholder="搜尋活動名稱..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 8px 8px 32px', border: '1px solid var(--border-medium)', borderRadius: 8, background: 'var(--bg-primary)', fontSize: 13, color: 'var(--text-primary)' }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, background: 'var(--bg-primary)', fontSize: 13, color: 'var(--text-primary)' }}>
          <option value="">全部狀態</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, background: 'var(--bg-primary)', fontSize: 13, color: 'var(--text-primary)' }}>
          <option value="">全部觸發</option>
          {TRIGGER_TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
        </select>
      </div>

      {/* ── Campaign List ── */}
      <DripCampaignList
        filtered={filtered}
        onToggleStatus={toggleStatus}
        onEdit={openBuilder}
        onAnalytics={openAnalytics}
        onClone={cloneCampaign}
        onDelete={deleteCampaign}
      />

      {/* ── Campaign Builder Modal ── */}
      {showBuilder && (
        <DripCampaignBuilder
          editingCampaign={editingCampaign}
          form={form} set={set}
          steps={steps} onOpenStepEditor={openStepEditor} onDeleteStep={deleteStep} onMoveStep={moveStep}
          builderTab={builderTab} setBuilderTab={setBuilderTab}
          onClose={() => setShowBuilder(false)} onSave={saveCampaign}
          onShowTemplates={() => setShowTemplates(true)}
          aiPurpose={aiPurpose} setAiPurpose={setAiPurpose}
          aiTone={aiTone} setAiTone={setAiTone}
          aiDesign={aiDesign} setAiDesign={setAiDesign}
          generatedTemplate={generatedTemplate}
          subjectLines={subjectLines}
          ctaVariations={ctaVariations}
          improveType={improveType} setImproveType={setImproveType}
          improveInput={improveInput} setImproveInput={setImproveInput}
          improvedResult={improvedResult}
          templateScore={templateScore}
          onGenerate={handleGenerate} onSubjectLines={handleSubjectLines}
          onCTAVariations={handleCTAVariations} onImprove={handleImprove}
          stepForm={stepForm} setSF={setSF} editingStep={editingStep}
          previewDevice={previewDevice} setPreviewDevice={setPreviewDevice}
          simulationResult={simulationResult} testSent={testSent}
          onSimulate={handleSimulate}
          onSendTest={() => { setTestSent(true); setTimeout(() => setTestSent(false), 3000) }}
        />
      )}

      {/* ── Step Editor Modal ── */}
      {showStepEditor && (
        <DripStepEditor
          editingStep={editingStep}
          stepForm={stepForm}
          setSF={setSF}
          onClose={() => setShowStepEditor(false)}
          onSave={saveStep}
        />
      )}

      {/* ── Templates Panel ── */}
      {showTemplates && (
        <DripTemplateSelector
          onApplyTemplate={applyTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* ── Analytics Modal ── */}
      {showAnalytics && analyticsCampaign && analyticsMetrics && (
        <DripCampaignAnalytics
          campaign={analyticsCampaign}
          metrics={analyticsMetrics}
          onClose={() => setShowAnalytics(false)}
        />
      )}
    </div>
  )
}
