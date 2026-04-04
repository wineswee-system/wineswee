import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Phone, Mail, MessageSquare, FileText, PenLine,
  AlertTriangle, Clock, CheckCircle, Star, Shield, ArrowUpCircle,
  Users, Settings, Link2
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import {
  calculateSLAStatus, SLA_POLICIES, checkEscalation,
  autoAssignTicket, createCSATSurvey, calculateCSATMetrics
} from '../../lib/crmEngine'

const TICKET_TYPES = ['商品瑕疵', '出貨錯誤', '退換貨', '付款問題', '諮詢', '其他']
const PRIORITIES = ['緊急', '高', '一般', '低']
const STATUSES = ['待處理', '處理中', '待客戶回覆', '已解決', '已關閉']
const CHANNELS = [
  { value: '電話', icon: Phone, color: 'var(--accent-green)' },
  { value: 'Email', icon: Mail, color: 'var(--accent-cyan)' },
  { value: 'LINE', icon: MessageSquare, color: 'var(--accent-green)' },
  { value: '表單', icon: FileText, color: 'var(--accent-purple)' },
  { value: '手動', icon: PenLine, color: 'var(--accent-orange)' },
]
const DEFAULT_AGENTS = ['王小明', '李小華', '陳大偉', '林美玲']

const KB_ITEMS = [
  { q: '如何申請退換貨？', a: '購買後 7 天內，商品未開封可申請退換貨，請聯繫業務或填寫退貨單。' },
  { q: '出貨後多久可以收到？', a: '一般地區 2-3 個工作天，偏遠地區 5-7 個工作天。' },
  { q: '發票如何開立？', a: '預設開立電子發票，如需統編請下單時備註或聯繫業務。' },
  { q: '如何查詢訂單進度？', a: '請提供訂單編號，業務可在系統即時查詢 WMS 出貨狀態。' },
  { q: '商品保固期多久？', a: '各商品保固期不同，詳見商品說明頁，一般為 1 年。' },
]

/* ── helpers ─────────────────────────────────────────── */

function slaColor(status) {
  if (status === 'on_track') return 'var(--accent-green)'
  if (status === 'warning') return 'var(--accent-orange)'
  return 'var(--accent-red)'
}

function slaBadgeClass(status) {
  if (status === 'on_track') return 'badge-success'
  if (status === 'warning') return 'badge-warning'
  return 'badge-danger'
}

function channelMeta(ch) {
  return CHANNELS.find(c => c.value === ch) || CHANNELS[4]
}

function renderStars(score, size = 14) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={size} fill={n <= score ? '#f59e0b' : 'transparent'} color={n <= score ? '#f59e0b' : 'var(--text-muted)'} />
      ))}
    </span>
  )
}

/* ══════════════════════════════════════════════════════ */

export default function Service() {
  const [tickets, setTickets] = useState([])
  const [customers, setCustomers] = useState([])
  const [locations, setLocations] = useState([])
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('tickets')
  const [locFilter, setLocFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showSLAPanel, setShowSLAPanel] = useState(false)
  const [showAgentConfig, setShowAgentConfig] = useState(false)
  const [agents, setAgents] = useState(DEFAULT_AGENTS)
  const [newAgent, setNewAgent] = useState('')
  const [csatSurveys, setCsatSurveys] = useState([])
  const [csatModal, setCsatModal] = useState(null) // ticket to rate
  const [csatScore, setCsatScore] = useState(0)
  const [csatComment, setCsatComment] = useState('')
  const emptyForm = {
    customer_name: '', subject: '', type: '商品瑕疵', priority: '一般',
    assignee: '', description: '', status: '待處理', location_id: '',
    channel: '手動', deal_id: ''
  }
  const [form, setForm] = useState(emptyForm)

  /* ── data loading ───────────────────────────────── */
  useEffect(() => {
    Promise.all([
      supabase.from('service_tickets').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name'),
      supabase.from('locations').select('*'),
      supabase.from('opportunities').select('id, name, customer_name'),
    ]).then(([t, c, l, d]) => {
      const ticketData = t.data || []
      setTickets(ticketData)
      setCustomers(c.data || [])
      setLocations(l.data || [])
      setDeals(d.data || [])

      // Build initial CSAT surveys for resolved tickets
      const resolved = ticketData.filter(tk => tk.status === '已解決' || tk.status === '已關閉')
      const surveys = resolved.map(tk => {
        const survey = createCSATSurvey(tk.id, tk.customer_name)
        // Simulate some existing scores for demo
        const seed = tk.id % 7
        if (seed < 5) {
          survey.score = Math.min(5, Math.max(1, (seed % 5) + 1))
          survey.responded_at = tk.resolved_at || new Date().toISOString()
          survey.comment = ['很滿意!', '處理迅速', '還可以', '速度可再加快', '非常好'][seed % 5]
        }
        return survey
      })
      setCsatSurveys(surveys)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  /* ── ticket creation ────────────────────────────── */
  const handleSubmit = async () => {
    if (!form.customer_name || !form.subject) return
    try {
      const payload = { ...form, location_id: form.location_id || null, deal_id: form.deal_id || null }
      // Auto-assign if no assignee selected
      if (!payload.assignee) {
        const assigned = autoAssignTicket(agents, tickets)
        if (assigned) payload.assignee = assigned
      }
      const { data, error } = await supabase.from('service_tickets').insert(payload).select().single()
      if (error) throw error
      if (data) {
        setTickets(prev => [data, ...prev])
        setShowModal(false)
        setForm(emptyForm)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  /* ── status update (with CSAT auto-create) ─────── */
  const updateStatus = async (id, status) => {
    try {
      const updates = { status }
      if (status === '已解決') updates.resolved_at = new Date().toISOString()
      const { data, error } = await supabase.from('service_tickets').update(updates).eq('id', id).select().single()
      if (error) throw error
      if (data) {
        setTickets(prev => prev.map(t => t.id === id ? data : t))
        // Auto-create CSAT survey when resolved
        if (status === '已解決') {
          const survey = createCSATSurvey(data.id, data.customer_name)
          setCsatSurveys(prev => [...prev, survey])
        }
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  /* ── CSAT submit ────────────────────────────────── */
  const handleCSATSubmit = () => {
    if (!csatScore || !csatModal) return
    setCsatSurveys(prev => prev.map(s =>
      s.ticket_id === csatModal.id
        ? { ...s, score: csatScore, comment: csatComment, responded_at: new Date().toISOString() }
        : s
    ))
    setCsatModal(null)
    setCsatScore(0)
    setCsatComment('')
  }

  /* ── agent config ───────────────────────────────── */
  const addAgent = () => {
    const name = newAgent.trim()
    if (name && !agents.includes(name)) {
      setAgents(prev => [...prev, name])
      setNewAgent('')
    }
  }
  const removeAgent = (a) => setAgents(prev => prev.filter(x => x !== a))

  /* ── loading / error ────────────────────────────── */
  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>⚠ {error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  /* ── derived data ───────────────────────────────── */
  const filtered = tickets.filter(t =>
    (locFilter === '' || String(t.location_id) === locFilter) &&
    (statusFilter === '' || t.status === statusFilter)
  )
  const openCount = tickets.filter(t => !['已解決', '已關閉'].includes(t.status)).length
  const urgentCount = tickets.filter(t => t.priority === '緊急' && !['已解決', '已關閉'].includes(t.status)).length
  const resolvedCount = tickets.filter(t => t.status === '已解決').length
  const avgResolveDays = (() => {
    const resolved = tickets.filter(t => t.resolved_at && t.created_at)
    if (!resolved.length) return '-'
    const avg = resolved.reduce((s, t) => s + (new Date(t.resolved_at) - new Date(t.created_at)) / (1000 * 60 * 60 * 24), 0) / resolved.length
    return avg.toFixed(1)
  })()
  const csatMetrics = calculateCSATMetrics(csatSurveys)
  const breachedCount = tickets.filter(t => {
    if (['已解決', '已關閉'].includes(t.status)) return false
    const sla = calculateSLAStatus(t)
    return sla.status === 'breached'
  }).length

  const filterBtnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  /* ══════════════════ RENDER ═══════════════════════ */
  return (
    <div className="fade-in">
      {/* ── Header ─────────────────────────────────── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🎫</span> 客服工單</h2>
            <p>客訴追蹤、SLA 管理、滿意度與知識庫</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ background: 'var(--glass-medium)', color: 'var(--text-primary)' }} onClick={() => setShowSLAPanel(p => !p)}>
              <Shield size={14} /> SLA 政策
            </button>
            <button className="btn" style={{ background: 'var(--glass-medium)', color: 'var(--text-primary)' }} onClick={() => setShowAgentConfig(p => !p)}>
              <Settings size={14} /> 客服人員
            </button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增工單</button>
          </div>
        </div>
      </div>

      {/* ── SLA Policy Panel ──────────────────────── */}
      {showSLAPanel && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Shield size={16} /></span> SLA 服務水準政策</div>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18 }} onClick={() => setShowSLAPanel(false)}>✕</button>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>優先度</th><th>回應時限</th><th>解決時限</th><th>說明</th></tr>
              </thead>
              <tbody>
                {SLA_POLICIES.map(p => (
                  <tr key={p.priority}>
                    <td><span className={`badge ${p.priority === '緊急' ? 'badge-danger' : p.priority === '高' ? 'badge-warning' : 'badge-neutral'}`}><span className="badge-dot"></span>{p.priority}</span></td>
                    <td style={{ fontWeight: 600 }}>{p.response_hours} 小時</td>
                    <td style={{ fontWeight: 600 }}>{p.resolution_hours} 小時</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{p.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Agent Config Panel ────────────────────── */}
      {showAgentConfig && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Users size={16} /></span> 客服人員設定（自動分配名單）</div>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18 }} onClick={() => setShowAgentConfig(false)}>✕</button>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {agents.map(a => (
              <span key={a} className="badge badge-info" style={{ fontSize: 13, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="badge-dot"></span>{a}
                <button onClick={() => removeAgent(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
            <div style={{ display: 'flex', gap: 4 }}>
              <input className="form-input" style={{ width: 120, fontSize: 12 }} placeholder="新增人員..." value={newAgent} onChange={e => setNewAgent(e.target.value)} onKeyDown={e => e.key === 'Enter' && addAgent()} />
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addAgent}>加入</button>
            </div>
          </div>
          <div style={{ padding: '0 16px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            新建工單若未指定負責人，系統將以 Round-Robin 方式自動分配給上方人員。
          </div>
        </div>
      )}

      {/* ── Location Filter ───────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={filterBtnStyle(locFilter === '')} onClick={() => setLocFilter('')}>全部分店</button>
        {locations.map(l => (
          <button key={l.id} style={filterBtnStyle(locFilter === String(l.id))} onClick={() => setLocFilter(String(l.id))}>{l.name}</button>
        ))}
      </div>

      {/* ── Stats ─────────────────────────────────── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待處理工單</div><div className="stat-card-value">{openCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">緊急 / SLA 逾期</div><div className="stat-card-value">{urgentCount} / {breachedCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已解決</div><div className="stat-card-value">{resolvedCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">平均解決天數</div><div className="stat-card-value">{avgResolveDays}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">CSAT 平均分</div>
          <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {csatMetrics.avg || '-'}
            {csatMetrics.avg > 0 && <Star size={16} fill="#f59e0b" color="#f59e0b" />}
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {[['tickets', '🎫 工單列表'], ['kb', '📚 常見問答'], ['csat', '⭐ CSAT 滿意度']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500,
            background: tab === k ? 'var(--accent-cyan)' : 'transparent',
            color: tab === k ? '#fff' : 'var(--text-muted)'
          }}>{l}</button>
        ))}
      </div>

      {/* ════════════ TAB: TICKETS ════════════════════ */}
      {tab === 'tickets' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🎫</span> 工單列表</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['', ...STATUSES].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} style={{
                  padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border-medium)',
                  background: statusFilter === s ? 'var(--accent-cyan)' : 'var(--bg-card)',
                  color: statusFilter === s ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 11, fontWeight: 500
                }}>
                  {s || '全部'}
                </button>
              ))}
            </div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th><th>管道</th><th>客戶</th><th>分店</th><th>主旨</th>
                  <th>類型</th><th>優先度</th><th>負責人</th><th>SLA</th><th>關聯商機</th><th>CSAT</th><th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無工單</td></tr>
                )}
                {filtered.map(t => {
                  const sla = calculateSLAStatus(t)
                  const escalations = checkEscalation(t)
                  const isActive = !['已解決', '已關閉'].includes(t.status)
                  const ch = channelMeta(t.channel)
                  const ChannelIcon = ch.icon
                  const survey = csatSurveys.find(s => s.ticket_id === t.id)
                  const dealName = deals.find(d => String(d.id) === String(t.deal_id))?.name

                  return (
                    <tr key={t.id}>
                      {/* ID */}
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        #{String(t.id).padStart(4, '0')}
                        {escalations.length > 0 && isActive && (
                          <span title={escalations.map(e => e.message).join('\n')} style={{ marginLeft: 4, cursor: 'help' }}>
                            <ArrowUpCircle size={14} color="var(--accent-red)" />
                          </span>
                        )}
                      </td>
                      {/* Channel */}
                      <td>
                        <span title={t.channel || '手動'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ChannelIcon size={14} color={ch.color} />
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t.channel || '手動'}</span>
                        </span>
                      </td>
                      {/* Customer */}
                      <td style={{ fontWeight: 600 }}>{t.customer_name}</td>
                      {/* Location */}
                      <td style={{ fontSize: 12 }}>{locations.find(l => l.id === t.location_id)?.name || '-'}</td>
                      {/* Subject */}
                      <td>{t.subject}</td>
                      {/* Type */}
                      <td style={{ fontSize: 12 }}>{t.type}</td>
                      {/* Priority */}
                      <td>
                        <span className={`badge ${t.priority === '緊急' ? 'badge-danger' : t.priority === '高' ? 'badge-warning' : 'badge-neutral'}`}>
                          <span className="badge-dot"></span>{t.priority}
                        </span>
                      </td>
                      {/* Assignee */}
                      <td>{t.assignee || '-'}</td>
                      {/* SLA */}
                      <td>
                        {isActive ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span className={`badge ${slaBadgeClass(sla.status)}`} style={{ fontSize: 11 }}>
                              <span className="badge-dot"></span>
                              {sla.status === 'on_track' ? '正常' : sla.status === 'warning' ? '即將逾期' : '已逾期'}
                            </span>
                            <span style={{ fontSize: 10, color: slaColor(sla.status), fontWeight: 600 }}>
                              <Clock size={10} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                              剩餘 {sla.remainingHours}h
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            <CheckCircle size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                            已完成
                          </span>
                        )}
                      </td>
                      {/* Deal link */}
                      <td>
                        {dealName ? (
                          <span style={{ fontSize: 11, color: 'var(--accent-purple)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <Link2 size={11} />{dealName}
                          </span>
                        ) : '-'}
                      </td>
                      {/* CSAT */}
                      <td>
                        {survey && survey.score ? (
                          renderStars(survey.score, 12)
                        ) : survey && !survey.score ? (
                          <button
                            onClick={() => { setCsatModal(t); setCsatScore(0); setCsatComment('') }}
                            style={{ background: 'none', border: '1px dashed var(--border-medium)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--accent-orange)' }}
                          >
                            待評分
                          </button>
                        ) : '-'}
                      </td>
                      {/* Status */}
                      <td>
                        <select className="form-input" style={{ fontSize: 12, padding: '2px 6px' }} value={t.status} onChange={e => updateStatus(t.id, e.target.value)}>
                          {STATUSES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════ TAB: KB ═════════════════════════ */}
      {tab === 'kb' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📚</span> 常見問答集</div>
            <span className="badge badge-info"><span className="badge-dot"></span>標準回覆文件</span>
          </div>
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {KB_ITEMS.map((item, i) => (
              <div key={i} style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Q：{item.q}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>A：{item.a}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════ TAB: CSAT ═══════════════════════ */}
      {tab === 'csat' && (
        <>
          {/* Aggregate metrics */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">平均分數</div>
              <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {csatMetrics.avg || '-'} <Star size={16} fill="#f59e0b" color="#f59e0b" />
              </div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">滿意率 (4-5分)</div>
              <div className="stat-card-value">{csatMetrics.satisfiedRate || 0}%</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">已回覆</div>
              <div className="stat-card-value">{csatMetrics.count}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">回覆率</div>
              <div className="stat-card-value">{csatMetrics.responseRate || 0}%</div>
            </div>
          </div>

          {/* Score distribution */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📊</span> 分數分佈</div>
            </div>
            <div style={{ padding: '12px 16px 16px', display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              {[5, 4, 3, 2, 1].map(score => {
                const count = csatMetrics.distribution?.[score] || 0
                const maxCount = Math.max(1, ...Object.values(csatMetrics.distribution || {}))
                const pct = (count / maxCount) * 100
                const barColors = { 5: 'var(--accent-green)', 4: 'var(--accent-cyan)', 3: 'var(--accent-orange)', 2: 'var(--accent-red)', 1: 'var(--accent-red)' }
                return (
                  <div key={score} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{count}</span>
                    <div style={{ width: '100%', height: 80, background: 'var(--glass-light)', borderRadius: 6, display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{ width: '100%', height: `${Math.max(4, pct)}%`, background: barColors[score], borderRadius: 6, transition: 'height 0.3s' }} />
                    </div>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
                      {score} <Star size={11} fill="#f59e0b" color="#f59e0b" />
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Survey list */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">⭐</span> CSAT 問卷列表</div>
              <span className="badge badge-neutral"><span className="badge-dot"></span>共 {csatSurveys.length} 筆</span>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>工單</th><th>客戶</th><th>評分</th><th>留言</th><th>狀態</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {csatSurveys.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無 CSAT 調查</td></tr>
                  )}
                  {csatSurveys.map(s => {
                    const ticket = tickets.find(t => t.id === s.ticket_id)
                    return (
                      <tr key={s.id}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-muted)' }}>#{String(s.ticket_id).padStart(4, '0')}</td>
                        <td style={{ fontWeight: 600 }}>{s.customer_id}</td>
                        <td>{s.score ? renderStars(s.score) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未評</span>}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.comment || '-'}</td>
                        <td>
                          {s.score ? (
                            <span className="badge badge-success"><span className="badge-dot"></span>已回覆</span>
                          ) : (
                            <span className="badge badge-warning"><span className="badge-dot"></span>待回覆</span>
                          )}
                        </td>
                        <td>
                          {!s.score && ticket && (
                            <button
                              className="btn" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-purple)', color: '#fff' }}
                              onClick={() => { setCsatModal(ticket); setCsatScore(0); setCsatComment('') }}
                            >
                              填寫評分
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ════════════ MODAL: NEW TICKET ═══════════════ */}
      {showModal && (
        <Modal title="新增客服工單" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="客戶名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} list="cust-list" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
              <datalist id="cust-list">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist>
            </Field>
            <Field label="所屬分店">
              <select className="form-input" style={{ width: '100%' }} value={form.location_id} onChange={e => set('location_id', e.target.value)}>
                <option value="">請選擇分店</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="主旨 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="問題簡述..." value={form.subject} onChange={e => set('subject', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                {TICKET_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="優先度">
              <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="來源管道">
              <select className="form-input" style={{ width: '100%' }} value={form.channel} onChange={e => set('channel', e.target.value)}>
                {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.value}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責客服">
              <select className="form-input" style={{ width: '100%' }} value={form.assignee} onChange={e => set('assignee', e.target.value)}>
                <option value="">自動分配 (Round-Robin)</option>
                {agents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="關聯商機">
              <select className="form-input" style={{ width: '100%' }} value={form.deal_id} onChange={e => set('deal_id', e.target.value)}>
                <option value="">無</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.name}{d.customer_name ? ` (${d.customer_name})` : ''}</option>)}
              </select>
            </Field>
          </div>
          <Field label="問題描述">
            <textarea className="form-input" style={{ width: '100%', minHeight: 80 }} value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
          {!form.assignee && (
            <div style={{ fontSize: 12, color: 'var(--accent-cyan)', padding: '6px 10px', borderRadius: 8, background: 'var(--glass-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Users size={13} /> 未選擇負責人，將自動以 Round-Robin 分配給：<strong>{autoAssignTicket(agents, tickets) || '(無可用人員)'}</strong>
            </div>
          )}
        </Modal>
      )}

      {/* ════════════ MODAL: CSAT RATING ═════════════ */}
      {csatModal && (
        <Modal title={`CSAT 評分 — 工單 #${String(csatModal.id).padStart(4, '0')}`} onClose={() => setCsatModal(null)} onSubmit={handleCSATSubmit}>
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              客戶：<strong>{csatModal.customer_name}</strong>　主旨：{csatModal.subject}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>請評分（1-5 顆星）</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setCsatScore(n)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, transform: csatScore === n ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.15s' }}
                >
                  <Star size={28} fill={n <= csatScore ? '#f59e0b' : 'transparent'} color={n <= csatScore ? '#f59e0b' : 'var(--text-muted)'} />
                </button>
              ))}
            </div>
            {csatScore > 0 && (
              <div style={{ fontSize: 13, marginTop: 8, color: 'var(--accent-purple)', fontWeight: 600 }}>
                {['', '非常不滿意', '不滿意', '普通', '滿意', '非常滿意'][csatScore]}
              </div>
            )}
          </div>
          <Field label="留言（選填）">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60 }} placeholder="對此次服務的評價..." value={csatComment} onChange={e => setCsatComment(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
