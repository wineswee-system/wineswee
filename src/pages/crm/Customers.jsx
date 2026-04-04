import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, ChevronDown, ChevronRight, Phone, Mail, Upload, Download, Building2, Users, AlertTriangle, Merge, Clock, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import MaskedText from '../../components/MaskedText'
import {
  findDuplicates,
  calculateLeadScore,
  parseCSV,
  toCSV,
  downloadCSV,
  CSV_FIELD_MAP,
  createCompanyRecord,
  linkContactToCompany,
} from '../../lib/crmEngine'

const TAGS = ['VIP', '潛力客戶', '愛砍價', '潛在經銷商', '老客戶', '冷客戶']
const STATUSES = ['活躍', '潛在', '冷凍', '流失']
const CONTACT_TYPES = ['call', 'email', 'line', 'meeting']
const CONTACT_TYPE_LABELS = { call: '📞 電話', email: '📧 Email', line: '💬 LINE', meeting: '🤝 面談' }
const COMPANY_ROLES = ['決策者', '影響者', '聯絡人', '採購', '技術負責人', '財務負責人', '其他']
const COMPANY_SIZES = ['微型', '小型', '中型', '大型']
const TABS = ['客戶列表', '公司帳戶', '查重合併', '匯入匯出']
const PAGE_SIZE = 10

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [contacts, setContacts] = useState({})
  const [outboundOrders, setOutboundOrders] = useState([])
  const [locations, setLocations] = useState([])
  const [companies, setCompanies] = useState([])
  const [companyLinks, setCompanyLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [locFilter, setLocFilter] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [activeCustomerId, setActiveCustomerId] = useState(null)
  const [activeTab, setActiveTab] = useState('客戶列表')
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', tags: [], assigned_to: '', source: '', status: '活躍', notes: '', credit_limit: '', location_id: '', company_id: '', company_role: '聯絡人' })
  const [contactForm, setContactForm] = useState({ type: 'call', content: '', operator: '' })
  const [companyForm, setCompanyForm] = useState({ name: '', industry: '', size: '', website: '', address: '', tax_id: '', phone: '', annual_revenue: '', employee_count: '', owner: '', notes: '' })
  const [error, setError] = useState(null)

  // Activity timeline state
  const [activityPages, setActivityPages] = useState({})
  const [activityLoading, setActivityLoading] = useState({})

  // Import state
  const [importData, setImportData] = useState(null)
  const [importMapping, setImportMapping] = useState({})
  const [importStep, setImportStep] = useState(1) // 1=upload, 2=preview/map, 3=done

  // Duplicate state
  const [duplicates, setDuplicates] = useState([])
  const [dupScanning, setDupScanning] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('customers').select('*').order('created_at', { ascending: false }),
      supabase.from('locations').select('*'),
      supabase.from('outbound_orders').select('*').order('created_at', { ascending: false }),
    ]).then(([c, l, o]) => {
      setCustomers(c.data || [])
      setLocations(l.data || [])
      setOutboundOrders(o.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setC = (k, v) => setContactForm(f => ({ ...f, [k]: v }))
  const setComp = (k, v) => setCompanyForm(f => ({ ...f, [k]: v }))

  const toggleExpand = async (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!contacts[id]) {
      const { data } = await supabase.from('customer_contacts').select('*').eq('customer_id', id).order('created_at', { ascending: false })
      setContacts(prev => ({ ...prev, [id]: data || [] }))
      setActivityPages(prev => ({ ...prev, [id]: PAGE_SIZE }))
    }
  }

  const loadMoreActivities = (customerId) => {
    setActivityPages(prev => ({
      ...prev,
      [customerId]: (prev[customerId] || PAGE_SIZE) + PAGE_SIZE
    }))
  }

  const handleSubmit = async () => {
    if (!form.name) return
    const { company_id, company_role, ...customerData } = form
    const { data } = await supabase.from('customers').insert({
      ...customerData,
      credit_limit: Number(customerData.credit_limit) || 0,
      location_id: customerData.location_id || null,
    }).select().single()
    if (data) {
      // If a company was selected, create the link
      if (company_id) {
        const link = linkContactToCompany(data.id, company_id, company_role)
        setCompanyLinks(prev => [...prev, link])
      }
      setCustomers(prev => [data, ...prev])
      setShowModal(false)
      setForm({ name: '', company: '', phone: '', email: '', tags: [], assigned_to: '', source: '', status: '活躍', notes: '', credit_limit: '', location_id: '', company_id: '', company_role: '聯絡人' })
    }
  }

  const handleAddContact = async () => {
    if (!contactForm.content) return
    const { data } = await supabase.from('customer_contacts').insert({ ...contactForm, customer_id: activeCustomerId }).select().single()
    if (data) {
      setContacts(prev => ({ ...prev, [activeCustomerId]: [data, ...(prev[activeCustomerId] || [])] }))
      setShowContactModal(false)
      setContactForm({ type: 'call', content: '', operator: '' })
    }
  }

  const handleAddCompany = () => {
    if (!companyForm.name) return
    const record = createCompanyRecord({
      ...companyForm,
      annual_revenue: Number(companyForm.annual_revenue) || 0,
      employee_count: Number(companyForm.employee_count) || 0,
    })
    setCompanies(prev => [record, ...prev])
    setShowCompanyModal(false)
    setCompanyForm({ name: '', industry: '', size: '', website: '', address: '', tax_id: '', phone: '', annual_revenue: '', employee_count: '', owner: '', notes: '' })
  }

  const toggleTag = (tag) => setForm(f => ({ ...f, tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag] }))

  const filtered = customers.filter(c =>
    (locFilter === '' || String(c.location_id) === locFilter) &&
    (tagFilter === '' || (c.tags || []).includes(tagFilter)) &&
    (c.name?.includes(search) || c.company?.includes(search) || c.phone?.includes(search))
  )

  // Lead score helper
  const getLeadScore = (customer) => {
    const contactCount = (contacts[customer.id] || []).length
    const enriched = { ...customer, _contactCount: contactCount }
    return calculateLeadScore(enriched)
  }

  const getScoreColor = (score) => {
    if (score >= 70) return 'var(--accent-green)'
    if (score >= 40) return 'var(--accent-orange)'
    return 'var(--accent-red)'
  }

  // CSV Export
  const handleExport = () => {
    const exportCols = ['name', 'company', 'phone', 'email', 'status', 'tags', 'source', 'assigned_to', 'notes', 'credit_limit']
    const csvStr = toCSV(filtered, exportCols)
    downloadCSV(csvStr, `customers_${new Date().toISOString().slice(0, 10)}.csv`)
  }

  // CSV Import
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = parseCSV(ev.target.result)
      setImportData(result)
      // Auto-map headers
      const mapping = {}
      result.headers.forEach(h => {
        if (CSV_FIELD_MAP[h]) mapping[h] = CSV_FIELD_MAP[h]
      })
      setImportMapping(mapping)
      setImportStep(2)
    }
    reader.readAsText(file)
  }

  const handleImportConfirm = async () => {
    if (!importData) return
    const mapped = importData.rows.map(row => {
      const obj = {}
      Object.entries(importMapping).forEach(([csvHeader, field]) => {
        if (field && row[csvHeader] !== undefined) {
          if (field === 'tags') {
            obj[field] = row[csvHeader].split(';').filter(Boolean)
          } else if (field === 'credit_limit') {
            obj[field] = Number(row[csvHeader]) || 0
          } else {
            obj[field] = row[csvHeader]
          }
        }
      })
      if (!obj.status) obj.status = '活躍'
      return obj
    }).filter(obj => obj.name)

    if (mapped.length === 0) return

    const { data } = await supabase.from('customers').insert(mapped).select()
    if (data) {
      setCustomers(prev => [...data, ...prev])
    }
    setImportStep(3)
  }

  const resetImport = () => {
    setImportData(null)
    setImportMapping({})
    setImportStep(1)
    setShowImportModal(false)
  }

  // Duplicate detection
  const runDuplicateDetection = () => {
    setDupScanning(true)
    setTimeout(() => {
      const dups = findDuplicates(customers)
      setDuplicates(dups)
      setDupScanning(false)
    }, 300)
  }

  const handleMerge = async (dup) => {
    // Merge B into A: keep A, delete B
    const { customerA, customerB } = dup
    const merged = { ...customerA }
    // Fill blank fields from B
    if (!merged.phone && customerB.phone) merged.phone = customerB.phone
    if (!merged.email && customerB.email) merged.email = customerB.email
    if (!merged.company && customerB.company) merged.company = customerB.company
    if (!merged.source && customerB.source) merged.source = customerB.source
    if (!merged.assigned_to && customerB.assigned_to) merged.assigned_to = customerB.assigned_to
    // Merge tags
    const allTags = [...new Set([...(merged.tags || []), ...(customerB.tags || [])])]
    merged.tags = allTags
    // Keep higher credit limit
    merged.credit_limit = Math.max(merged.credit_limit || 0, customerB.credit_limit || 0)

    await supabase.from('customers').update(merged).eq('id', customerA.id)
    await supabase.from('customers').delete().eq('id', customerB.id)

    setCustomers(prev => prev.filter(c => c.id !== customerB.id).map(c => c.id === customerA.id ? merged : c))
    setDuplicates(prev => prev.filter(d => d !== dup))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filterBtnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  const tabStyle = (active) => ({
    padding: '8px 18px', borderRadius: '10px 10px 0 0',
    border: '1px solid var(--border-medium)', borderBottom: active ? 'none' : '1px solid var(--border-medium)',
    background: active ? 'var(--bg-card)' : 'transparent',
    color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500,
    marginBottom: active ? -1 : 0,
    position: 'relative', zIndex: active ? 1 : 0,
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon">👥</span> 客戶管理</h2><p>客戶 360 度視圖與互動紀錄</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            {activeTab === '客戶列表' && <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增客戶</button>}
            {activeTab === '公司帳戶' && <button className="btn btn-primary" onClick={() => setShowCompanyModal(true)}><Plus size={14} /> 新增公司</button>}
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 0 }}>
        {TABS.map(tab => (
          <button key={tab} style={tabStyle(activeTab === tab)} onClick={() => setActiveTab(tab)}>
            {tab === '客戶列表' && <Users size={13} style={{ marginRight: 5, verticalAlign: -2 }} />}
            {tab === '公司帳戶' && <Building2 size={13} style={{ marginRight: 5, verticalAlign: -2 }} />}
            {tab === '查重合併' && <AlertTriangle size={13} style={{ marginRight: 5, verticalAlign: -2 }} />}
            {tab === '匯入匯出' && <Upload size={13} style={{ marginRight: 5, verticalAlign: -2 }} />}
            {tab}
          </button>
        ))}
      </div>

      {/* ======================== TAB: 客戶列表 ======================== */}
      {activeTab === '客戶列表' && (
        <>
          {/* 分店篩選 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button style={filterBtnStyle(locFilter === '')} onClick={() => setLocFilter('')}>全部分店</button>
            {locations.map(l => (
              <button key={l.id} style={filterBtnStyle(locFilter === String(l.id))} onClick={() => setLocFilter(String(l.id))}>{l.name}</button>
            ))}
          </div>

          {/* 標籤篩選 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button style={filterBtnStyle(tagFilter === '')} onClick={() => setTagFilter('')}>全部標籤</button>
            {TAGS.map(tag => (
              <button key={tag} style={filterBtnStyle(tagFilter === tag)} onClick={() => setTagFilter(tag)}>{tag}</button>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">👥</span> 客戶清單 ({filtered.length})</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="search-bar"><Search className="search-icon" /><input type="text" placeholder="姓名/公司/電話..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} /></div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filtered.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>尚無客戶資料</div>}
              {filtered.map(c => {
                const { score } = getLeadScore(c)
                return (
                  <div key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => toggleExpand(c.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {expanded === c.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0, position: 'relative' }}>
                          {c.name?.[0]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {c.name} {c.company && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>· {c.company}</span>}
                            {/* Lead Score Badge */}
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '1px 8px', borderRadius: 10,
                              background: `${getScoreColor(score)}18`,
                              color: getScoreColor(score),
                              fontSize: 11, fontWeight: 700,
                            }}>
                              <Star size={10} fill="currentColor" /> {score}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                            {c.phone && <span><Phone size={11} style={{ marginRight: 3 }} /><MaskedText value={c.phone} type="phone" canReveal={true} /></span>}
                            {c.email && <span><Mail size={11} style={{ marginRight: 3 }} /><MaskedText value={c.email} type="email" canReveal={true} /></span>}
                            {c.location_id && <span>📍 {locations.find(l => l.id === c.location_id)?.name}</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {(c.tags || []).map(tag => (
                          <span key={tag} style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 11, fontWeight: 600 }}>{tag}</span>
                        ))}
                        <span className={`badge ${c.status === '活躍' ? 'badge-success' : c.status === '潛在' ? 'badge-info' : 'badge-neutral'}`}><span className="badge-dot"></span>{c.status}</span>
                        {c.credit_limit > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>額度 ${c.credit_limit.toLocaleString()}</span>}
                      </div>
                    </div>

                    {expanded === c.id && (
                      <div style={{ background: 'var(--glass-light)', padding: '12px 16px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                        {/* WMS 出貨狀態 */}
                        {(() => {
                          const orders = outboundOrders.filter(o => o.customer === c.name).slice(0, 3)
                          if (orders.length === 0) return null
                          return (
                            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>🚚 最新出貨狀態（WMS）</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {orders.map(o => (
                                  <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                                    <div>
                                      <span style={{ fontWeight: 600 }}>{o.order_number}</span>
                                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{o.carrier}</span>
                                      {o.tracking_number && <span style={{ color: 'var(--accent-cyan)', marginLeft: 8 }}>單號：{o.tracking_number}</span>}
                                    </div>
                                    <span className={`badge ${o.status === '已出貨' ? 'badge-success' : o.status === '揀貨中' || o.status === '已複核' ? 'badge-info' : 'badge-warning'}`}>
                                      <span className="badge-dot"></span>{o.status}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })()}

                        {/* Company Link Info */}
                        {(() => {
                          const link = companyLinks.find(l => l.contact_id === c.id)
                          if (!link) return null
                          const comp = companies.find(co => co.id === link.company_id)
                          if (!comp) return null
                          return (
                            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                <Building2 size={12} style={{ marginRight: 4, verticalAlign: -2 }} /> 所屬公司
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{comp.name}</span>
                                <span style={{ marginLeft: 8 }}>角色：</span>
                                <span style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 11, fontWeight: 600 }}>{link.role}</span>
                                {comp.industry && <span style={{ marginLeft: 8 }}>產業：{comp.industry}</span>}
                              </div>
                            </div>
                          )
                        })()}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>📋 基本資料</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 2 }}>
                              {c.source && <div>來源：{c.source}</div>}
                              {c.assigned_to && <div>負責業務：{c.assigned_to}</div>}
                              {c.notes && <div>備註：{c.notes}</div>}
                              {c.outstanding_amount > 0 && <div style={{ color: 'var(--accent-orange)' }}>⚠ 未收帳款：${c.outstanding_amount?.toLocaleString()}</div>}
                            </div>
                            {/* Lead Score Breakdown */}
                            {(() => {
                              const { score, breakdown } = getLeadScore(c)
                              return (
                                <div style={{ marginTop: 12 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                    <Star size={12} style={{ marginRight: 4, verticalAlign: -2 }} /> 潛力分數：
                                    <span style={{ color: getScoreColor(score), fontWeight: 700 }}>{score}</span>/100
                                  </div>
                                  <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--border-subtle)' }}>
                                    <div style={{ width: `${score}%`, height: '100%', borderRadius: 3, background: getScoreColor(score), transition: 'width 0.3s ease' }} />
                                  </div>
                                  {breakdown.length > 0 && (
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                      {breakdown.map((b, i) => (
                                        <span key={i} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--glass-light)', color: 'var(--text-muted)' }}>
                                          {b.label} +{b.points}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>

                          {/* Full Activity Timeline */}
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                                <Clock size={12} style={{ marginRight: 4, verticalAlign: -2 }} /> 互動時間軸
                              </div>
                              <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={e => { e.stopPropagation(); setActiveCustomerId(c.id); setShowContactModal(true) }}>
                                <Plus size={11} /> 新增
                              </button>
                            </div>
                            {(contacts[c.id] || []).length === 0 ? (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無互動紀錄</div>
                            ) : (
                              <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                                {/* Timeline view */}
                                {(contacts[c.id] || []).slice(0, activityPages[c.id] || PAGE_SIZE).map((ct, idx) => (
                                  <div key={ct.id} style={{ display: 'flex', gap: 10, position: 'relative', paddingBottom: 10 }}>
                                    {/* Timeline line */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                      <div style={{
                                        width: 8, height: 8, borderRadius: '50%',
                                        background: idx === 0 ? 'var(--accent-cyan)' : 'var(--border-medium)',
                                        border: '2px solid var(--bg-card)',
                                        flexShrink: 0, marginTop: 4,
                                      }} />
                                      {idx < (contacts[c.id] || []).slice(0, activityPages[c.id] || PAGE_SIZE).length - 1 && (
                                        <div style={{ width: 2, flex: 1, background: 'var(--border-subtle)', minHeight: 16 }} />
                                      )}
                                    </div>
                                    <div style={{ flex: 1, paddingBottom: 4 }}>
                                      <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span>{CONTACT_TYPE_LABELS[ct.type] || '📋'}</span>
                                        <span style={{ fontWeight: 600 }}>{ct.content}</span>
                                      </div>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                        {ct.operator && <span>{ct.operator} · </span>}
                                        {new Date(ct.created_at).toLocaleString('zh-TW')}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {/* Load more button */}
                                {(contacts[c.id] || []).length > (activityPages[c.id] || PAGE_SIZE) && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); loadMoreActivities(c.id) }}
                                    style={{
                                      width: '100%', padding: '6px 0', fontSize: 11,
                                      color: 'var(--accent-cyan)', background: 'none',
                                      border: '1px dashed var(--border-medium)', borderRadius: 6,
                                      cursor: 'pointer', marginTop: 4,
                                    }}
                                  >
                                    載入更多（還有 {(contacts[c.id] || []).length - (activityPages[c.id] || PAGE_SIZE)} 筆）
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ======================== TAB: 公司帳戶 ======================== */}
      {activeTab === '公司帳戶' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div className="card-title"><Building2 size={16} style={{ marginRight: 6 }} /> 公司帳戶 ({companies.length})</div>
          </div>
          {companies.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
              <Building2 size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
              <div>尚無公司帳戶</div>
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowCompanyModal(true)}><Plus size={14} /> 新增公司</button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>公司名稱</th>
                  <th>產業</th>
                  <th>規模</th>
                  <th>統一編號</th>
                  <th>電話</th>
                  <th>負責人</th>
                  <th>關聯聯絡人</th>
                </tr>
              </thead>
              <tbody>
                {companies.map(comp => {
                  const linkedContacts = companyLinks
                    .filter(l => l.company_id === comp.id)
                    .map(l => {
                      const cust = customers.find(cu => cu.id === l.contact_id)
                      return cust ? { ...cust, role: l.role } : null
                    })
                    .filter(Boolean)
                  return (
                    <tr key={comp.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{comp.name}</div>
                        {comp.website && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{comp.website}</div>}
                      </td>
                      <td>{comp.industry || '-'}</td>
                      <td>{comp.size || '-'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{comp.tax_id || '-'}</td>
                      <td>{comp.phone || '-'}</td>
                      <td>{comp.owner || '-'}</td>
                      <td>
                        {linkedContacts.length === 0 ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {linkedContacts.map(lc => (
                              <span key={lc.id} style={{
                                padding: '2px 8px', borderRadius: 6,
                                background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                                fontSize: 11, fontWeight: 600,
                              }}>
                                {lc.name}（{lc.role}）
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ======================== TAB: 查重合併 ======================== */}
      {activeTab === '查重合併' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div className="card-title"><AlertTriangle size={16} style={{ marginRight: 6 }} /> 查重合併</div>
            <button className="btn btn-primary" onClick={runDuplicateDetection} disabled={dupScanning}>
              <Search size={14} /> {dupScanning ? '掃描中...' : '執行查重'}
            </button>
          </div>
          {dupScanning ? (
            <LoadingSpinner message="正在掃描重複客戶..." />
          ) : duplicates.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
              <AlertTriangle size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
              <div>點擊「執行查重」掃描重複客戶</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>系統將比對電話、Email、姓名、公司來找出疑似重複的資料</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                找到 {duplicates.length} 組疑似重複
              </div>
              {duplicates.map((dup, idx) => (
                <div key={idx} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 16 }}>
                  {/* Customer A */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{dup.customerA.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {dup.customerA.company && <span>{dup.customerA.company} · </span>}
                      {dup.customerA.phone && <span>{dup.customerA.phone} · </span>}
                      {dup.customerA.email}
                    </div>
                  </div>
                  {/* Match score */}
                  <div style={{ textAlign: 'center', flexShrink: 0 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: dup.score >= 70 ? 'var(--accent-red)' : dup.score >= 50 ? 'var(--accent-orange)' : 'var(--accent-yellow)',
                      color: '#fff', fontWeight: 800, fontSize: 14,
                    }}>
                      {dup.score}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                      {dup.reasons.join('、')}
                    </div>
                  </div>
                  {/* Customer B */}
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{dup.customerB.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {dup.customerB.company && <span>{dup.customerB.company} · </span>}
                      {dup.customerB.phone && <span>{dup.customerB.phone} · </span>}
                      {dup.customerB.email}
                    </div>
                  </div>
                  {/* Merge button */}
                  <button className="btn btn-secondary" style={{ flexShrink: 0, fontSize: 11, padding: '5px 12px' }} onClick={() => handleMerge(dup)}>
                    <Merge size={12} /> 合併
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ======================== TAB: 匯入匯出 ======================== */}
      {activeTab === '匯入匯出' && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Export section */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><Download size={16} style={{ marginRight: 6 }} /> 匯出客戶</div>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                將目前篩選結果匯出為 CSV 檔案（共 {filtered.length} 筆客戶）
              </p>
              <button className="btn btn-primary" onClick={handleExport}>
                <Download size={14} /> 匯出 CSV
              </button>
            </div>
          </div>

          {/* Import section */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><Upload size={16} style={{ marginRight: 6 }} /> 匯入客戶</div>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                上傳 CSV 檔案批量匯入客戶資料，系統會自動比對欄位
              </p>
              <button className="btn btn-primary" onClick={() => { resetImport(); setShowImportModal(true) }}>
                <Upload size={14} /> 匯入 CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================== MODALS ======================== */}

      {/* New Customer Modal */}
      {showModal && (
        <Modal title="新增客戶" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="姓名 *"><input className="form-input" type="text" style={{ width: '100%' }} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="公司"><input className="form-input" type="text" style={{ width: '100%' }} value={form.company} onChange={e => set('company', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="電話"><input className="form-input" type="text" style={{ width: '100%' }} value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
            <Field label="Email"><input className="form-input" type="email" style={{ width: '100%' }} value={form.email} onChange={e => set('email', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責業務"><input className="form-input" type="text" style={{ width: '100%' }} value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} /></Field>
            <Field label="所屬分店">
              <select className="form-input" style={{ width: '100%' }} value={form.location_id} onChange={e => set('location_id', e.target.value)}>
                <option value="">請選擇分店</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="信用額度"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.credit_limit} onChange={e => set('credit_limit', e.target.value)} /></Field>
          </div>
          {/* Company Link */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="關聯公司">
              <select className="form-input" style={{ width: '100%' }} value={form.company_id} onChange={e => set('company_id', e.target.value)}>
                <option value="">不關聯</option>
                {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
            </Field>
            {form.company_id && (
              <Field label="公司角色">
                <select className="form-input" style={{ width: '100%' }} value={form.company_role} onChange={e => set('company_role', e.target.value)}>
                  {COMPANY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="客戶來源"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="展覽/介紹/官網..." value={form.source} onChange={e => set('source', e.target.value)} /></Field>
          <Field label="客戶標籤">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {TAGS.map(tag => (
                <span key={tag} onClick={() => toggleTag(tag)} style={{ padding: '4px 12px', borderRadius: 8, border: `1px solid ${form.tags.includes(tag) ? 'var(--accent-cyan)' : 'var(--border-medium)'}`, background: form.tags.includes(tag) ? 'var(--accent-cyan-dim)' : 'transparent', color: form.tags.includes(tag) ? 'var(--accent-cyan)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>{tag}</span>
              ))}
            </div>
          </Field>
          <Field label="備註"><textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
        </Modal>
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <Modal title="新增互動紀錄" onClose={() => setShowContactModal(false)} onSubmit={handleAddContact} submitLabel="新增">
          <Field label="類型">
            <select className="form-input" style={{ width: '100%' }} value={contactForm.type} onChange={e => setC('type', e.target.value)}>
              {CONTACT_TYPES.map(t => <option key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="內容 *"><textarea className="form-input" style={{ width: '100%', minHeight: 80 }} placeholder="紀錄溝通內容..." value={contactForm.content} onChange={e => setC('content', e.target.value)} /></Field>
          <Field label="操作人"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="業務姓名" value={contactForm.operator} onChange={e => setC('operator', e.target.value)} /></Field>
        </Modal>
      )}

      {/* Company Modal */}
      {showCompanyModal && (
        <Modal title="新增公司帳戶" onClose={() => setShowCompanyModal(false)} onSubmit={handleAddCompany}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="公司名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.name} onChange={e => setComp('name', e.target.value)} /></Field>
            <Field label="產業"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：製造業" value={companyForm.industry} onChange={e => setComp('industry', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="規模">
              <select className="form-input" style={{ width: '100%' }} value={companyForm.size} onChange={e => setComp('size', e.target.value)}>
                <option value="">請選擇</option>
                {COMPANY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="統一編號"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.tax_id} onChange={e => setComp('tax_id', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="電話"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.phone} onChange={e => setComp('phone', e.target.value)} /></Field>
            <Field label="網站"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="https://..." value={companyForm.website} onChange={e => setComp('website', e.target.value)} /></Field>
          </div>
          <Field label="地址"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.address} onChange={e => setComp('address', e.target.value)} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="年營收"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={companyForm.annual_revenue} onChange={e => setComp('annual_revenue', e.target.value)} /></Field>
            <Field label="員工數"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={companyForm.employee_count} onChange={e => setComp('employee_count', e.target.value)} /></Field>
          </div>
          <Field label="負責人"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.owner} onChange={e => setComp('owner', e.target.value)} /></Field>
          <Field label="備註"><textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={companyForm.notes} onChange={e => setComp('notes', e.target.value)} /></Field>
        </Modal>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <Modal
          title={importStep === 1 ? '匯入 CSV — 上傳檔案' : importStep === 2 ? '匯入 CSV — 預覽與欄位對應' : '匯入完成'}
          onClose={resetImport}
          onSubmit={importStep === 2 ? handleImportConfirm : resetImport}
          submitLabel={importStep === 2 ? `確認匯入 (${importData?.rows?.length || 0} 筆)` : '完成'}
        >
          {importStep === 1 && (
            <div>
              <div style={{
                border: '2px dashed var(--border-medium)', borderRadius: 12,
                padding: 32, textAlign: 'center', cursor: 'pointer',
                background: 'var(--glass-light)',
              }}>
                <Upload size={32} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>選擇 CSV 檔案上傳</div>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  style={{ fontSize: 12 }}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                支援欄位：客戶姓名、公司、電話、Email、狀態、標籤、來源、負責業務、備註、信用額度
              </div>
            </div>
          )}

          {importStep === 2 && importData && (
            <div>
              {importData.errors.length > 0 && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-red-dim, rgba(255,0,0,0.1))', color: 'var(--accent-red)', fontSize: 12, marginBottom: 12 }}>
                  {importData.errors.map((err, i) => <div key={i}>{err}</div>)}
                </div>
              )}

              {/* Field mapping */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>欄位對應</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {importData.headers.map(h => (
                    <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span style={{ minWidth: 80, color: 'var(--text-muted)' }}>{h}</span>
                      <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                      <select
                        className="form-input"
                        style={{ flex: 1, fontSize: 12, padding: '3px 6px' }}
                        value={importMapping[h] || ''}
                        onChange={e => setImportMapping(prev => ({ ...prev, [h]: e.target.value }))}
                      >
                        <option value="">（忽略）</option>
                        <option value="name">姓名</option>
                        <option value="company">公司</option>
                        <option value="phone">電話</option>
                        <option value="email">Email</option>
                        <option value="status">狀態</option>
                        <option value="tags">標籤</option>
                        <option value="source">來源</option>
                        <option value="assigned_to">負責業務</option>
                        <option value="notes">備註</option>
                        <option value="credit_limit">信用額度</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                資料預覽（前 5 筆，共 {importData.rows.length} 筆）
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 200, border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                <table className="data-table" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      {importData.headers.map(h => (
                        <th key={h} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importData.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {importData.headers.map(h => (
                          <td key={h} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {importStep === 3 && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>匯入完成</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>已成功匯入客戶資料</div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
