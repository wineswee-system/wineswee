import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, Users, Filter, Play, Zap, Sparkles, Loader, Send } from 'lucide-react'
import { getCustomerSegments, createCustomerSegment, updateCustomerSegment, deleteCustomerSegment, getMembers } from '../../lib/db'
import { PRESET_SEGMENTS, filterUnsubscribed } from '../../lib/crmEngine'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { nlToSegmentRules, isConfigured as isAIConfigured } from '../../lib/ai/crmAI'
import LoadingSpinner from '../../components/LoadingSpinner'

const FIELDS = [
  { value: 'total_spent', label: '累計消費', type: 'number' },
  { value: 'visit_count', label: '來店次數', type: 'number' },
  { value: 'available_points', label: '可用點數', type: 'number' },
  { value: 'level', label: '會員等級', type: 'select', options: ['一般', '銀卡', '金卡', 'VIP'] },
  { value: 'status', label: '狀態', type: 'select', options: ['有效', '停用', '已過期'] },
  { value: 'last_visit', label: '最後來店日', type: 'date' },
  { value: 'total_points', label: '累計點數', type: 'number' },
  { value: 'name', label: '會員姓名', type: 'text' },
]

const OPERATORS = {
  number: [
    { value: 'gte', label: '>=' },
    { value: 'lte', label: '<=' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'eq', label: '=' },
  ],
  select: [{ value: 'eq', label: '=' }, { value: 'neq', label: '!=' }],
  date: [
    { value: 'gte', label: '>=' },
    { value: 'lte', label: '<=' },
  ],
  text: [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '!=' },
  ],
}

const emptyForm = { name: '', description: '', is_dynamic: true, logic: 'and' }

function evaluateRule(member, rule) {
  const val = member[rule.field]
  const target = rule.value
  switch (rule.operator) {
    case 'gte': return val >= (isNaN(target) ? target : Number(target))
    case 'lte': return val <= (isNaN(target) ? target : Number(target))
    case 'gt': return val > Number(target)
    case 'lt': return val < Number(target)
    case 'eq': return String(val) === String(target)
    case 'neq': return String(val) !== String(target)
    default: return true
  }
}

function SendCampaignModal({ segment, onClose }) {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [channel, setChannel] = useState('email')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  const handleSend = async () => {
    if (!content.trim()) return
    if (channel === 'email' && !subject.trim()) return
    setSending(true)
    setResult(null)
    try {
      // Fetch all members and filter by segment rules
      const { data: allMembers } = await getMembers(orgId)
      const members = allMembers || []
      const segRules = Array.isArray(segment.rules) ? segment.rules : []
      const logic = segment.logic || 'and'
      const matched = members.filter(m =>
        logic === 'or'
          ? segRules.some(rule => evaluateRule(m, rule))
          : segRules.every(rule => evaluateRule(m, rule))
      )

      // Filter out unsubscribed
      const eligible = filterUnsubscribed(matched, [], channel)

      // Create message_log entry for each recipient
      const logs = eligible.map(m => ({
        channel,
        recipient: m.email || m.phone || m.line_id || m.name,
        subject: channel === 'email' ? subject : null,
        content,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }))

      if (logs.length > 0) {
        const { error } = await supabase.from('message_logs').insert(logs)
        if (error) throw error
      }

      setResult({ success: true, count: eligible.length })
    } catch (err) {
      setResult({ success: false, message: err.message || '發送失敗' })
    } finally {
      setSending(false)
    }
  }

  const channelLabels = { email: 'Email', line: 'LINE', sms: 'SMS' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 480, maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0 }}>發送行銷活動</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--accent-purple-dim, rgba(139,92,246,0.08))', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={16} style={{ color: 'var(--accent-purple)' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{segment.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>目標會員：{segment.member_count || 0} 人</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>發送管道</label>
            <div style={{ display: 'flex', gap: 12 }}>
              {['email', 'line', 'sms'].map(ch => (
                <label key={ch} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="channel" value={ch} checked={channel === ch} onChange={() => setChannel(ch)} />
                  {channelLabels[ch]}
                </label>
              ))}
            </div>
          </div>

          {channel === 'email' && (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>主旨</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="輸入郵件主旨"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>訊息內容</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="輸入訊息內容..."
              rows={5}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {result && (
          <div style={{
            marginTop: 14, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: result.success ? 'rgba(34,197,94,0.08)' : 'var(--accent-red-dim)',
            color: result.success ? 'var(--accent-green, #22c55e)' : 'var(--accent-red)',
          }}>
            {result.success ? `已成功發送給 ${result.count} 位會員` : result.message}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={sending || !content.trim() || (channel === 'email' && !subject.trim())}
          >
            {sending ? '發送中...' : <><Send size={13} /> 發送</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Segments() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [segments, setSegments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [rules, setRules] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [previewSegmentId, setPreviewSegmentId] = useState(null)
  const [previewMembers, setPreviewMembers] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [campaignSegment, setCampaignSegment] = useState(null)

  // AI Natural Language Segment
  const [nlQuery, setNlQuery] = useState('')
  const [nlLoading, setNlLoading] = useState(false)
  const [nlError, setNlError] = useState(null)
  const [nlExplanation, setNlExplanation] = useState('')

  const handleNlToRules = async () => {
    if (!nlQuery.trim()) return
    setNlLoading(true)
    setNlError(null)
    setNlExplanation('')
    try {
      const result = await nlToSegmentRules(nlQuery, FIELDS)
      if (result.name) setForm(f => ({ ...f, name: f.name || result.name }))
      if (result.rules?.length) setRules(result.rules)
      if (result.logic) setForm(f => ({ ...f, logic: result.logic }))
      if (result.explanation) setNlExplanation(result.explanation)
      setNlQuery('')
    } catch (err) {
      setNlError(err.message || 'AI 轉換失敗')
    } finally {
      setNlLoading(false)
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const { data, error } = await getCustomerSegments()
    if (error) setError(error.message)
    else setSegments(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const addRule = () => {
    setRules(prev => [...prev, { field: 'total_spent', operator: 'gte', value: '' }])
  }

  const updateRule = (idx, key, value) => {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r))
  }

  const removeRule = (idx) => {
    setRules(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = async () => {
    if (!form.name) return
    setSaving(true)
    const payload = { ...form, rules, logic: form.logic || 'and' }
    delete payload.id

    if (editingId) {
      const { error } = await updateCustomerSegment(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await createCustomerSegment(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setRules([])
    setEditingId(null)
    load()
  }

  const handleEdit = (seg) => {
    setForm({ name: seg.name, description: seg.description || '', is_dynamic: seg.is_dynamic, logic: seg.logic || 'and' })
    setRules(Array.isArray(seg.rules) ? seg.rules : [])
    setEditingId(seg.id)
    setShowModal(true)
  }

  const applyPreset = (key) => {
    const preset = PRESET_SEGMENTS[key]
    if (!preset) return
    setForm({ name: preset.label, description: `預設分群：${preset.label}`, is_dynamic: true, logic: preset.logic || 'and' })
    // Map preset conditions to our rule format
    const mappedRules = (preset.conditions || []).map(c => ({
      field: c.field,
      operator: c.operator === 'gt' ? 'gt' : c.operator === 'lt' ? 'lt' : c.operator === 'eq' ? 'eq' : c.operator === 'ne' ? 'neq' : c.operator === 'gte' ? 'gte' : c.operator === 'lte' ? 'lte' : 'gte',
      value: String(c.value),
    }))
    setRules(mappedRules)
    setEditingId(null)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('確定要刪除此分群？')) return
    const { error } = await deleteCustomerSegment(id)
    if (error) setError(error.message)
    else load()
  }

  const previewSegment = async (seg) => {
    if (previewSegmentId === seg.id) { setPreviewSegmentId(null); return }
    setPreviewSegmentId(seg.id)
    setPreviewLoading(true)
    const { data } = await getMembers(orgId)
    const members = data || []
    const segRules = Array.isArray(seg.rules) ? seg.rules : []

    const logic = seg.logic || 'and'
    const matched = members.filter(m =>
      logic === 'or'
        ? segRules.some(rule => evaluateRule(m, rule))
        : segRules.every(rule => evaluateRule(m, rule))
    )
    setPreviewMembers(matched)

    // Update member_count
    if (matched.length !== seg.member_count) {
      await updateCustomerSegment(seg.id, { member_count: matched.length })
    }
    setPreviewLoading(false)
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🎯</span> 客戶分群</h2>
            <p>Customer Segments — 動態分群規則、會員篩選</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setRules([]); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增分群
          </button>
        </div>
      </div>

      {/* Preset Segment Buttons */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>快速建立預設分群：</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(PRESET_SEGMENTS).filter(([k]) => k !== 'all').map(([key, preset]) => (
            <button
              key={key}
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => applyPreset(key)}
            >
              <Zap size={12} /> {preset.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      {segments.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>尚無分群規則，請新增</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {segments.map(seg => {
            const segRules = Array.isArray(seg.rules) ? seg.rules : []
            return (
              <div key={seg.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', gap: 12 }}>
                  <Users size={18} style={{ color: 'var(--accent-purple)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{seg.name}</div>
                    {seg.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{seg.description}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {segRules.map((r, i) => {
                        const field = FIELDS.find(f => f.value === r.field)
                        const logic = seg.logic || 'and'
                        return (
                          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {i > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: logic === 'or' ? 'var(--accent-orange)' : 'var(--accent-purple)', padding: '0 2px' }}>{logic === 'or' ? 'OR' : 'AND'}</span>}
                            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>
                              {field?.label || r.field} {r.operator} {r.value}
                            </span>
                          </span>
                        )
                      })}
                      {segRules.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>無規則 (全部會員)</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 60 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-purple)' }}>{seg.member_count || 0}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>人</div>
                  </div>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => previewSegment(seg)}>
                    <Play size={12} /> 預覽
                  </button>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setCampaignSegment(seg)}>
                    <Send size={12} /> 發送
                  </button>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => handleEdit(seg)}><Edit3 size={13} /></button>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(seg.id)}><Trash2 size={13} /></button>
                </div>

                {previewSegmentId === seg.id && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
                    {previewLoading ? <LoadingSpinner /> : (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>符合條件的會員 ({previewMembers.length})</div>
                        {previewMembers.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>無符合條件的會員</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                <th style={{ textAlign: 'left', padding: '6px 8px' }}>會員編號</th>
                                <th style={{ textAlign: 'left', padding: '6px 8px' }}>姓名</th>
                                <th style={{ textAlign: 'left', padding: '6px 8px' }}>等級</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px' }}>累計消費</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px' }}>來店次數</th>
                                <th style={{ textAlign: 'right', padding: '6px 8px' }}>點數</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewMembers.slice(0, 20).map(m => (
                                <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{m.member_number}</td>
                                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{m.name}</td>
                                  <td style={{ padding: '6px 8px' }}>{m.level}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>NT$ {(m.total_spent || 0).toLocaleString()}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.visit_count || 0}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.available_points || 0}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {previewMembers.length > 20 && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>顯示前 20 筆，共 {previewMembers.length} 筆</div>}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Send Campaign Modal */}
      {campaignSegment && (
        <SendCampaignModal segment={campaignSegment} onClose={() => setCampaignSegment(null)} />
      )}

      {/* Segment Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 560, maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯分群' : '新增客戶分群'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>分群名稱 *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：高消費 VIP" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>描述</label>
                <input type="text" value={form.description} onChange={e => set('description', e.target.value)} placeholder="選填" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>

              {/* AI Natural Language Input */}
              {isAIConfigured() && (
                <div style={{ marginTop: 8, padding: 12, borderRadius: 10, background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(99,102,241,0.06))', border: '1px solid rgba(139,92,246,0.2)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-purple)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Sparkles size={13} /> AI 自然語言建立分群
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={nlQuery}
                      onChange={e => setNlQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleNlToRules()}
                      placeholder="例：過去三個月消費超過五萬但最近沒回購的客戶"
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }}
                    />
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
                      onClick={handleNlToRules}
                      disabled={nlLoading || !nlQuery.trim()}
                    >
                      {nlLoading ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
                      {nlLoading ? ' 分析中' : ' 轉換'}
                    </button>
                  </div>
                  {nlError && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 6 }}>{nlError}</div>}
                  {nlExplanation && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, padding: '6px 8px', background: 'var(--bg-card)', borderRadius: 6 }}>{nlExplanation}</div>}
                </div>
              )}

              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 600 }}>篩選規則</label>
                    <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      <button
                        onClick={() => set('logic', 'and')}
                        style={{
                          padding: '3px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                          background: form.logic === 'and' ? 'var(--accent-purple)' : 'var(--bg-main)',
                          color: form.logic === 'and' ? '#fff' : 'var(--text-secondary)',
                        }}
                      >AND</button>
                      <button
                        onClick={() => set('logic', 'or')}
                        style={{
                          padding: '3px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                          background: form.logic === 'or' ? 'var(--accent-orange)' : 'var(--bg-main)',
                          color: form.logic === 'or' ? '#fff' : 'var(--text-secondary)',
                        }}
                      >OR</button>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {form.logic === 'or' ? '符合任一條件' : '符合全部條件'}
                    </span>
                  </div>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addRule}>
                    <Filter size={12} /> 新增條件
                  </button>
                </div>
                {rules.length === 0 && <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, border: '1px dashed var(--border)', borderRadius: 6 }}>尚無條件（將包含所有會員）</div>}
                {rules.map((rule, idx) => {
                  const fieldDef = FIELDS.find(f => f.value === rule.field)
                  const ops = OPERATORS[fieldDef?.type || 'number'] || OPERATORS.number
                  return (
                    <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <select value={rule.field} onChange={e => { updateRule(idx, 'field', e.target.value); updateRule(idx, 'operator', 'gte'); updateRule(idx, 'value', '') }} style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }}>
                        {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                      <select value={rule.operator} onChange={e => updateRule(idx, 'operator', e.target.value)} style={{ width: 70, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }}>
                        {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {fieldDef?.type === 'select' ? (
                        <select value={rule.value} onChange={e => updateRule(idx, 'value', e.target.value)} style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }}>
                          <option value="">選擇</option>
                          {(fieldDef.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type={fieldDef?.type === 'date' ? 'date' : 'number'} value={rule.value} onChange={e => updateRule(idx, 'value', e.target.value)} placeholder="值" style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }} />
                      )}
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }} onClick={() => removeRule(idx)}><X size={16} /></button>
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
