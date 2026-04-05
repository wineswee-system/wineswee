import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Search, Play, Pause, Copy, Trash2, Wand2, Eye, Send,
  ChevronDown, ChevronRight, Mail, MessageSquare, Smartphone, Clock,
  GitBranch, Users, BarChart3, Zap, Sparkles, Check, X, Edit3, RefreshCw
} from 'lucide-react'
import LoadingSpinner from '../../components/LoadingSpinner'
import { createDripCampaign, addDripStep, simulateDripCampaign, calculateDripMetrics, DRIP_TEMPLATES, TRIGGER_TYPES, STEP_TYPES } from '../../lib/dripCampaign'
import { generateEmailTemplate, generateSubjectLines, generateCTAVariations, improveContent, scoreEmailTemplate, AI_CONTENT_BLOCKS, EMAIL_DESIGN_PRESETS } from '../../lib/aiTemplateEngine'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const STATUS_MAP = {
  draft: { label: '草稿', badge: 'badge-neutral', icon: <Edit3 size={12} /> },
  active: { label: '進行中', badge: 'badge-success', icon: <Play size={12} /> },
  paused: { label: '暫停', badge: 'badge-warning', icon: <Pause size={12} /> },
  completed: { label: '已完成', badge: 'badge-info', icon: <Check size={12} /> },
}

const STEP_ICON_MAP = {
  email: <Mail size={16} />,
  line: <MessageSquare size={16} />,
  sms: <Smartphone size={16} />,
  wait: <Clock size={16} />,
  condition: <GitBranch size={16} />,
}

const STEP_COLOR_MAP = {
  email: '#6366f1',
  line: '#06c755',
  sms: '#f59e0b',
  wait: '#94a3b8',
  condition: '#ec4899',
}

const AUDIENCES = ['全部客戶', 'VIP 客戶', '半年未購買', '生日當月', '潛力客戶', '老客戶']

const IMPROVEMENT_TYPES = [
  { id: 'shorter', label: '更精簡' },
  { id: 'more_urgent', label: '更緊迫' },
  { id: 'more_friendly', label: '更親切' },
  { id: 'add_social_proof', label: '加社會證明' },
  { id: 'add_scarcity', label: '加稀缺感' },
  { id: 'more_professional', label: '更專業' },
]

const PURPOSES = [
  { id: 'welcome', label: '歡迎信' },
  { id: 'promotion', label: '促銷活動' },
  { id: 'newsletter', label: '電子報' },
  { id: 'announcement', label: '公告' },
  { id: 'follow_up', label: '後續跟進' },
  { id: 'thank_you', label: '感謝信' },
  { id: 'feedback', label: '問卷回饋' },
  { id: 'reactivation', label: '喚回沉睡' },
  { id: 'event_invitation', label: '活動邀請' },
  { id: 'product_launch', label: '新品上市' },
]

const TONES = [
  { id: 'professional', label: '專業' },
  { id: 'friendly', label: '親切' },
  { id: 'urgent', label: '急迫' },
  { id: 'luxurious', label: '高級' },
  { id: 'playful', label: '活潑' },
]

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
    // Auto-score
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

  const handleScoreTemplate = () => {
    if (!generatedTemplate) return
    const score = scoreEmailTemplate(generatedTemplate)
    setTemplateScore(score)
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
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>活動名稱</th>
              <th>觸發條件</th>
              <th>狀態</th>
              <th>步驟</th>
              <th>訂閱人數</th>
              <th>完成率</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>尚無符合條件的活動</td></tr>
            )}
            {filtered.map(camp => {
              const triggerInfo = TRIGGER_TYPES.find(t => t.id === camp.trigger)
              const st = STATUS_MAP[camp.status] || STATUS_MAP.draft
              const completionRate = camp.stats?.enrolled ? Math.round((camp.stats.completed / camp.stats.enrolled) * 100) : 0
              return (
                <tr key={camp.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{camp.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{camp.description?.substring(0, 40)}{camp.description?.length > 40 ? '...' : ''}</div>
                  </td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                      <span>{triggerInfo?.icon}</span> {triggerInfo?.name || camp.trigger}
                    </span>
                  </td>
                  <td><span className={`badge ${st.badge}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{st.icon} {st.label}</span></td>
                  <td><span style={{ fontSize: 13 }}>{camp.steps?.length || 0} 步驟</span></td>
                  <td><span style={{ fontSize: 13 }}>{(camp.stats?.enrolled || 0).toLocaleString()}</span></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                        <div style={{ width: `${completionRate}%`, height: '100%', borderRadius: 3, background: completionRate > 60 ? '#22c55e' : completionRate > 30 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 36 }}>{completionRate}%</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => toggleStatus(camp.id)} title={camp.status === 'active' ? '暫停' : '啟動'}>
                        {camp.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => openBuilder(camp)} title="編輯">
                        <Edit3 size={13} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => openAnalytics(camp)} title="分析">
                        <BarChart3 size={13} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => cloneCampaign(camp)} title="複製">
                        <Copy size={13} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', color: '#ef4444' }} onClick={() => deleteCampaign(camp.id)} title="刪除">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ══════════════════════════════════════════ */}
      {/* CAMPAIGN BUILDER MODAL                     */}
      {/* ══════════════════════════════════════════ */}
      {showBuilder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-modal-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowBuilder(false)}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '100%', maxWidth: 920, maxHeight: '92vh', overflow: 'hidden', boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{editingCampaign ? '編輯活動' : '建立新活動'}</h3>
              <button onClick={() => setShowBuilder(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>

            {/* Tab Buttons */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', padding: '0 24px', gap: 0 }}>
              {['基本設定', '流程設計', 'AI 範本助手', '預覽與測試'].map((tab, i) => (
                <button key={i} onClick={() => setBuilderTab(i)}
                  style={{ padding: '12px 20px', fontSize: 13, fontWeight: builderTab === i ? 700 : 400, color: builderTab === i ? 'var(--color-primary)' : 'var(--text-secondary)', background: 'none', border: 'none', borderBottom: builderTab === i ? '2px solid var(--color-primary)' : '2px solid transparent', cursor: 'pointer', transition: 'all 0.15s' }}>
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>

              {/* ── Tab 0: Basic Setup ── */}
              {builderTab === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>活動名稱</label>
                    <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="例: 新會員歡迎系列"
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 14, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>活動說明</label>
                    <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="描述此活動的目標與內容" rows={2}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical' }} />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, display: 'block', color: 'var(--text-secondary)' }}>觸發條件</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                      {TRIGGER_TYPES.map(t => (
                        <div key={t.id} onClick={() => set('trigger', t.id)}
                          style={{ padding: '12px 14px', border: form.trigger === t.id ? '2px solid var(--color-primary)' : '1px solid var(--border-medium)', borderRadius: 10, cursor: 'pointer', background: form.trigger === t.id ? 'var(--bg-tertiary)' : 'var(--bg-primary)', transition: 'all 0.15s' }}>
                          <div style={{ fontSize: 20, marginBottom: 4 }}>{t.icon}</div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{t.description.substring(0, 30)}...</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>目標受眾</label>
                      <select value={form.audience} onChange={e => set('audience', e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                        {AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>排程方式</label>
                      <select value={form.scheduleMode} onChange={e => set('scheduleMode', e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                        <option value="immediate">觸發後立即開始</option>
                        <option value="delayed">延遲啟動</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tab 1: Flow Designer ── */}
              {builderTab === 1 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700 }}>行銷流程 ({steps.length} 步驟)</h4>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary" onClick={() => { setShowTemplates(true) }} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Sparkles size={12} /> 套用範本
                      </button>
                      <button className="btn btn-primary" onClick={() => openStepEditor()} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Plus size={12} /> 新增步驟
                      </button>
                    </div>
                  </div>

                  {steps.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-secondary)', border: '2px dashed var(--border-medium)', borderRadius: 12 }}>
                      <Zap size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                      <div style={{ fontSize: 14, fontWeight: 600 }}>尚未設定步驟</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>點擊「新增步驟」開始建立行銷流程</div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {steps.map((step, idx) => {
                      const typeInfo = STEP_TYPES.find(t => t.id === step.type)
                      const color = STEP_COLOR_MAP[step.type] || '#6b7280'
                      return (
                        <div key={step.id || idx}>
                          {/* Connector line */}
                          {idx > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                              <div style={{ width: 2, height: 24, background: 'var(--border-medium)' }} />
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                            {/* Step number circle */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                                {idx + 1}
                              </div>
                            </div>
                            {/* Step card */}
                            <div style={{ flex: 1, padding: '12px 16px', border: '1px solid var(--border-medium)', borderRadius: 10, background: 'var(--bg-primary)', borderLeft: `3px solid ${color}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ color }}>{STEP_ICON_MAP[step.type]}</span>
                                  <span style={{ fontSize: 13, fontWeight: 600 }}>{typeInfo?.name || step.type}</span>
                                  {(step.delay_days > 0 || step.delay_hours > 0) && (
                                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 4 }}>
                                      <Clock size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                                      {step.delay_days > 0 ? `${step.delay_days}天` : ''}{step.delay_hours > 0 ? `${step.delay_hours}小時` : ''}後
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontSize: 14, color: 'var(--text-secondary)' }}>↑</button>
                                  <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} style={{ background: 'none', border: 'none', cursor: idx === steps.length - 1 ? 'default' : 'pointer', opacity: idx === steps.length - 1 ? 0.3 : 1, fontSize: 14, color: 'var(--text-secondary)' }}>↓</button>
                                  <button onClick={() => openStepEditor(step, idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)' }}><Edit3 size={13} /></button>
                                  <button onClick={() => deleteStep(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={13} /></button>
                                </div>
                              </div>
                              {step.type === 'email' && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>主旨: {step.subject}</div>}
                              {(step.type === 'email' || step.type === 'line' || step.type === 'sms') && step.content && (
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>{step.content.substring(0, 80)}...</div>
                              )}
                              {step.type === 'condition' && (
                                <div style={{ marginTop: 8 }}>
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                    條件: {step.field} {step.operator} {String(step.value)}
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                                    <div style={{ padding: '6px 10px', borderRadius: 6, background: '#dcfce7', border: '1px solid #bbf7d0', fontSize: 11 }}>
                                      <span style={{ fontWeight: 600, color: '#16a34a' }}>True:</span> {step.true_branch_step?.type || step.true_step?.type || '-'}
                                    </div>
                                    <div style={{ padding: '6px 10px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 11 }}>
                                      <span style={{ fontWeight: 600, color: '#dc2626' }}>False:</span> {step.false_branch_step?.type || step.false_step?.type || '-'}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Tab 2: AI Template Assistant ── */}
              {builderTab === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {/* Quick Generate */}
                  <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Wand2 size={16} style={{ color: 'var(--color-primary)' }} /> 快速生成
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>郵件目的</label>
                        <select value={aiPurpose} onChange={e => setAiPurpose(e.target.value)}
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                          {PURPOSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>語氣</label>
                        <select value={aiTone} onChange={e => setAiTone(e.target.value)}
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                          {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>設計風格</label>
                        <select value={aiDesign} onChange={e => setAiDesign(e.target.value)}
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                          {Object.entries(EMAIL_DESIGN_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.nameZh}</option>)}
                        </select>
                      </div>
                    </div>
                    <button className="btn btn-primary" onClick={handleGenerate} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <Sparkles size={14} /> AI 生成
                    </button>

                    {generatedTemplate && (
                      <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>生成結果</div>
                        <div style={{ fontSize: 12, marginBottom: 4 }}><strong>主旨:</strong> {generatedTemplate.subject}</div>
                        <div style={{ fontSize: 12, marginBottom: 4 }}><strong>預覽:</strong> {generatedTemplate.preheader}</div>
                        <div style={{ fontSize: 12, marginBottom: 4 }}><strong>問候:</strong> {generatedTemplate.greeting}</div>
                        <div style={{ fontSize: 12, marginBottom: 4, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}><strong>正文:</strong><br />{generatedTemplate.body}</div>
                        <div style={{ fontSize: 12, marginBottom: 4 }}><strong>CTA:</strong> {generatedTemplate.cta_text}</div>
                        <div style={{ fontSize: 12 }}><strong>結語:</strong> {generatedTemplate.closing}</div>
                        <button className="btn btn-secondary" style={{ marginTop: 8, fontSize: 11 }}
                          onClick={() => {
                            if (editingStep !== null) {
                              setSF('subject', generatedTemplate.subject)
                              setSF('content', `${generatedTemplate.greeting}\n\n${generatedTemplate.body}\n\n${generatedTemplate.cta_text}\n\n${generatedTemplate.closing}`)
                            }
                          }}>
                          套用到當前步驟
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Subject Line Generator + CTA Generator side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 16, background: 'var(--bg-primary)' }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Mail size={14} /> 主旨行生成
                      </h4>
                      <button className="btn btn-secondary" onClick={handleSubjectLines} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                        <RefreshCw size={12} /> 生成 5 個建議
                      </button>
                      {subjectLines.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {subjectLines.map((line, i) => (
                            <div key={i} onClick={() => setSF('subject', line)}
                              style={{ padding: '8px 10px', fontSize: 12, border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer', background: stepForm.subject === line ? 'var(--bg-tertiary)' : 'var(--bg-secondary)', transition: 'background 0.1s' }}>
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 16, background: 'var(--bg-primary)' }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Zap size={14} /> CTA 生成
                      </h4>
                      <button className="btn btn-secondary" onClick={handleCTAVariations} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                        <RefreshCw size={12} /> 生成 5 個變體
                      </button>
                      {ctaVariations.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {ctaVariations.map((cta, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-secondary)' }}>
                              <span className={`badge ${cta.style === 'urgent' ? 'badge-danger' : cta.style === 'primary' ? 'badge-success' : 'badge-info'}`} style={{ fontSize: 10 }}>{cta.style}</span>
                              <span>{cta.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Content Improver */}
                  <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Edit3 size={16} style={{ color: '#f59e0b' }} /> 內容優化
                    </h4>
                    <textarea value={improveInput} onChange={e => setImproveInput(e.target.value)} placeholder="貼上或輸入要優化的內容..." rows={3}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical', marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {IMPROVEMENT_TYPES.map(t => (
                        <button key={t.id} onClick={() => setImproveType(t.id)}
                          className={`btn ${improveType === t.id ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: 11, padding: '4px 10px' }}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <button className="btn btn-primary" onClick={handleImprove} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Wand2 size={12} /> AI 優化
                    </button>
                    {improvedResult && (
                      <div style={{ marginTop: 12, padding: 14, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>改善項目:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                          {improvedResult.changes.map((c, i) => (
                            <div key={i} style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Check size={10} /> {c}
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', padding: 10, background: 'var(--bg-primary)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                          {improvedResult.improved}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Template Score */}
                  {templateScore && (
                    <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <BarChart3 size={16} style={{ color: '#6366f1' }} /> 範本評分
                        <span style={{ fontSize: 24, fontWeight: 800, marginLeft: 'auto', color: templateScore.score >= 70 ? '#22c55e' : templateScore.score >= 40 ? '#f59e0b' : '#ef4444' }}>{templateScore.score}/100</span>
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {templateScore.breakdown.map((item, i) => (
                          <div key={i}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                              <span>{item.criterion}</span>
                              <span style={{ fontWeight: 600 }}>{item.score}/{item.max}</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                              <div style={{ width: `${(item.score / item.max) * 100}%`, height: '100%', borderRadius: 3, background: (item.score / item.max) >= 0.7 ? '#22c55e' : (item.score / item.max) >= 0.4 ? '#f59e0b' : '#ef4444', transition: 'width 0.3s' }} />
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{item.suggestion}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Design Preset Selector */}
                  <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>設計風格預覽</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                      {Object.entries(EMAIL_DESIGN_PRESETS).map(([key, preset]) => (
                        <div key={key} onClick={() => setAiDesign(key)}
                          style={{ padding: 12, borderRadius: 10, border: aiDesign === key ? '2px solid var(--color-primary)' : '1px solid var(--border-medium)', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s' }}>
                          <div style={{ width: '100%', height: 48, borderRadius: 6, marginBottom: 8, background: preset.bgColor, border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ width: '60%', height: 8, borderRadius: 4, background: preset.primaryColor }} />
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{preset.nameZh}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{preset.layoutDescription.substring(0, 16)}...</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tab 3: Preview & Test ── */}
              {builderTab === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Device toggle + Send test */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ display: 'flex', border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden' }}>
                      <button onClick={() => setPreviewDevice('desktop')}
                        style={{ padding: '6px 14px', fontSize: 12, fontWeight: previewDevice === 'desktop' ? 700 : 400, background: previewDevice === 'desktop' ? 'var(--color-primary)' : 'var(--bg-primary)', color: previewDevice === 'desktop' ? '#fff' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}>
                        桌面版
                      </button>
                      <button onClick={() => setPreviewDevice('mobile')}
                        style={{ padding: '6px 14px', fontSize: 12, fontWeight: previewDevice === 'mobile' ? 700 : 400, background: previewDevice === 'mobile' ? 'var(--color-primary)' : 'var(--bg-primary)', color: previewDevice === 'mobile' ? '#fff' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}>
                        手機版
                      </button>
                    </div>
                    <button className="btn btn-secondary" onClick={handleSimulate} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Play size={12} /> 模擬執行
                    </button>
                    <button className="btn btn-primary" onClick={() => { setTestSent(true); setTimeout(() => setTestSent(false), 3000) }} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Send size={12} /> {testSent ? '已發送測試信 ✓' : '發送測試信'}
                    </button>
                  </div>

                  {/* Email Preview */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{
                      width: previewDevice === 'desktop' ? '100%' : 375,
                      maxWidth: '100%',
                      border: '1px solid var(--border-medium)',
                      borderRadius: previewDevice === 'mobile' ? 24 : 8,
                      overflow: 'hidden',
                      background: '#fff',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                      transition: 'width 0.3s',
                    }}>
                      {/* Mock inbox header */}
                      <div style={{ padding: '10px 16px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>B</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>我們的品牌</div>
                          <div style={{ fontSize: 10, color: '#94a3b8' }}>noreply@brand.com</div>
                        </div>
                      </div>
                      {/* Subject */}
                      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                          {generatedTemplate?.subject || (steps[0]?.subject) || '(尚未設定主旨)'}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {generatedTemplate?.preheader || '預覽文字會顯示在這裡'}
                        </div>
                      </div>
                      {/* Body */}
                      <div style={{ padding: '20px 16px', fontSize: 13, color: '#334155', lineHeight: 1.8, minHeight: 200, whiteSpace: 'pre-wrap' }}>
                        {generatedTemplate ? (
                          <>
                            <p>{generatedTemplate.greeting}</p>
                            <p style={{ marginTop: 12 }}>{generatedTemplate.body}</p>
                            <div style={{ textAlign: 'center', margin: '20px 0' }}>
                              <span style={{ display: 'inline-block', padding: '10px 28px', background: '#6366f1', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                                {generatedTemplate.cta_text}
                              </span>
                            </div>
                            <p>{generatedTemplate.closing}</p>
                          </>
                        ) : steps[0]?.content ? (
                          <p>{steps[0].content}</p>
                        ) : (
                          <p style={{ color: '#94a3b8', textAlign: 'center', paddingTop: 40 }}>使用「AI 範本助手」生成內容，或在流程設計中添加步驟後在此預覽</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Simulation Result */}
                  {simulationResult && (
                    <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>模擬結果</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                        <div style={{ textAlign: 'center', padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                          <div style={{ fontSize: 20, fontWeight: 800 }}>{simulationResult.stats.total_contacts}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>聯絡人</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                          <div style={{ fontSize: 20, fontWeight: 800 }}>{simulationResult.stats.emails_to_send}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>待發Email</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                          <div style={{ fontSize: 20, fontWeight: 800 }}>{simulationResult.stats.line_messages || 0}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>LINE訊息</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                          <div style={{ fontSize: 20, fontWeight: 800 }}>{simulationResult.stats.estimated_duration_days}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>預估天數</div>
                        </div>
                      </div>

                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>執行時間軸</div>
                      <div style={{ maxHeight: 200, overflow: 'auto' }}>
                        <table className="data-table" style={{ width: '100%', fontSize: 11 }}>
                          <thead>
                            <tr><th>聯絡人</th><th>步驟</th><th>動作</th><th>排程時間</th></tr>
                          </thead>
                          <tbody>
                            {simulationResult.timeline.slice(0, 20).map((t, i) => (
                              <tr key={i}>
                                <td>{t.contact_name}</td>
                                <td>#{t.step_index + 1}</td>
                                <td>{t.action}</td>
                                <td>{new Date(t.scheduled_at).toLocaleString('zh-TW')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {simulationResult.timeline.length > 20 && (
                        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                          ...共 {simulationResult.timeline.length} 筆紀錄
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 24px', borderTop: '1px solid var(--border-subtle)' }}>
              <button className="btn btn-secondary" onClick={() => setShowBuilder(false)}>取消</button>
              <div style={{ display: 'flex', gap: 8 }}>
                {builderTab < 3 && <button className="btn btn-secondary" onClick={() => setBuilderTab(builderTab + 1)}>下一步 <ChevronRight size={12} /></button>}
                <button className="btn btn-primary" onClick={saveCampaign}>儲存活動</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* STEP EDITOR MODAL                          */}
      {/* ══════════════════════════════════════════ */}
      {showStepEditor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'var(--bg-modal-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowStepEditor(false)}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '100%', maxWidth: 520, boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>{editingStep !== null ? '編輯步驟' : '新增步驟'}</h3>
              <button onClick={() => setShowStepEditor(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>步驟類型</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {STEP_TYPES.map(t => (
                    <button key={t.id} onClick={() => setSF('type', t.id)}
                      className={`btn ${stepForm.type === t.id ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: 11, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {STEP_ICON_MAP[t.id]} {t.name}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>延遲天數</label>
                  <input type="number" min={0} value={stepForm.delay_days} onChange={e => setSF('delay_days', parseInt(e.target.value) || 0)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>延遲小時</label>
                  <input type="number" min={0} value={stepForm.delay_hours} onChange={e => setSF('delay_hours', parseInt(e.target.value) || 0)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              {(stepForm.type === 'email') && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>郵件主旨</label>
                  <input value={stepForm.subject} onChange={e => setSF('subject', e.target.value)} placeholder="輸入主旨行"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              )}

              {(stepForm.type === 'email' || stepForm.type === 'line' || stepForm.type === 'sms') && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>內容</label>
                  <textarea value={stepForm.content} onChange={e => setSF('content', e.target.value)} placeholder="輸入訊息內容..." rows={4}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical' }} />
                </div>
              )}

              {stepForm.type === 'condition' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>欄位</label>
                      <select value={stepForm.field} onChange={e => setSF('field', e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                        <option value="opened_email">已開信</option>
                        <option value="clicked_link">已點擊</option>
                        <option value="purchased">已購買</option>
                        <option value="tag_match">標籤</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>運算子</label>
                      <select value={stepForm.operator} onChange={e => setSF('operator', e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                        <option value="eq">等於</option>
                        <option value="neq">不等於</option>
                        <option value="gt">大於</option>
                        <option value="contains">包含</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>值</label>
                      <input value={stepForm.value} onChange={e => setSF('value', e.target.value)} placeholder="true"
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border-subtle)' }}>
              <button className="btn btn-secondary" onClick={() => setShowStepEditor(false)}>取消</button>
              <button className="btn btn-primary" onClick={saveStep}>儲存步驟</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* TEMPLATES PANEL                            */}
      {/* ══════════════════════════════════════════ */}
      {showTemplates && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, background: 'var(--bg-modal-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowTemplates(false)}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '80vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease', padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>選擇範本</h3>
              <button onClick={() => setShowTemplates(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              {DRIP_TEMPLATES.map(tmpl => {
                const triggerInfo = TRIGGER_TYPES.find(t => t.id === tmpl.trigger)
                return (
                  <div key={tmpl.id} style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 16, background: 'var(--bg-primary)', transition: 'all 0.15s', cursor: 'pointer' }}
                    onClick={() => applyTemplate(tmpl)}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{triggerInfo?.icon || '📧'}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{tmpl.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>{tmpl.description}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className="badge badge-info" style={{ fontSize: 10 }}>{triggerInfo?.name}</span>
                      <span className="badge badge-success" style={{ fontSize: 10 }}>{tmpl.steps.length} 步驟</span>
                    </div>
                    <button className="btn btn-primary" style={{ width: '100%', marginTop: 10, fontSize: 12 }}>使用此範本</button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* ANALYTICS MODAL                            */}
      {/* ══════════════════════════════════════════ */}
      {showAnalytics && analyticsCampaign && analyticsMetrics && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-modal-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAnalytics(false)}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease', padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{analyticsCampaign.name} — 分析</h3>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{analyticsCampaign.description}</p>
              </div>
              <button onClick={() => setShowAnalytics(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>

            {/* Funnel */}
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>轉換漏斗</h4>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, height: 160 }}>
                {[
                  { label: '已發送', value: analyticsMetrics.sent, color: '#94a3b8' },
                  { label: '已送達', value: analyticsMetrics.delivered, color: '#60a5fa' },
                  { label: '已開啟', value: analyticsMetrics.opened, color: '#34d399' },
                  { label: '已點擊', value: analyticsMetrics.clicked, color: '#fbbf24' },
                  { label: '已轉換', value: analyticsMetrics.converted, color: '#f472b6' },
                ].map((item, i) => {
                  const maxVal = analyticsMetrics.sent || 1
                  const pct = Math.max((item.value / maxVal) * 100, 8)
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{item.value}</div>
                      <div style={{ width: '70%', height: `${pct}%`, minHeight: 12, background: item.color, borderRadius: '6px 6px 0 0', transition: 'height 0.5s' }} />
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 4 }}>{item.label}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Key Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
              <div className="stat-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>開信率</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{analyticsMetrics.open_rate}%</div>
              </div>
              <div className="stat-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>點擊率</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>{analyticsMetrics.click_rate}%</div>
              </div>
              <div className="stat-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>轉換率</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#ec4899' }}>{analyticsMetrics.conversion_rate}%</div>
              </div>
              <div className="stat-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>歸因營收</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(analyticsMetrics.revenue_attributed)}</div>
              </div>
            </div>

            {/* Per-step breakdown */}
            {analyticsMetrics.step_metrics.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>各步驟績效</h4>
                <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>步驟</th>
                      <th>類型</th>
                      <th>主旨</th>
                      <th>發送</th>
                      <th>開啟</th>
                      <th>點擊</th>
                      <th>開信率</th>
                      <th>點擊率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsMetrics.step_metrics.map((sm, i) => (
                      <tr key={i}>
                        <td>#{sm.step_index + 1}</td>
                        <td>{sm.step_type || '-'}</td>
                        <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sm.subject || '-'}</td>
                        <td>{sm.sent}</td>
                        <td>{sm.opened}</td>
                        <td>{sm.clicked}</td>
                        <td><span className={`badge ${sm.open_rate > 40 ? 'badge-success' : sm.open_rate > 20 ? 'badge-warning' : 'badge-danger'}`}>{sm.open_rate}%</span></td>
                        <td><span className={`badge ${sm.click_rate > 20 ? 'badge-success' : sm.click_rate > 10 ? 'badge-warning' : 'badge-danger'}`}>{sm.click_rate}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Extra metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <div style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>退訂率</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>{analyticsMetrics.unsubscribe_rate}%</div>
              </div>
              <div style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>退信率</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>{analyticsMetrics.bounce_rate}%</div>
              </div>
              <div style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>平均每筆轉換營收</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(analyticsMetrics.avg_revenue_per_conversion)}</div>
              </div>
            </div>

            <div style={{ textAlign: 'right', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowAnalytics(false)}>關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
