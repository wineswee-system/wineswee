import React, { useState, useEffect, useMemo } from 'react'
import {
  Plus, Send, Eye, BarChart3, Copy, Zap, CheckCircle, Clock, AlertCircle,
  Target, Users, Filter, Trash2, MousePointerClick, Mail, MailX, TrendingUp,
  FlaskConical, Award, XCircle, RefreshCw, List
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  sendBulkEmail, sendLINEMessage, sendSMS, createCampaign, MESSAGE_TEMPLATES,
  getChannels, isChannelConfigured, sendCampaignMessages, getMessageHistory
} from '../../lib/messaging'
import {
  isUnsubscribed, createUnsubscribeRecord, filterUnsubscribed,
  evaluateSegment, PRESET_SEGMENTS, SEGMENT_OPERATORS, CUSTOMER_FIELDS,
  generateTrackingPixel, generateTrackedLink, calculateEmailMetrics,
} from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const CAMPAIGN_TYPES = ['Email', 'LINE 訊息', 'SMS 簡訊']
const TYPE_MAP = { 'Email': 'email', 'LINE 訊息': 'line', 'SMS 簡訊': 'sms' }
const STATUSES = ['草稿', '排程中', '發送中', '已完成', '已取消']
const TABS = [
  { key: 'campaigns', label: '📣 行銷活動' },
  { key: 'segments', label: '🎯 受眾分群' },
  { key: 'tracking', label: '📊 追蹤分析' },
  { key: 'unsubscribe', label: '🚫 退訂管理' },
]

const STATUS_BADGE = {
  '草稿': 'badge-neutral',
  '排程中': 'badge-warning',
  '發送中': 'badge-info',
  '已完成': 'badge-success',
  '已取消': 'badge-neutral',
}

const STATUS_ICON = {
  '草稿': <AlertCircle size={12} />,
  '排程中': <Clock size={12} />,
  '發送中': <Send size={12} />,
  '已完成': <CheckCircle size={12} />,
  '已取消': <AlertCircle size={12} />,
}

// Simulated full customer list (with IDs for unsubscribe)
const ALL_CUSTOMERS = [
  { id: 'C001', name: '王小明', email: 'wang@example.com', phone: '0912345678', lineUserId: 'U001', status: '活躍', tags: 'VIP', total_spent: 150000, last_purchase: '2025-12-01', birth_month: 4, created_at: '2024-01-15' },
  { id: 'C002', name: '李大華', email: 'lee@example.com', phone: '0923456789', lineUserId: 'U002', status: '活躍', tags: 'VIP', total_spent: 120000, last_purchase: '2026-01-10', birth_month: 7, created_at: '2024-03-20' },
  { id: 'C003', name: '陳美麗', email: 'chen@example.com', phone: '0934567890', lineUserId: 'U003', status: '潛在', tags: '', total_spent: 30000, last_purchase: '2025-06-15', birth_month: 4, created_at: '2025-11-01' },
  { id: 'C004', name: '張志偉', email: 'zhang@example.com', phone: '0945678901', lineUserId: 'U004', status: '潛在', tags: '', total_spent: 45000, last_purchase: '2025-10-20', birth_month: 4, created_at: '2025-08-10' },
  { id: 'C005', name: '林雅芳', email: 'lin@example.com', phone: '0956789012', lineUserId: 'U005', status: '冷凍', tags: '', total_spent: 18000, last_purchase: '2025-03-01', birth_month: 12, created_at: '2024-06-05' },
  { id: 'C006', name: '黃志明', email: 'huang@example.com', phone: '0967890123', lineUserId: 'U006', status: '活躍', tags: '', total_spent: 72000, last_purchase: '2026-03-20', birth_month: 9, created_at: '2025-02-14' },
  { id: 'C007', name: '吳佳蓉', email: 'wu@example.com', phone: '0978901234', lineUserId: 'U007', status: '流失', tags: '', total_spent: 8000, last_purchase: '2024-08-01', birth_month: 1, created_at: '2024-05-01' },
  { id: 'C008', name: '劉建宏', email: 'liu@example.com', phone: '0989012345', lineUserId: 'U008', status: '活躍', tags: 'VIP', total_spent: 210000, last_purchase: '2026-03-28', birth_month: 6, created_at: '2023-11-30' },
]

// Simulated tracking events per campaign
function generateTrackingEvents(campaignId, recipients) {
  const events = []
  const ts = () => new Date(Date.now() - Math.random() * 86400000 * 3).toISOString()
  for (const r of recipients) {
    events.push({ type: 'sent', campaign_id: campaignId, recipient_id: r.id, recipient_name: r.name, timestamp: ts() })
    if (Math.random() > 0.08) {
      events.push({ type: 'delivered', campaign_id: campaignId, recipient_id: r.id, recipient_name: r.name, timestamp: ts() })
      if (Math.random() > 0.4) {
        events.push({ type: 'opened', campaign_id: campaignId, recipient_id: r.id, recipient_name: r.name, timestamp: ts() })
        if (Math.random() > 0.5) {
          events.push({ type: 'clicked', campaign_id: campaignId, recipient_id: r.id, recipient_name: r.name, timestamp: ts(), url: 'https://shop.example.com/promo' })
        }
      }
      if (Math.random() > 0.95) {
        events.push({ type: 'unsubscribed', campaign_id: campaignId, recipient_id: r.id, recipient_name: r.name, timestamp: ts() })
      }
    } else {
      events.push({ type: 'bounced', campaign_id: campaignId, recipient_id: r.id, recipient_name: r.name, timestamp: ts(), reason: '信箱不存在' })
    }
  }
  return events
}

const EVENT_TYPE_LABEL = {
  'sent': { label: '已發送', color: 'var(--accent-blue)' },
  'delivered': { label: '已送達', color: 'var(--accent-cyan)' },
  'opened': { label: '已開啟', color: 'var(--accent-green)' },
  'clicked': { label: '已點擊', color: 'var(--accent-purple)' },
  'bounced': { label: '退信', color: 'var(--accent-red)' },
  'unsubscribed': { label: '退訂', color: 'var(--accent-orange)' },
}

export default function Marketing() {
  const [activeTab, setActiveTab] = useState('campaigns')
  const [campaigns, setCampaigns] = useState([])
  const [locations, setLocations] = useState([])
  const [locFilter, setLocFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [sendResult, setSendResult] = useState(null)
  const [sending, setSending] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [form, setForm] = useState({
    name: '', type: 'Email', segment: 'all', message: '',
    subject: '', scheduled_at: '', status: '草稿', location_id: '',
    abTest: false, subjectB: '', messageB: '',
  })

  // Unsubscribe management
  const [unsubscribeList, setUnsubscribeList] = useState([
    { id: 'UNSUB-1', customer_id: 'C007', channel: 'email', reason: '不想再收到信件', created_at: '2026-02-10T08:00:00Z' },
    { id: 'UNSUB-2', customer_id: 'C005', channel: 'sms', reason: '簡訊太多', created_at: '2026-03-01T10:00:00Z' },
  ])
  const [unsubForm, setUnsubForm] = useState({ customer_id: '', channel: 'email', reason: '' })
  const [showUnsubModal, setShowUnsubModal] = useState(false)

  // Dynamic Segments
  const [customSegments, setCustomSegments] = useState([])
  const [segmentBuilder, setSegmentBuilder] = useState({ name: '', logic: 'and', conditions: [{ field: 'status', operator: 'eq', value: '' }] })
  const [showSegmentModal, setShowSegmentModal] = useState(false)

  // Tracking
  const [campaignEvents, setCampaignEvents] = useState({})
  const [selectedTrackingCampaign, setSelectedTrackingCampaign] = useState(null)
  const [showEventLog, setShowEventLog] = useState(false)

  // Message log per campaign
  const [campaignMessageLogs, setCampaignMessageLogs] = useState({})
  const [expandedLogCampaign, setExpandedLogCampaign] = useState(null)
  const channels = getChannels()

  useEffect(() => {
    Promise.all([
      supabase.from('marketing_campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('locations').select('*'),
    ]).then(([c, l]) => {
      const campData = c.data || []
      setCampaigns(campData)
      setLocations(l.data || [])
      // Generate simulated tracking events for completed campaigns
      const eventsMap = {}
      campData.filter(cp => cp.status === '已完成').forEach(cp => {
        const recipientCount = cp.sent_count || 3
        const simRecipients = ALL_CUSTOMERS.slice(0, Math.min(recipientCount, ALL_CUSTOMERS.length))
        eventsMap[cp.id] = generateTrackingEvents(cp.id, simRecipients)
      })
      setCampaignEvents(eventsMap)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // All segments: preset + custom
  const allSegments = useMemo(() => {
    const segs = Object.entries(PRESET_SEGMENTS).map(([key, seg]) => ({
      key, ...seg, isPreset: true,
    }))
    customSegments.forEach(cs => segs.push({ ...cs, isPreset: false }))
    return segs
  }, [customSegments])

  // Evaluate segment preview against ALL_CUSTOMERS
  const getSegmentRecipients = (segmentKey) => {
    const seg = allSegments.find(s => s.key === segmentKey)
    if (!seg) return ALL_CUSTOMERS
    if (seg.conditions.length === 0) return ALL_CUSTOMERS
    return evaluateSegment(ALL_CUSTOMERS, { logic: seg.logic, conditions: seg.conditions })
  }

  const segmentPreviewCount = useMemo(() => {
    return getSegmentRecipients(form.segment).length
  }, [form.segment, allSegments])

  const handleTemplateChange = (templateKey) => {
    setSelectedTemplate(templateKey)
    if (templateKey && MESSAGE_TEMPLATES[templateKey]) {
      const tmpl = MESSAGE_TEMPLATES[templateKey]
      const type = form.type
      let message = tmpl.body
      if (type === 'LINE 訊息') message = tmpl.line_text || tmpl.body
      if (type === 'SMS 簡訊') message = tmpl.sms_text || tmpl.body
      setForm(f => ({ ...f, message, subject: tmpl.subject || '' }))
    }
  }

  const handleTypeChange = (type) => {
    set('type', type)
    if (selectedTemplate && MESSAGE_TEMPLATES[selectedTemplate]) {
      const tmpl = MESSAGE_TEMPLATES[selectedTemplate]
      let message = tmpl.body
      if (type === 'LINE 訊息') message = tmpl.line_text || tmpl.body
      if (type === 'SMS 簡訊') message = tmpl.sms_text || tmpl.body
      setForm(f => ({ ...f, type, message, subject: tmpl.subject || '' }))
    }
  }

  const handleSubmit = async () => {
    if (!form.name || !form.message) return
    try {
      const segLabel = allSegments.find(s => s.key === form.segment)?.label || form.segment
      const payload = {
        name: form.name,
        type: form.type,
        segment: segLabel,
        message: form.message,
        scheduled_at: form.scheduled_at || null,
        status: form.status,
        location_id: form.location_id || null,
        sent_count: 0,
      }
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .insert(payload)
        .select().single()
      if (error) throw error
      if (data) {
        // Store A/B test info locally
        if (form.abTest) {
          data._abTest = { subjectB: form.subjectB, messageB: form.messageB }
        }
        data._segmentKey = form.segment
        setCampaigns(prev => [data, ...prev])
        setShowModal(false)
        resetForm()
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const resetForm = () => {
    setForm({
      name: '', type: 'Email', segment: 'all', message: '',
      subject: '', scheduled_at: '', status: '草稿', location_id: '',
      abTest: false, subjectB: '', messageB: '',
    })
    setSelectedTemplate('')
  }

  const updateStatus = async (id, status) => {
    try {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .update({ status })
        .eq('id', id).select().single()
      if (error) throw error
      if (data) setCampaigns(prev => prev.map(c => c.id === id ? data : c))
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleSendCampaign = async (campaign) => {
    const segKey = campaign._segmentKey || 'all'
    let recipients = getSegmentRecipients(segKey)
    const channelType = TYPE_MAP[campaign.type] || 'email'

    // Filter out unsubscribed recipients
    const filteredRecipients = filterUnsubscribed(recipients, unsubscribeList, channelType)
    const unsubCount = recipients.length - filteredRecipients.length

    if (!confirm(
      `確定要立即發送「${campaign.name}」嗎？\n目標受眾：${campaign.segment}\n發送類型：${campaign.type}\n收件人數：${filteredRecipients.length} 人` +
      (unsubCount > 0 ? `\n（已排除 ${unsubCount} 位退訂用戶）` : '')
    )) return

    setSending(true)
    recipients = filteredRecipients

    try {
      await supabase.from('marketing_campaigns')
        .update({ status: '發送中' })
        .eq('id', campaign.id)
      setCampaigns(prev => prev.map(c => c.id === campaign.id ? { ...c, status: '發送中' } : c))
    } catch (e) { /* continue */ }

    await new Promise(resolve => setTimeout(resolve, 800))

    let result = {
      total: recipients.length, sent: 0, failed: 0,
      channel: campaign.type, campaignName: campaign.name,
      unsubFiltered: unsubCount,
    }

    // A/B Test handling
    const isAB = !!campaign._abTest
    let groupA = recipients
    let groupB = []
    if (isAB) {
      const mid = Math.ceil(recipients.length / 2)
      groupA = recipients.slice(0, mid)
      groupB = recipients.slice(mid)
    }

    try {
      const sendGroup = async (group, message, subject) => {
        let sent = 0, failed = 0
        if (channelType === 'email') {
          // Generate tracking for each recipient
          group.forEach(r => {
            generateTrackingPixel(campaign.id, r.id)
            generateTrackedLink('https://shop.example.com/promo', campaign.id, r.id)
          })
          const bulkResult = sendBulkEmail(group, message, {
            subject: subject || campaign.name,
            companyName: '我的企業',
          })
          sent = bulkResult.sent
          failed = bulkResult.failed
        } else if (channelType === 'line') {
          for (const r of group) {
            const res = sendLINEMessage(r.lineUserId, message)
            if (res.success) sent++; else failed++
          }
        } else if (channelType === 'sms') {
          for (const r of group) {
            const res = sendSMS(r.phone, message)
            if (res.success) sent++; else failed++
          }
        }
        return { sent, failed }
      }

      const resA = await sendGroup(groupA, campaign.message, form.subject || campaign.name)
      result.sent += resA.sent
      result.failed += resA.failed

      let abResult = null
      if (isAB && groupB.length > 0) {
        const resB = await sendGroup(groupB, campaign._abTest.messageB || campaign.message, campaign._abTest.subjectB || campaign.name)
        result.sent += resB.sent
        result.failed += resB.failed
        // Simulate open rates for A/B comparison
        const openRateA = Math.floor(30 + Math.random() * 45)
        const openRateB = Math.floor(30 + Math.random() * 45)
        abResult = {
          groupASize: groupA.length,
          groupBSize: groupB.length,
          subjectA: form.subject || campaign.name,
          subjectB: campaign._abTest.subjectB || campaign.name,
          openRateA,
          openRateB,
          winner: openRateA >= openRateB ? 'A' : 'B',
        }
      }

      // Log to message_logs table via abstraction layer
      try {
        const logResult = await sendCampaignMessages(
          channelType,
          recipients,
          form.subject || campaign.name,
          campaign.message,
          campaign.id
        )
        setCampaignMessageLogs(prev => ({ ...prev, [campaign.id]: logResult.results }))
      } catch (logErr) {
        console.warn('Message log write failed (non-blocking):', logErr)
      }

      // Generate real tracking events
      const events = generateTrackingEvents(campaign.id, recipients)
      setCampaignEvents(prev => ({ ...prev, [campaign.id]: events }))
      const metrics = calculateEmailMetrics(events)

      result.delivered = metrics.delivered
      result.openRate = metrics.openRate
      result.clickRate = metrics.clickRate
      result.bounceRate = metrics.bounceRate
      result.unsubRate = metrics.unsubRate
      result.metrics = metrics
      result.abResult = abResult

      const newStatus = '已完成'
      const { data } = await supabase.from('marketing_campaigns')
        .update({ status: newStatus, sent_count: result.sent })
        .eq('id', campaign.id)
        .select().single()
      if (data) {
        data._abTest = campaign._abTest
        data._segmentKey = campaign._segmentKey
        setCampaigns(prev => prev.map(c => c.id === campaign.id ? data : c))
      }

      setSendResult(result)
      setShowResultModal(true)
    } catch (err) {
      console.error('Send failed:', err)
      alert('發送失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSending(false)
    }
  }

  // --- Segment Builder ---
  const addCondition = () => {
    setSegmentBuilder(prev => ({
      ...prev,
      conditions: [...prev.conditions, { field: 'status', operator: 'eq', value: '' }],
    }))
  }
  const removeCondition = (idx) => {
    setSegmentBuilder(prev => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== idx),
    }))
  }
  const updateCondition = (idx, key, val) => {
    setSegmentBuilder(prev => ({
      ...prev,
      conditions: prev.conditions.map((c, i) => i === idx ? { ...c, [key]: val } : c),
    }))
  }
  const segmentPreview = useMemo(() => {
    if (segmentBuilder.conditions.length === 0) return ALL_CUSTOMERS
    const validConditions = segmentBuilder.conditions.filter(c => c.value !== '' || c.operator === 'is_empty' || c.operator === 'is_not_empty')
    if (validConditions.length === 0) return ALL_CUSTOMERS
    return evaluateSegment(ALL_CUSTOMERS, { logic: segmentBuilder.logic, conditions: validConditions })
  }, [segmentBuilder])

  const saveSegment = () => {
    if (!segmentBuilder.name.trim()) { alert('請輸入分群名稱'); return }
    const key = `custom_${Date.now()}`
    setCustomSegments(prev => [...prev, {
      key,
      label: segmentBuilder.name,
      logic: segmentBuilder.logic,
      conditions: segmentBuilder.conditions.filter(c => c.value !== '' || c.operator === 'is_empty' || c.operator === 'is_not_empty'),
    }])
    setSegmentBuilder({ name: '', logic: 'and', conditions: [{ field: 'status', operator: 'eq', value: '' }] })
    setShowSegmentModal(false)
  }
  const deleteSegment = (key) => {
    setCustomSegments(prev => prev.filter(s => s.key !== key))
  }

  // --- Unsubscribe Management ---
  const handleAddUnsub = () => {
    if (!unsubForm.customer_id) return
    const record = createUnsubscribeRecord(unsubForm.customer_id, unsubForm.channel, unsubForm.reason)
    setUnsubscribeList(prev => [...prev, record])
    setUnsubForm({ customer_id: '', channel: 'email', reason: '' })
    setShowUnsubModal(false)
  }
  const handleRemoveUnsub = (id) => {
    setUnsubscribeList(prev => prev.filter(u => u.id !== id))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = campaigns.filter(c => locFilter === '' || String(c.location_id) === locFilter)
  const filterBtnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  const tabStyle = (active) => ({
    padding: '8px 18px', borderRadius: 8, border: active ? '2px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
    color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
  })

  const AUTO_RULES = [
    { icon: '🎂', title: '生日關懷', desc: '客戶生日當天自動發送祝福與優惠券', trigger: '生日當天', channel: 'LINE/SMS', status: '啟用' },
    { icon: '😴', title: '喚醒沉睡客戶', desc: '半年未下單客戶自動發送促銷簡訊', trigger: '180天未購', channel: 'SMS', status: '啟用' },
    { icon: '🎉', title: '節日問候', desc: '農曆新年、中秋節自動發送祝福', trigger: '節日前3天', channel: 'LINE', status: '啟用' },
    { icon: '📧', title: 'EDM 未開信追蹤', desc: '3天內未開信的客戶標記為高意向，提醒業務致電', trigger: '3天未開', channel: 'Email', status: '啟用' },
    { icon: '🛒', title: '報價後追蹤', desc: '報價後7天無回應自動發提醒', trigger: '報價後7天', channel: 'LINE', status: '停用' },
  ]

  const totalSent = filtered.reduce((sum, c) => sum + (c.sent_count || 0), 0)

  // Tracking: get metrics for selected campaign
  const trackingCampaigns = filtered.filter(c => c.status === '已完成' && campaignEvents[c.id])
  const selectedEvents = selectedTrackingCampaign ? (campaignEvents[selectedTrackingCampaign] || []) : []
  const selectedMetrics = selectedEvents.length > 0 ? calculateEmailMetrics(selectedEvents) : null

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon">📣</span> 行銷自動化</h2><p>分群發送、追蹤分析、A/B 測試與退訂管理</p></div>
          {activeTab === 'campaigns' && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增行銷活動</button>
          )}
          {activeTab === 'segments' && (
            <button className="btn btn-primary" onClick={() => setShowSegmentModal(true)}><Plus size={14} /> 建立自訂分群</button>
          )}
          {activeTab === 'unsubscribe' && (
            <button className="btn btn-primary" onClick={() => setShowUnsubModal(true)}><Plus size={14} /> 新增退訂</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button key={tab.key} style={tabStyle(activeTab === tab.key)} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== TAB: CAMPAIGNS ==================== */}
      {activeTab === 'campaigns' && (
        <>
          {/* Location Filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button style={filterBtnStyle(locFilter === '')} onClick={() => setLocFilter('')}>全部分店</button>
            {locations.map(l => (
              <button key={l.id} style={filterBtnStyle(locFilter === String(l.id))} onClick={() => setLocFilter(String(l.id))}>{l.name}</button>
            ))}
          </div>

          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">行銷活動總數</div><div className="stat-card-value">{filtered.length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">已完成</div><div className="stat-card-value">{filtered.filter(c => c.status === '已完成').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">排程中</div><div className="stat-card-value">{filtered.filter(c => c.status === '排程中').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">總發送數</div><div className="stat-card-value">{totalSent}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">自動化規則</div><div className="stat-card-value">{AUTO_RULES.filter(r => r.status === '啟用').length}</div>
            </div>
          </div>

          {/* Automation Rules */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><Zap size={16} /></span> 自動化規則</div>
              <span className="badge badge-success"><span className="badge-dot"></span>系統自動執行</span>
            </div>
            <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {AUTO_RULES.map((rule, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 22 }}>{rule.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{rule.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rule.desc}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>觸發：{rule.trigger}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-card)', padding: '2px 8px', borderRadius: 6 }}>{rule.channel}</span>
                    <span className={`badge ${rule.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}><span className="badge-dot"></span>{rule.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Campaign List */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><BarChart3 size={16} /></span> 行銷活動列表</div>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>活動名稱</th><th>分店</th><th>類型</th><th>目標受眾</th><th>預計發送時間</th><th>已發送數</th><th>狀態</th><th>操作</th></tr></thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無行銷活動</td></tr>}
                  {filtered.map(c => {
                    const chType = TYPE_MAP[c.type] || 'email'
                    const chConfigured = isChannelConfigured(chType)
                    const logs = campaignMessageLogs[c.id] || []
                    return (
                      <React.Fragment key={c.id}>
                        <tr>
                          <td style={{ fontWeight: 600 }}>
                            {c.name}
                            {c._abTest && <span className="badge badge-info" style={{ marginLeft: 6, fontSize: 10 }}>A/B</span>}
                          </td>
                          <td style={{ fontSize: 12 }}>{locations.find(l => l.id === c.location_id)?.name || '-'}</td>
                          <td style={{ fontSize: 12 }}>
                            {c.type}
                            <span className={`badge ${chConfigured ? 'badge-success' : 'badge-info'}`} style={{ marginLeft: 6, fontSize: 9 }}>
                              <span className="badge-dot"></span>{chConfigured ? '已設定' : '模擬模式'}
                            </span>
                          </td>
                          <td><span style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 11 }}>{c.segment}</span></td>
                          <td style={{ fontSize: 12 }}>{c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('zh-TW') : '-'}</td>
                          <td style={{ fontWeight: 700 }}>{c.sent_count || 0}</td>
                          <td>
                            <span className={`badge ${STATUS_BADGE[c.status] || 'badge-neutral'}`}>
                              <span className="badge-dot"></span>
                              {STATUS_ICON[c.status]} {c.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {(c.status === '草稿' || c.status === '排程中') && (
                                <button
                                  className="btn btn-primary"
                                  style={{ fontSize: 11, padding: '3px 10px' }}
                                  disabled={sending}
                                  onClick={() => handleSendCampaign(c)}
                                >
                                  <Send size={11} /> 發送活動
                                </button>
                              )}
                              {c.status === '草稿' && (
                                <button
                                  className="btn"
                                  style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', border: '1px solid var(--accent-orange)' }}
                                  onClick={() => updateStatus(c.id, '排程中')}
                                >
                                  <Clock size={11} /> 排程
                                </button>
                              )}
                              {c.status === '已完成' && logs.length > 0 && (
                                <button
                                  className="btn"
                                  style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', border: '1px solid var(--accent-blue)' }}
                                  onClick={() => setExpandedLogCampaign(expandedLogCampaign === c.id ? null : c.id)}
                                >
                                  <List size={11} /> 發送紀錄 ({logs.length})
                                </button>
                              )}
                              {c.status !== '已取消' && c.status !== '已完成' && (
                                <button
                                  className="btn"
                                  style={{ fontSize: 11, padding: '3px 10px', background: 'var(--glass-light)', color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}
                                  onClick={() => updateStatus(c.id, '已取消')}
                                >
                                  取消
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedLogCampaign === c.id && logs.length > 0 && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0 }}>
                              <div style={{ padding: '12px 16px', background: 'var(--glass-light)', borderTop: '1px solid var(--border-subtle)' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>
                                  發送紀錄 ({logs.length} 筆)
                                </div>
                                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}>通道</th>
                                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}>收件人</th>
                                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}>狀態</th>
                                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}>時間</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {logs.map((log, idx) => (
                                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                        <td style={{ padding: '4px 8px' }}>{log.channel || chType}</td>
                                        <td style={{ padding: '4px 8px' }}>{log.recipient || '-'}</td>
                                        <td style={{ padding: '4px 8px' }}>
                                          <span className={`badge ${log.status === 'sent' ? 'badge-success' : log.status === 'simulated' ? 'badge-info' : log.status === 'failed' ? 'badge-error' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                                            <span className="badge-dot"></span>
                                            {log.status === 'sent' ? '已發送' : log.status === 'simulated' ? '模擬' : log.status === 'failed' ? '失敗' : '排隊中'}
                                          </span>
                                        </td>
                                        <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{log.sent_at ? new Date(log.sent_at).toLocaleString('zh-TW') : '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
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
        </>
      )}

      {/* ==================== TAB: SEGMENTS ==================== */}
      {activeTab === 'segments' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">預設分群</div><div className="stat-card-value">{Object.keys(PRESET_SEGMENTS).length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">自訂分群</div><div className="stat-card-value">{customSegments.length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">客戶總數</div><div className="stat-card-value">{ALL_CUSTOMERS.length}</div>
            </div>
          </div>

          {/* Preset Segments */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><Target size={16} /></span> 預設分群</div>
            </div>
            <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {Object.entries(PRESET_SEGMENTS).map(([key, seg]) => {
                const count = evaluateSegment(ALL_CUSTOMERS, seg).length
                return (
                  <div key={key} style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{seg.label}</div>
                      <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-cyan)' }}>{count}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {seg.conditions.length === 0 ? '所有客戶' : seg.conditions.map(c => {
                        const fieldLabel = CUSTOMER_FIELDS.find(f => f.value === c.field)?.label || c.field
                        const opLabel = SEGMENT_OPERATORS.find(o => o.value === c.operator)?.label || c.operator
                        return `${fieldLabel} ${opLabel} ${c.value}`
                      }).join(` ${seg.logic === 'and' ? '且' : '或'} `)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Custom Segments */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><Filter size={16} /></span> 自訂分群</div>
            </div>
            {customSegments.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                尚無自訂分群，點擊「建立自訂分群」開始建立
              </div>
            ) : (
              <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {customSegments.map(seg => {
                  const count = evaluateSegment(ALL_CUSTOMERS, { logic: seg.logic, conditions: seg.conditions }).length
                  return (
                    <div key={seg.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{seg.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          邏輯：{seg.logic === 'and' ? '全部符合 (AND)' : '任一符合 (OR)'} | 條件：{seg.conditions.length} 個
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {seg.conditions.map(c => {
                            const fl = CUSTOMER_FIELDS.find(f => f.value === c.field)?.label || c.field
                            const ol = SEGMENT_OPERATORS.find(o => o.value === c.operator)?.label || c.operator
                            return `${fl} ${ol} ${c.value}`
                          }).join(` ${seg.logic === 'and' ? '且' : '或'} `)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-purple)' }}>{count} 人</span>
                        <button className="btn" style={{ fontSize: 11, padding: '4px 8px', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }} onClick={() => deleteSegment(seg.key)}>
                          <Trash2 size={11} /> 刪除
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ==================== TAB: TRACKING ==================== */}
      {activeTab === 'tracking' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">已追蹤活動</div><div className="stat-card-value">{trackingCampaigns.length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">總追蹤事件</div><div className="stat-card-value">{Object.values(campaignEvents).reduce((s, e) => s + e.length, 0)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">退訂人數</div><div className="stat-card-value">{unsubscribeList.length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">總退信數</div>
              <div className="stat-card-value">
                {Object.values(campaignEvents).reduce((s, evts) => s + evts.filter(e => e.type === 'bounced').length, 0)}
              </div>
            </div>
          </div>

          {/* Campaign selector */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><BarChart3 size={16} /></span> 選擇活動查看追蹤</div>
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              <select className="form-input" style={{ width: '100%', maxWidth: 400 }} value={selectedTrackingCampaign || ''} onChange={e => { setSelectedTrackingCampaign(e.target.value || null); setShowEventLog(false) }}>
                <option value="">-- 請選擇已完成的活動 --</option>
                {trackingCampaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                ))}
              </select>
            </div>
          </div>

          {selectedMetrics && (
            <>
              {/* Metrics Cards */}
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: 16 }}>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
                  <div className="stat-card-label"><Send size={12} /> 已發送</div><div className="stat-card-value">{selectedMetrics.sent}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                  <div className="stat-card-label"><Mail size={12} /> 已送達</div><div className="stat-card-value">{selectedMetrics.delivered}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.deliveryRate}%</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                  <div className="stat-card-label"><Eye size={12} /> 已開啟</div><div className="stat-card-value">{selectedMetrics.opened}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.openRate}%</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
                  <div className="stat-card-label"><MousePointerClick size={12} /> 已點擊</div><div className="stat-card-value">{selectedMetrics.clicked}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.clickRate}%</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
                  <div className="stat-card-label"><XCircle size={12} /> 退信</div><div className="stat-card-value">{selectedMetrics.bounced}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.bounceRate}%</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                  <div className="stat-card-label"><MailX size={12} /> 退訂</div><div className="stat-card-value">{selectedMetrics.unsubscribed}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.unsubRate}%</div>
                </div>
              </div>

              {/* Visual bar chart */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div className="card-title"><span className="card-title-icon"><TrendingUp size={16} /></span> 漏斗分析</div>
                </div>
                <div style={{ padding: '0 16px 16px' }}>
                  {[
                    { label: '已發送', value: selectedMetrics.sent, color: 'var(--accent-blue)' },
                    { label: '已送達', value: selectedMetrics.delivered, color: 'var(--accent-cyan)' },
                    { label: '已開啟', value: selectedMetrics.opened, color: 'var(--accent-green)' },
                    { label: '已點擊', value: selectedMetrics.clicked, color: 'var(--accent-purple)' },
                  ].map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <div style={{ width: 60, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{item.label}</div>
                      <div style={{ flex: 1, height: 24, background: 'var(--glass-light)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{
                          width: `${selectedMetrics.sent > 0 ? (item.value / selectedMetrics.sent) * 100 : 0}%`,
                          height: '100%', background: item.color, borderRadius: 6,
                          transition: 'width 0.5s ease', minWidth: item.value > 0 ? 20 : 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
                        }}>
                          <span style={{ fontSize: 11, color: '#fff', fontWeight: 700 }}>{item.value}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Event Log Toggle */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title"><span className="card-title-icon"><List size={16} /></span> 追蹤事件明細</div>
                  <button className="btn" style={{ fontSize: 11, padding: '4px 12px', background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)' }} onClick={() => setShowEventLog(!showEventLog)}>
                    {showEventLog ? '收合' : '展開'} ({selectedEvents.length} 筆)
                  </button>
                </div>
                {showEventLog && (
                  <div className="data-table-wrapper">
                    <table className="data-table">
                      <thead><tr><th>時間</th><th>收件人</th><th>事件類型</th><th>詳情</th></tr></thead>
                      <tbody>
                        {selectedEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((evt, i) => {
                          const meta = EVENT_TYPE_LABEL[evt.type] || { label: evt.type, color: 'var(--text-muted)' }
                          return (
                            <tr key={i}>
                              <td style={{ fontSize: 11 }}>{new Date(evt.timestamp).toLocaleString('zh-TW')}</td>
                              <td style={{ fontSize: 12 }}>{evt.recipient_name || evt.recipient_id}</td>
                              <td>
                                <span style={{ padding: '2px 8px', borderRadius: 6, background: `${meta.color}22`, color: meta.color, fontSize: 11, fontWeight: 600 }}>
                                  {meta.label}
                                </span>
                              </td>
                              <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {evt.url || evt.reason || '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {!selectedTrackingCampaign && (
            <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              <BarChart3 size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
              <p>請選擇一個已完成的活動以查看追蹤分析</p>
            </div>
          )}
        </>
      )}

      {/* ==================== TAB: UNSUBSCRIBE ==================== */}
      {activeTab === 'unsubscribe' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
              <div className="stat-card-label">退訂總數</div><div className="stat-card-value">{unsubscribeList.length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">Email 退訂</div><div className="stat-card-value">{unsubscribeList.filter(u => u.channel === 'email').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">SMS 退訂</div><div className="stat-card-value">{unsubscribeList.filter(u => u.channel === 'sms').length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">全管道退訂</div><div className="stat-card-value">{unsubscribeList.filter(u => u.channel === 'all').length}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><MailX size={16} /></span> 退訂名單</div>
              <span className="badge badge-neutral">{unsubscribeList.length} 筆</span>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>客戶</th><th>退訂管道</th><th>原因</th><th>退訂時間</th><th>操作</th></tr></thead>
                <tbody>
                  {unsubscribeList.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>目前沒有退訂紀錄</td></tr>}
                  {unsubscribeList.map(u => {
                    const customer = ALL_CUSTOMERS.find(c => c.id === u.customer_id)
                    return (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600 }}>{customer?.name || u.customer_id}</td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            background: u.channel === 'all' ? 'var(--accent-red-dim)' : 'var(--accent-orange-dim)',
                            color: u.channel === 'all' ? 'var(--accent-red)' : 'var(--accent-orange)',
                          }}>
                            {u.channel === 'all' ? '全部管道' : u.channel.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.reason || '-'}</td>
                        <td style={{ fontSize: 12 }}>{new Date(u.created_at).toLocaleString('zh-TW')}</td>
                        <td>
                          <button
                            className="btn"
                            style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-green-dim)', color: 'var(--accent-green)', border: '1px solid var(--accent-green)' }}
                            onClick={() => handleRemoveUnsub(u.id)}
                          >
                            <RefreshCw size={11} /> 恢復訂閱
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick check: show who is currently unsubscribed */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><Users size={16} /></span> 客戶退訂狀態</div>
            </div>
            <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {ALL_CUSTOMERS.map(c => {
                const emailUnsub = isUnsubscribed(unsubscribeList, c.id, 'email')
                const smsUnsub = isUnsubscribed(unsubscribeList, c.id, 'sms')
                const lineUnsub = isUnsubscribed(unsubscribeList, c.id, 'line')
                const allUnsub = isUnsubscribed(unsubscribeList, c.id, 'all')
                return (
                  <div key={c.id} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{c.name}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: (emailUnsub || allUnsub) ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)', color: (emailUnsub || allUnsub) ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                        Email {(emailUnsub || allUnsub) ? '已退訂' : '正常'}
                      </span>
                      <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: (smsUnsub || allUnsub) ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)', color: (smsUnsub || allUnsub) ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                        SMS {(smsUnsub || allUnsub) ? '已退訂' : '正常'}
                      </span>
                      <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: (lineUnsub || allUnsub) ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)', color: (lineUnsub || allUnsub) ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                        LINE {(lineUnsub || allUnsub) ? '已退訂' : '正常'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ==================== MODALS ==================== */}

      {/* New Campaign Modal */}
      {showModal && (
        <Modal title="新增行銷活動" onClose={() => { setShowModal(false); resetForm() }} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="活動名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="夏季促銷活動..." value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="所屬分店">
              <select className="form-input" style={{ width: '100%' }} value={form.location_id} onChange={e => set('location_id', e.target.value)}>
                <option value="">全部分店</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="發送類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => handleTypeChange(e.target.value)}>
                {CAMPAIGN_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="目標受眾">
              <select className="form-input" style={{ width: '100%' }} value={form.segment} onChange={e => set('segment', e.target.value)}>
                {allSegments.map(s => <option key={s.key} value={s.key}>{s.label}{s.isPreset ? '' : ' (自訂)'}</option>)}
              </select>
            </Field>
          </div>

          {/* Audience Preview */}
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', marginBottom: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              預計發送對象：<strong style={{ color: 'var(--accent-cyan)' }}>{segmentPreviewCount} 人</strong>
              {(() => {
                const channelType = TYPE_MAP[form.type] || 'email'
                const recipients = getSegmentRecipients(form.segment)
                const afterFilter = filterUnsubscribed(recipients, unsubscribeList, channelType)
                const unsubCount = recipients.length - afterFilter.length
                if (unsubCount > 0) return <span style={{ color: 'var(--accent-orange)', marginLeft: 8 }}>（排除 {unsubCount} 位退訂）</span>
                return null
              })()}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {getSegmentRecipients(form.segment).slice(0, 10).map((r, i) => {
                const channelType = TYPE_MAP[form.type] || 'email'
                const unsub = isUnsubscribed(unsubscribeList, r.id, channelType)
                return (
                  <span key={i} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: unsub ? 'var(--accent-red-dim)' : 'var(--bg-card)',
                    border: `1px solid ${unsub ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
                    color: unsub ? 'var(--accent-red)' : 'var(--text-primary)',
                    textDecoration: unsub ? 'line-through' : 'none',
                  }}>
                    {r.name}{unsub ? ' (退訂)' : ''}
                  </span>
                )
              })}
              {getSegmentRecipients(form.segment).length > 10 && (
                <span style={{ fontSize: 11, padding: '2px 8px', color: 'var(--text-muted)' }}>...還有更多</span>
              )}
            </div>
          </div>

          {/* Template Selection */}
          <Field label="訊息範本">
            <select className="form-input" style={{ width: '100%' }} value={selectedTemplate} onChange={e => handleTemplateChange(e.target.value)}>
              <option value="">自訂內容</option>
              {Object.entries(MESSAGE_TEMPLATES).map(([key, tmpl]) => (
                <option key={key} value={key}>{tmpl.name}</option>
              ))}
            </select>
          </Field>

          {form.type === 'Email' && (
            <Field label="Email 主旨">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="輸入 Email 主旨..." value={form.subject} onChange={e => set('subject', e.target.value)} />
            </Field>
          )}

          <Field label="訊息內容 *">
            <textarea
              className="form-input"
              style={{ width: '100%', minHeight: 100, fontFamily: 'monospace', fontSize: 13 }}
              placeholder={form.type === 'SMS 簡訊' ? '簡訊內容（建議 70 字以內）...' : '親愛的客戶，我們特別為您提供...'}
              value={form.message}
              onChange={e => set('message', e.target.value)}
            />
          </Field>
          {form.type === 'SMS 簡訊' && (
            <div style={{ fontSize: 11, color: form.message.length > 70 ? 'var(--accent-orange)' : 'var(--text-muted)', textAlign: 'right', marginTop: -8 }}>
              {form.message.length} / 70 字 ({Math.ceil(form.message.length / 70) || 1} 則簡訊)
            </div>
          )}

          {/* A/B Test Toggle */}
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', marginBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={form.abTest} onChange={e => set('abTest', e.target.checked)} />
              <FlaskConical size={14} /> 啟用 A/B 測試
            </label>
            {form.abTest && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                  受眾將平均分為 A/B 兩組，分別發送不同內容，比較開啟率決定贏家
                </div>
                {form.type === 'Email' && (
                  <Field label="B 版主旨">
                    <input className="form-input" type="text" style={{ width: '100%' }} placeholder="B 版 Email 主旨..." value={form.subjectB} onChange={e => set('subjectB', e.target.value)} />
                  </Field>
                )}
                <Field label="B 版訊息內容">
                  <textarea
                    className="form-input"
                    style={{ width: '100%', minHeight: 80, fontFamily: 'monospace', fontSize: 13 }}
                    placeholder="B 版訊息內容..."
                    value={form.messageB}
                    onChange={e => set('messageB', e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>

          <Field label="排程時間（留空為儲存草稿）">
            <input className="form-input" type="datetime-local" style={{ width: '100%' }} value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* Send Result Modal */}
      {showResultModal && sendResult && (
        <Modal title="發送結果" onClose={() => { setShowResultModal(false); setSendResult(null) }} onSubmit={() => { setShowResultModal(false); setSendResult(null) }}>
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>
              {sendResult.failed === 0 ? <CheckCircle size={48} style={{ color: 'var(--accent-green)' }} /> : <AlertCircle size={48} style={{ color: 'var(--accent-orange)' }} />}
            </div>
            <h3 style={{ margin: '8px 0', color: 'var(--text-primary)' }}>{sendResult.campaignName}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>管道：{sendResult.channel}</p>
            {sendResult.unsubFiltered > 0 && (
              <p style={{ color: 'var(--accent-orange)', fontSize: 12 }}>已排除 {sendResult.unsubFiltered} 位退訂用戶</p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, margin: '16px 0' }}>
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--glass-light)', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-cyan)' }}>{sendResult.total}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>總發送數</div>
            </div>
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--glass-light)', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-green)' }}>{sendResult.delivered || 0}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>成功送達</div>
            </div>
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--glass-light)', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-red)' }}>{sendResult.failed}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>發送失敗</div>
            </div>
          </div>

          {sendResult.metrics && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-green-dim)', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-green)' }}>{sendResult.openRate}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>開啟率</div>
              </div>
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-purple-dim)', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-purple)' }}>{sendResult.clickRate}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>點擊率</div>
              </div>
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-red-dim)', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-red)' }}>{sendResult.bounceRate}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>退信率</div>
              </div>
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-orange-dim)', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-orange)' }}>{sendResult.unsubRate}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>退訂率</div>
              </div>
            </div>
          )}

          {/* A/B Test Result */}
          {sendResult.abResult && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--accent-purple)', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 700, fontSize: 14, color: 'var(--accent-purple)' }}>
                <FlaskConical size={16} /> A/B 測試結果
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ padding: 10, borderRadius: 8, background: sendResult.abResult.winner === 'A' ? 'var(--accent-green-dim)' : 'var(--bg-card)', border: `1px solid ${sendResult.abResult.winner === 'A' ? 'var(--accent-green)' : 'var(--border-subtle)'}`, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    A 版 ({sendResult.abResult.groupASize} 人)
                    {sendResult.abResult.winner === 'A' && <Award size={12} style={{ marginLeft: 4, color: 'var(--accent-green)' }} />}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{sendResult.abResult.subjectA}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: sendResult.abResult.winner === 'A' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{sendResult.abResult.openRateA}%</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>開啟率</div>
                </div>
                <div style={{ padding: 10, borderRadius: 8, background: sendResult.abResult.winner === 'B' ? 'var(--accent-green-dim)' : 'var(--bg-card)', border: `1px solid ${sendResult.abResult.winner === 'B' ? 'var(--accent-green)' : 'var(--border-subtle)'}`, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    B 版 ({sendResult.abResult.groupBSize} 人)
                    {sendResult.abResult.winner === 'B' && <Award size={12} style={{ marginLeft: 4, color: 'var(--accent-green)' }} />}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{sendResult.abResult.subjectB}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: sendResult.abResult.winner === 'B' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{sendResult.abResult.openRateB}%</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>開啟率</div>
                </div>
              </div>
              <div style={{ textAlign: 'center', marginTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--accent-green)' }}>
                <Award size={14} /> 勝出：{sendResult.abResult.winner} 版（開啟率 {sendResult.abResult.winner === 'A' ? sendResult.abResult.openRateA : sendResult.abResult.openRateB}%）
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Segment Builder Modal */}
      {showSegmentModal && (
        <Modal title="建立自訂分群" onClose={() => setShowSegmentModal(false)} onSubmit={saveSegment}>
          <Field label="分群名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：高消費活躍客戶" value={segmentBuilder.name} onChange={e => setSegmentBuilder(prev => ({ ...prev, name: e.target.value }))} />
          </Field>

          <Field label="邏輯運算">
            <select className="form-input" style={{ width: '100%' }} value={segmentBuilder.logic} onChange={e => setSegmentBuilder(prev => ({ ...prev, logic: e.target.value }))}>
              <option value="and">AND - 全部條件都必須符合</option>
              <option value="or">OR - 任一條件符合即可</option>
            </select>
          </Field>

          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>篩選條件</div>
            {segmentBuilder.conditions.map((cond, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select className="form-input" style={{ flex: 1 }} value={cond.field} onChange={e => updateCondition(idx, 'field', e.target.value)}>
                  {CUSTOMER_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select className="form-input" style={{ flex: 1 }} value={cond.operator} onChange={e => updateCondition(idx, 'operator', e.target.value)}>
                  {SEGMENT_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && (
                  (() => {
                    const fieldDef = CUSTOMER_FIELDS.find(f => f.value === cond.field)
                    if (fieldDef?.type === 'select') {
                      return (
                        <select className="form-input" style={{ flex: 1 }} value={cond.value} onChange={e => updateCondition(idx, 'value', e.target.value)}>
                          <option value="">-- 選擇 --</option>
                          {fieldDef.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )
                    }
                    return (
                      <input className="form-input" type={fieldDef?.type === 'number' ? 'number' : 'text'} style={{ flex: 1 }} placeholder="值" value={cond.value} onChange={e => updateCondition(idx, 'value', fieldDef?.type === 'number' ? Number(e.target.value) : e.target.value)} />
                    )
                  })()
                )}
                <button className="btn" style={{ padding: '4px 8px', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }} onClick={() => removeCondition(idx)} disabled={segmentBuilder.conditions.length <= 1}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button className="btn" style={{ fontSize: 12, padding: '4px 12px', background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)' }} onClick={addCondition}>
              <Plus size={12} /> 新增條件
            </button>
          </div>

          {/* Segment Preview */}
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              預覽結果：<strong style={{ color: 'var(--accent-cyan)', fontSize: 16 }}>{segmentPreview.length}</strong> 位客戶符合
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {segmentPreview.slice(0, 8).map((c, i) => (
                <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                  {c.name}
                </span>
              ))}
              {segmentPreview.length > 8 && <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 4px' }}>...還有 {segmentPreview.length - 8} 位</span>}
            </div>
          </div>
        </Modal>
      )}

      {/* Add Unsubscribe Modal */}
      {showUnsubModal && (
        <Modal title="新增退訂" onClose={() => setShowUnsubModal(false)} onSubmit={handleAddUnsub}>
          <Field label="客戶 *">
            <select className="form-input" style={{ width: '100%' }} value={unsubForm.customer_id} onChange={e => setUnsubForm(prev => ({ ...prev, customer_id: e.target.value }))}>
              <option value="">-- 選擇客戶 --</option>
              {ALL_CUSTOMERS.filter(c => !isUnsubscribed(unsubscribeList, c.id, 'all')).map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </select>
          </Field>
          <Field label="退訂管道">
            <select className="form-input" style={{ width: '100%' }} value={unsubForm.channel} onChange={e => setUnsubForm(prev => ({ ...prev, channel: e.target.value }))}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="line">LINE</option>
              <option value="all">全部管道</option>
            </select>
          </Field>
          <Field label="退訂原因">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：不想再收到行銷訊息" value={unsubForm.reason} onChange={e => setUnsubForm(prev => ({ ...prev, reason: e.target.value }))} />
          </Field>
        </Modal>
      )}

      {/* Sending overlay */}
      {sending && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{ background: 'var(--bg-card)', padding: 32, borderRadius: 16, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <LoadingSpinner />
            <p style={{ marginTop: 12, color: 'var(--text-primary)', fontWeight: 600 }}>正在發送行銷訊息...</p>
          </div>
        </div>
      )}
    </div>
  )
}
