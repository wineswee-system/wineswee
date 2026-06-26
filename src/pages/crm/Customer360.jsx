import { useState, useEffect } from 'react'
import { Search, X, User, DollarSign, ShoppingCart, Award, Clock, Phone, Mail, Video, MapPin, MessageCircle, Share2, Headphones, CheckSquare, UserPlus, FileText, Send, Paperclip, Plus, Gift, Calendar } from 'lucide-react'
import { getMembers, getSalesOrders, getAccountsReceivable, getPointTransactions, getPOSTransactions, getCRMActivities, getCRMNotes, createCRMActivity, getMemberCoupons, getAllMemberPurchases } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import AttachmentsPanel from './components/AttachmentsPanel'
import { useOrgId } from '../../contexts/AuthContext'

import { fmtNT as fmt } from '../../lib/currency'

const TOUCHPOINT_ICONS = {
  call: { icon: Phone, label: '電話', color: 'var(--accent-green)' },
  meeting: { icon: Video, label: '會議', color: 'var(--accent-blue)' },
  visit: { icon: MapPin, label: '到訪', color: 'var(--accent-orange)' },
  email: { icon: Mail, label: 'Email', color: 'var(--accent-cyan)' },
  line: { icon: MessageCircle, label: 'LINE', color: '#06C755' },
  chat: { icon: Headphones, label: '線上客服', color: 'var(--accent-purple)' },
  social: { icon: Share2, label: '社群', color: '#E4405F' },
  task: { icon: CheckSquare, label: '任務', color: 'var(--accent-yellow, #f59e0b)' },
  follow_up: { icon: UserPlus, label: '跟進', color: 'var(--accent-purple)' },
  note: { icon: FileText, label: '備註', color: 'var(--text-secondary)' },
  sms: { icon: Send, label: '簡訊', color: 'var(--accent-orange)' },
  order: { icon: ShoppingCart, label: '訂單', color: 'var(--accent-green)' },
  points: { icon: Award, label: '點數', color: 'var(--accent-purple)' },
  attachment: { icon: Paperclip, label: '附件', color: 'var(--text-secondary)' },
}

function getTouchpoint(type) {
  return TOUCHPOINT_ICONS[type] || { icon: Clock, label: type || '其他', color: 'var(--text-secondary)' }
}

function buildUnifiedTimeline({ activities = [], notes = [], messages = [], orders = [], points = [] }) {
  const items = []

  activities.forEach(a => items.push({
    id: `act-${a.id}`, source: 'activity', type: a.type,
    title: a.subject, detail: a.description || a.outcome || '',
    assignee: a.assignee, status: a.status,
    date: a.due_date || a.created_at,
  }))

  notes.forEach(n => items.push({
    id: `note-${n.id}`, source: 'note', type: 'note',
    title: n.content?.slice(0, 60) + (n.content?.length > 60 ? '...' : ''),
    detail: n.content, assignee: n.author, pinned: n.is_pinned,
    date: n.created_at,
  }))

  messages.forEach(m => items.push({
    id: `msg-${m.id}`, source: 'message', type: m.channel,
    title: m.subject || `${m.channel.toUpperCase()} → ${m.recipient}`,
    detail: m.body?.slice(0, 80) || '', status: m.status,
    date: m.sent_at || m.created_at,
  }))

  orders.forEach(o => items.push({
    id: `order-${o.id}`, source: 'order', type: 'order',
    title: `${o.order_number} — ${fmt(o.total || o.total_amount)}`,
    detail: `付款: ${o.payment_status || '—'} / 出貨: ${o.shipping_status || '—'}`,
    date: o.created_at,
  }))

  points.forEach(p => items.push({
    id: `pts-${p.id}`, source: 'points', type: 'points',
    title: `${p.type} ${p.points > 0 ? '+' : ''}${p.points} 點`,
    detail: p.description || '', date: p.created_at,
  }))

  return items.sort((a, b) => new Date(b.date) - new Date(a.date))
}

const SALES_REPS = ['王經理', '李業務', '陳主任', '張專員', '林業務']

export default function Customer360() {
  const orgId = useOrgId()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [viewTab, setViewTab] = useState('crm')
  const [b2cData, setB2cData] = useState(null)
  const [b2cLoading, setB2cLoading] = useState(false)

  useEffect(() => {
    getMembers(orgId).then(({ data }) => { setMembers(data || []); setLoading(false) })
  }, [orgId])

  const filtered = members.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (m.name || '').toLowerCase().includes(q) || (m.member_number || '').toLowerCase().includes(q) || (m.phone || '').includes(q)
  })

  const [timelineFilter, setTimelineFilter] = useState('all')
  const [showQuickLog, setShowQuickLog] = useState(false)
  const [quickForm, setQuickForm] = useState({ type: 'call', subject: '', description: '' })

  const loadDetail = async (member) => {
    setSelected(member)
    setDetailLoading(true)
    setTimelineFilter('all')
    setViewTab('crm')
    setB2cData(null)
    const [soRes, arRes, ptRes, posRes, actRes, noteRes, msgRes] = await Promise.all([
      getSalesOrders(orgId),
      getAccountsReceivable(orgId),
      member.id ? getPointTransactions(member.id) : { data: [] },
      getPOSTransactions(orgId),
      getCRMActivities({ entity_type: 'customer', entity_id: member.id }),
      getCRMNotes('customer', member.id),
      supabase.from('message_logs').select('*').or(`recipient.eq.${member.email},recipient.eq.${member.phone}`).order('sent_at', { ascending: false }).limit(50),
    ])
    const orders = (soRes.data || []).filter(o => o.customer === member.name)
    const ar = (arRes.data || []).filter(r => r.customer === member.name)
    const points = ptRes.data || []
    const pos = (posRes.data || []).filter(t => t.member_id === String(member.id) || t.member_id === member.member_number)
    const activities = actRes.data || []
    const notes = noteRes.data || []
    const messages = msgRes.data || []

    setDetail({ orders, ar, points, pos, activities, notes, messages })
    setDetailLoading(false)
  }

  const handleQuickLog = async () => {
    if (!quickForm.subject || !selected) return
    const { data, error } = await createCRMActivity({
      type: quickForm.type,
      subject: quickForm.subject,
      description: quickForm.description,
      entity_type: 'customer',
      entity_id: selected.id,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    if (!error && data) {
      setDetail(prev => ({ ...prev, activities: [data, ...(prev?.activities || [])] }))
    }
    setQuickForm({ type: 'call', subject: '', description: '' })
    setShowQuickLog(false)
  }

  const loadB2cData = async (member) => {
    setB2cLoading(true)
    const [couponRes, purchaseRes] = await Promise.all([
      getMemberCoupons(member.id),
      getAllMemberPurchases(orgId, { memberId: member.id, limit: 20 }),
    ])
    setB2cData({ coupons: couponRes.data ?? [], purchases: purchaseRes.data ?? [] })
    setB2cLoading(false)
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👤</span> 客戶 360</h2>
            <p>Customer 360 — 客戶全方位視圖</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, minHeight: 500 }}>
        {/* Left: member list */}
        <div style={{ width: 300, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-main)', borderRadius: 6, padding: '6px 10px', border: '1px solid var(--border)' }}>
              <Search size={14} style={{ color: 'var(--text-secondary)' }} />
              <input type="text" placeholder="搜尋客戶..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 13, color: 'var(--text-primary)' }} />
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {filtered.map(m => (
              <div key={m.id} onClick={() => loadDetail(m)} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: selected?.id === m.id ? 'var(--accent-blue-dim)' : 'transparent' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.member_number} | {m.level} | {fmt(m.total_spent)}</div>
              </div>
            ))}
            {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>無符合的客戶</div>}
          </div>
        </div>

        {/* Right: 360 view */}
        <div style={{ flex: 1 }}>
          {!selected ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>請從左側選擇客戶</div>
          ) : detailLoading ? <LoadingSpinner /> : (
            <div>
              {/* Profile header */}
              <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#fff', fontWeight: 700 }}>
                    {selected.name?.[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0 }}>{selected.name}</h3>
                    <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {selected.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={12} /> {selected.phone}</span>}
                      {selected.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={12} /> {selected.email}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ padding: '4px 12px', borderRadius: 6, fontWeight: 700, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)' }}>{selected.level}</span>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{selected.member_number}</div>
                  </div>
                </div>
              </div>

              {/* View tab switcher */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {[{ key: 'crm', label: 'CRM 視角' }, { key: 'member', label: '會員 360' }].map(t => (
                  <button
                    key={t.key}
                    onClick={() => {
                      setViewTab(t.key)
                      if (t.key === 'member' && !b2cData) loadB2cData(selected)
                    }}
                    style={{
                      padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)',
                      background: viewTab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
                      color: viewTab === t.key ? '#fff' : 'var(--text-secondary)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >{t.label}</button>
                ))}
              </div>

              {viewTab === 'crm' && (<>
              {/* KPI cards */}
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                  <div className="stat-card-label">累計消費</div>
                  <div className="stat-card-value" style={{ fontSize: 18 }}>{fmt(selected.total_spent)}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
                  <div className="stat-card-label">訂單數</div>
                  <div className="stat-card-value">{detail?.orders?.length || 0}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
                  <div className="stat-card-label">可用點數</div>
                  <div className="stat-card-value">{selected.available_points || 0}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                  <div className="stat-card-label">來店次數</div>
                  <div className="stat-card-value">{selected.visit_count || 0}</div>
                </div>
              </div>

              {/* Recent orders */}
              <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 12px', fontSize: 14 }}><ShoppingCart size={14} style={{ verticalAlign: -2, marginRight: 6 }} />近期訂單</h4>
                {(!detail?.orders || detail.orders.length === 0) ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: 8 }}>無訂單紀錄</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th style={{ textAlign: 'left', padding: '4px 8px' }}>訂單號</th><th style={{ textAlign: 'right', padding: '4px 8px' }}>金額</th><th style={{ padding: '4px 8px' }}>付款</th><th style={{ padding: '4px 8px' }}>出貨</th></tr></thead>
                    <tbody>
                      {detail.orders.slice(0, 5).map(o => (
                        <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{o.order_number}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(o.total)}</td>
                          <td style={{ padding: '4px 8px' }}>{o.payment_status}</td>
                          <td style={{ padding: '4px 8px' }}>{o.shipping_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ═══ Unified Interaction Timeline ═══ */}
              {(() => {
                const timeline = buildUnifiedTimeline({
                  activities: detail?.activities || [],
                  notes: detail?.notes || [],
                  messages: detail?.messages || [],
                  orders: detail?.orders || [],
                  points: detail?.points || [],
                })
                const FILTER_GROUPS = [
                  { key: 'all', label: '全部', count: timeline.length },
                  { key: 'comms', label: '通訊', types: ['call', 'email', 'line', 'sms', 'chat'] },
                  { key: 'meetings', label: '面對面', types: ['meeting', 'visit'] },
                  { key: 'social', label: '社群', types: ['social'] },
                  { key: 'notes', label: '備註', types: ['note'] },
                  { key: 'orders', label: '訂單/點數', types: ['order', 'points'] },
                  { key: 'tasks', label: '任務/跟進', types: ['task', 'follow_up'] },
                ]
                const filteredTimeline = timelineFilter === 'all' ? timeline
                  : timeline.filter(item => {
                    const group = FILTER_GROUPS.find(g => g.key === timelineFilter)
                    return group?.types?.includes(item.type)
                  })

                return (
                  <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ margin: 0, fontSize: 14 }}>
                        <Clock size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                        互動時間軸 ({filteredTimeline.length})
                      </h4>
                      <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setShowQuickLog(true)}>
                        <Plus size={12} /> 記錄互動
                      </button>
                    </div>

                    {/* Filter tabs */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                      {FILTER_GROUPS.map(g => {
                        const count = g.key === 'all' ? timeline.length : timeline.filter(i => g.types?.includes(i.type)).length
                        if (g.key !== 'all' && count === 0) return null
                        return (
                          <button
                            key={g.key}
                            onClick={() => setTimelineFilter(g.key)}
                            style={{
                              padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)',
                              background: timelineFilter === g.key ? 'var(--accent-cyan)' : 'var(--bg-main)',
                              color: timelineFilter === g.key ? '#fff' : 'var(--text-secondary)',
                              fontSize: 11, fontWeight: 500, cursor: 'pointer',
                            }}
                          >{g.label} ({count})</button>
                        )
                      })}
                    </div>

                    {/* Timeline items */}
                    {filteredTimeline.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>尚無互動紀錄</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {filteredTimeline.slice(0, 50).map(item => {
                          const tp = getTouchpoint(item.type)
                          const Icon = tp.icon
                          return (
                            <div key={item.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--glass-light, transparent)' }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${tp.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Icon size={13} style={{ color: tp.color }} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
                                    <span style={{ color: tp.color, fontSize: 10, fontWeight: 700, marginRight: 6, padding: '1px 6px', borderRadius: 4, background: `${tp.color}15` }}>{tp.label}</span>
                                    {item.title}
                                  </div>
                                  <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    {item.date ? new Date(item.date).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                  </span>
                                </div>
                                {item.detail && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{item.detail.slice(0, 120)}</div>}
                                {(item.assignee || item.status) && (
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                    {item.assignee && <span>{item.assignee}</span>}
                                    {item.status && <span style={{ marginLeft: 8 }}>{item.status}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {filteredTimeline.length > 50 && <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: 8 }}>顯示前 50 筆，共 {filteredTimeline.length} 筆</div>}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Quick Log Modal */}
              {showQuickLog && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowQuickLog(false)}>
                  <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 440, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                    <h3 style={{ margin: '0 0 16px' }}>記錄客戶互動</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                      {['call', 'meeting', 'visit', 'email', 'line', 'chat', 'social', 'note'].map(type => {
                        const tp = getTouchpoint(type)
                        const TpIcon = tp.icon
                        return (
                          <button
                            key={type}
                            onClick={() => setQuickForm(f => ({ ...f, type }))}
                            style={{
                              padding: '5px 10px', borderRadius: 6, border: `1px solid ${quickForm.type === type ? tp.color : 'var(--border)'}`,
                              background: quickForm.type === type ? `${tp.color}18` : 'var(--bg-main)',
                              color: quickForm.type === type ? tp.color : 'var(--text-secondary)',
                              cursor: 'pointer', fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4,
                            }}
                          ><TpIcon size={12} />{tp.label}</button>
                        )
                      })}
                    </div>
                    <input
                      type="text" placeholder="主題（例：跟客戶確認報價）" value={quickForm.subject}
                      onChange={e => setQuickForm(f => ({ ...f, subject: e.target.value }))}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', marginBottom: 8, fontSize: 13 }}
                    />
                    <textarea
                      placeholder="備註（選填）" value={quickForm.description}
                      onChange={e => setQuickForm(f => ({ ...f, description: e.target.value }))}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 60, fontSize: 13, resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button className="btn btn-secondary" onClick={() => setShowQuickLog(false)}>取消</button>
                      <button className="btn btn-primary" onClick={handleQuickLog} disabled={!quickForm.subject}>儲存</button>
                    </div>
                  </div>
                </div>
              )}

              {/* AR + Attachments side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14 }}><DollarSign size={14} style={{ verticalAlign: -2, marginRight: 6 }} />應收帳款</h4>
                  {(!detail?.ar || detail.ar.length === 0) ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>無應收紀錄</div>
                  ) : detail.ar.slice(0, 5).map(r => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                      <span>{r.invoice_number}</span>
                      <span style={{ fontFamily: 'monospace' }}>{fmt(r.amount - (r.paid_amount || 0))}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                  <AttachmentsPanel entityType="customer" entityId={selected.id} />
                </div>
              </div>
              </>)}

              {viewTab === 'member' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {b2cLoading ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>載入中…</div>
                  ) : (<>
                    {/* B2C summary strip */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {[
                        { label: '終身消費',   value: fmt(selected.lifetime_spend ?? selected.total_spent ?? 0), color: 'var(--accent-green)'  },
                        { label: '可用點數',   value: (selected.available_points || 0).toLocaleString() + ' 點', color: 'var(--accent-purple)' },
                        { label: 'RFM 分群',   value: selected.rfm_segment ?? '未評分', color: selected.rfm_segment ? 'var(--accent-cyan)' : 'var(--text-muted)' },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 17, fontWeight: 700, color }}>{value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Active coupons */}
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                      <h4 style={{ margin: '0 0 12px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Gift size={14} /> 持有優惠券 ({(b2cData?.coupons ?? []).filter(c => !c.used_at).length} 張可用)
                      </h4>
                      {!b2cData?.coupons?.length ? (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>尚未持有優惠券</div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {b2cData.coupons.map(c => (
                            <div
                              key={c.id}
                              style={{
                                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                                background: c.used_at ? 'var(--bg-tertiary, #1e1e2e)' : 'var(--accent-cyan-dim)',
                                color: c.used_at ? 'var(--text-muted)' : 'var(--accent-cyan)',
                                border: `1px solid ${c.used_at ? 'var(--border)' : 'var(--accent-cyan)'}`,
                                textDecoration: c.used_at ? 'line-through' : 'none',
                              }}
                            >
                              {c.coupons?.code ?? c.code} · {c.coupons?.name ?? c.name}
                              {c.used_at && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 400 }}>已使用</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Purchase history */}
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                      <h4 style={{ margin: '0 0 12px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={14} /> 消費紀錄 (近 20 筆)
                      </h4>
                      {!b2cData?.purchases?.length ? (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>尚無消費紀錄</div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              {['時間', '分店', '金額', '積分'].map(h => (
                                <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {b2cData.purchases.map(p => (
                              <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 12 }}>
                                  {p.purchased_at ? new Date(p.purchased_at).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                                </td>
                                <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{p.stores?.name ?? '—'}</td>
                                <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--accent-green)' }}>NT${Number(p.total_amount).toLocaleString()}</td>
                                <td style={{ padding: '6px 8px', color: 'var(--accent-purple)' }}>{p.points_earned ? `+${p.points_earned}` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
