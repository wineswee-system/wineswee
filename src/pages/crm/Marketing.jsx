import React, { useState, useEffect, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  sendBulkEmail, sendLINEMessage, sendSMS,
  sendCampaignMessages, getChannels, MESSAGE_TEMPLATES,
} from '../../lib/messaging'
import {
  filterUnsubscribed, createUnsubscribeRecord,
  evaluateSegment, PRESET_SEGMENTS,
  generateTrackingPixel, generateTrackedLink, calculateEmailMetrics,
} from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import MarketingCampaignsTab from './components/MarketingCampaignsTab'
import MarketingSegmentsTab from './components/MarketingSegmentsTab'
import MarketingTrackingTab from './components/MarketingTrackingTab'
import MarketingUnsubscribeTab from './components/MarketingUnsubscribeTab'
import MarketingCampaignModal from './components/MarketingCampaignModal'
import MarketingSendResultModal from './components/MarketingSendResultModal'
import MarketingSegmentModal from './components/MarketingSegmentModal'
import MarketingUnsubscribeModal from './components/MarketingUnsubscribeModal'

const TYPE_MAP = { 'Email': 'email', 'LINE 訊息': 'line', 'SMS 簡訊': 'sms' }
const TABS = [
  { key: 'campaigns', label: '📣 行銷活動' },
  { key: 'segments', label: '🎯 受眾分群' },
  { key: 'tracking', label: '📊 追蹤分析' },
  { key: 'unsubscribe', label: '🚫 退訂管理' },
]

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
      supabase.from('stores').select('*'),
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

      {activeTab === 'campaigns' && (
        <MarketingCampaignsTab
          filtered={filtered}
          locations={locations}
          locFilter={locFilter}
          setLocFilter={setLocFilter}
          filterBtnStyle={filterBtnStyle}
          sending={sending}
          handleSendCampaign={handleSendCampaign}
          updateStatus={updateStatus}
          campaignMessageLogs={campaignMessageLogs}
          expandedLogCampaign={expandedLogCampaign}
          setExpandedLogCampaign={setExpandedLogCampaign}
        />
      )}

      {activeTab === 'segments' && (
        <MarketingSegmentsTab
          allCustomers={ALL_CUSTOMERS}
          customSegments={customSegments}
          deleteSegment={deleteSegment}
        />
      )}

      {activeTab === 'tracking' && (
        <MarketingTrackingTab
          filtered={filtered}
          campaignEvents={campaignEvents}
          unsubscribeList={unsubscribeList}
          selectedTrackingCampaign={selectedTrackingCampaign}
          setSelectedTrackingCampaign={setSelectedTrackingCampaign}
          showEventLog={showEventLog}
          setShowEventLog={setShowEventLog}
        />
      )}

      {activeTab === 'unsubscribe' && (
        <MarketingUnsubscribeTab
          allCustomers={ALL_CUSTOMERS}
          unsubscribeList={unsubscribeList}
          handleRemoveUnsub={handleRemoveUnsub}
        />
      )}

      {/* Modals */}
      {showModal && (
        <MarketingCampaignModal
          form={form}
          set={set}
          locations={locations}
          allSegments={allSegments}
          selectedTemplate={selectedTemplate}
          handleTemplateChange={handleTemplateChange}
          handleTypeChange={handleTypeChange}
          handleSubmit={handleSubmit}
          onClose={() => { setShowModal(false); resetForm() }}
          segmentPreviewCount={segmentPreviewCount}
          getSegmentRecipients={getSegmentRecipients}
          unsubscribeList={unsubscribeList}
        />
      )}

      {showResultModal && sendResult && (
        <MarketingSendResultModal
          sendResult={sendResult}
          onClose={() => { setShowResultModal(false); setSendResult(null) }}
        />
      )}

      {showSegmentModal && (
        <MarketingSegmentModal
          allCustomers={ALL_CUSTOMERS}
          segmentBuilder={segmentBuilder}
          setSegmentBuilder={setSegmentBuilder}
          addCondition={addCondition}
          removeCondition={removeCondition}
          updateCondition={updateCondition}
          saveSegment={saveSegment}
          onClose={() => setShowSegmentModal(false)}
        />
      )}

      {showUnsubModal && (
        <MarketingUnsubscribeModal
          allCustomers={ALL_CUSTOMERS}
          unsubscribeList={unsubscribeList}
          unsubForm={unsubForm}
          setUnsubForm={setUnsubForm}
          handleAddUnsub={handleAddUnsub}
          onClose={() => setShowUnsubModal(false)}
        />
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
