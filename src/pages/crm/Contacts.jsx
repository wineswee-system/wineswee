import React, { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Search, Phone, Mail, Building2, X, ChevronDown, Edit3, Trash2, MessageCircle, ChevronUp, ChevronLeft, ChevronRight, Video, MapPin, Share2, Headphones, CheckSquare, UserPlus, FileText, Send as SendIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

import { toast } from '../../lib/toast'
const TOUCHPOINT_ICONS = {
  call: { icon: Phone, label: '電話', color: 'var(--accent-green)' },
  meeting: { icon: Video, label: '會議', color: 'var(--accent-blue)' },
  visit: { icon: MapPin, label: '到訪', color: 'var(--accent-orange)' },
  email: { icon: Mail, label: 'Email', color: 'var(--accent-cyan)' },
  line: { icon: MessageCircle, label: 'LINE', color: '#06C755' },
  chat: { icon: Headphones, label: '客服', color: 'var(--accent-purple)' },
  social: { icon: Share2, label: '社群', color: '#E4405F' },
  task: { icon: CheckSquare, label: '任務', color: 'var(--accent-yellow, #f59e0b)' },
  follow_up: { icon: UserPlus, label: '跟進', color: 'var(--accent-purple)' },
  note: { icon: FileText, label: '備註', color: 'var(--text-secondary)' },
  sms: { icon: SendIcon, label: '簡訊', color: 'var(--accent-orange)' },
}

const PAGE_SIZE = 25

const ROLE_OPTIONS = ['決策者', '影響者', '聯絡人', '技術窗口', '採購窗口', '其他']

const ROLE_COLORS = {
  '決策者': { bg: 'var(--accent-red-dim, rgba(239,68,68,0.15))', color: 'var(--accent-red)' },
  '影響者': { bg: 'var(--accent-orange-dim, rgba(249,115,22,0.15))', color: 'var(--accent-orange)' },
  '聯絡人': { bg: 'var(--accent-cyan-dim, rgba(6,182,212,0.15))', color: 'var(--accent-cyan)' },
  '技術窗口': { bg: 'var(--accent-purple-dim, rgba(139,92,246,0.15))', color: 'var(--accent-purple)' },
  '採購窗口': { bg: 'var(--accent-green-dim, rgba(34,197,94,0.15))', color: 'var(--accent-green)' },
  '其他': { bg: 'var(--accent-blue-dim, rgba(59,130,246,0.15))', color: 'var(--accent-blue)' },
}

function getRoleFromTags(tags) {
  if (!tags) return null
  const arr = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : [])
  return arr.find(t => ROLE_OPTIONS.includes(t)) || null
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 週前`
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [companies, setCompanies] = useState([])
  const [activities, setActivities] = useState([])
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters & search
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')

  // Sort
  const [sortField, setSortField] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  // Pagination
  const [page, setPage] = useState(0)

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [editingContact, setEditingContact] = useState(null)

  // Expanded row
  const [expandedId, setExpandedId] = useState(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null)

  const emptyForm = { name: '', company: '', phone: '', email: '', status: '潛在', tags: [], assigned_to: '', notes: '' }
  const [form, setForm] = useState({ ...emptyForm })
  const [formRole, setFormRole] = useState('')
  const [formTitle, setFormTitle] = useState('')

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // company_accounts 表在本版 schema 不存在 → 改由 contacts 的 company 欄位推導
      const [cRes, actRes, msgRes] = await Promise.all([
        supabase.from('customers').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_activities').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('message_logs').select('*').order('sent_at', { ascending: false }).limit(500),
      ])
      setContacts(cRes.data || [])
      setCompanies([])
      setActivities(actRes.data || [])
      setMessages(msgRes.data || [])
    } catch (err) {
      console.error('Failed to load contacts:', err)
      setError('聯絡人資料載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Reset page on filter change
  useEffect(() => { setPage(0) }, [search, roleFilter, companyFilter])

  // Filtered & sorted data
  const filtered = contacts.filter(c => {
    // Search
    if (search) {
      const s = search.toLowerCase()
      const match = (c.name || '').toLowerCase().includes(s) ||
        (c.company || '').toLowerCase().includes(s) ||
        (c.email || '').toLowerCase().includes(s) ||
        (c.phone || '').toLowerCase().includes(s)
      if (!match) return false
    }
    // Role filter
    if (roleFilter) {
      const role = getRoleFromTags(c.tags)
      if (role !== roleFilter) return false
    }
    // Company filter
    if (companyFilter && c.company !== companyFilter) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let aVal = a[sortField] || ''
    let bVal = b[sortField] || ''
    if (sortField === 'created_at') {
      aVal = new Date(aVal || 0).getTime()
      bVal = new Date(bVal || 0).getTime()
    } else {
      aVal = String(aVal).toLowerCase()
      bVal = String(bVal).toLowerCase()
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Sort handler
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown size={12} style={{ opacity: 0.3 }} />
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  // Open modal for add
  const openAdd = () => {
    setEditingContact(null)
    setForm({ ...emptyForm })
    setFormRole('')
    setFormTitle('')
    setShowModal(true)
  }

  // Open modal for edit
  const openEdit = (c, e) => {
    e.stopPropagation()
    setEditingContact(c)
    const role = getRoleFromTags(c.tags) || ''
    const tagsArr = Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' ? c.tags.split(',').map(t => t.trim()) : [])
    const title = tagsArr.find(t => !ROLE_OPTIONS.includes(t) && t.startsWith('職稱:'))
    setForm({
      name: c.name || '',
      company: c.company || '',
      phone: c.phone || '',
      email: c.email || '',
      status: c.status || '潛在',
      tags: c.tags || [],
      assigned_to: c.assigned_to || '',
      notes: '',
    })
    setFormRole(role)
    setFormTitle(title ? title.replace('職稱:', '') : '')
    setShowModal(true)
  }

  // Save contact
  const handleSave = async () => {
    if (!form.name.trim()) return
    const tags = []
    if (formRole) tags.push(formRole)
    if (formTitle.trim()) tags.push(`職稱:${formTitle.trim()}`)

    const payload = {
      name: form.name.trim(),
      company: form.company || null,
      phone: form.phone || null,
      email: form.email || null,
      status: form.status,
      tags,
      assigned_to: form.assigned_to || null,
    }

    try {
      if (editingContact) {
        const { error: err } = await supabase.from('customers').update(payload).eq('id', editingContact.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('customers').insert(payload)
        if (err) throw err
      }
      setShowModal(false)
      loadData()
    } catch (err) {
      console.error('Save failed:', err)
      toast.error('儲存失敗: ' + (err.message || '未知錯誤'))
    }
  }

  // Delete contact
  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const { error: err } = await supabase.from('customers').delete().eq('id', deleteTarget.id)
      if (err) throw err
      setDeleteTarget(null)
      setExpandedId(null)
      loadData()
    } catch (err) {
      console.error('Delete failed:', err)
      toast.error('刪除失敗: ' + (err.message || '未知錯誤'))
    }
  }

  // Get all touchpoints for a contact (activities + messages)
  const getContactInteractions = (contact) => {
    const contactActs = activities
      .filter(a => a.entity_type === 'customer' && a.entity_id === contact.id)
      .map(a => ({ id: `act-${a.id}`, type: a.type, title: a.subject, detail: a.description || a.outcome || '', date: a.due_date || a.created_at, source: 'activity' }))

    const contactMsgs = messages
      .filter(m => m.recipient === contact.email || m.recipient === contact.phone)
      .map(m => ({ id: `msg-${m.id}`, type: m.channel, title: m.subject || `${m.channel} → ${m.recipient}`, detail: m.body?.slice(0, 60) || '', date: m.sent_at || m.created_at, source: 'message', status: m.status }))

    return [...contactActs, ...contactMsgs]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8)
  }

  // Unique companies from contacts
  const uniqueCompanies = [...new Set(contacts.map(c => c.company).filter(Boolean))].sort()

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Users size={20} /></span> 聯絡人總表</h2>
            <p>Contact Master List — 集中管理所有客戶與聯絡人</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>共 {filtered.length} 筆</span>
            <button className="btn btn-primary" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={15} /> 新增聯絡人
            </button>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div style={{
        background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
        padding: '16px 20px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Search bar */}
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="搜尋姓名、公司、Email、電話..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input"
            style={{ paddingLeft: 38, width: '100%' }}
          />
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>角色：</span>
          <button
            onClick={() => setRoleFilter('')}
            style={{
              padding: '4px 12px', borderRadius: 16, border: '1px solid var(--border-medium)',
              background: !roleFilter ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
              color: !roleFilter ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 12, fontWeight: 500,
            }}
          >全部</button>
          {ROLE_OPTIONS.map(role => (
            <button
              key={role}
              onClick={() => setRoleFilter(roleFilter === role ? '' : role)}
              style={{
                padding: '4px 12px', borderRadius: 16, border: '1px solid var(--border-medium)',
                background: roleFilter === role ? (ROLE_COLORS[role]?.bg || 'var(--accent-cyan)') : 'var(--bg-secondary)',
                color: roleFilter === role ? (ROLE_COLORS[role]?.color || '#fff') : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 12, fontWeight: 500,
              }}
            >{role}</button>
          ))}

          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 12, marginRight: 4 }}>公司：</span>
          <select
            value={companyFilter}
            onChange={e => setCompanyFilter(e.target.value)}
            className="input"
            style={{ width: 'auto', minWidth: 140, fontSize: 12, padding: '4px 8px' }}
          >
            <option value="">全部公司</option>
            {uniqueCompanies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Contact Table */}
      <div style={{
        background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                {[
                  { key: 'name', label: '姓名' },
                  { key: 'company', label: '公司' },
                  { key: 'tags', label: '職稱/角色' },
                  { key: 'phone', label: '電話' },
                  { key: 'email', label: 'Email' },
                  { key: 'created_at', label: '最後互動' },
                  { key: 'assigned_to', label: '負責人' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: '10px 14px', textAlign: 'left', fontWeight: 600,
                      color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                      whiteSpace: 'nowrap', userSelect: 'none',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {col.label} <SortIcon field={col.key} />
                    </span>
                  </th>
                ))}
                <th style={{ padding: '10px 14px', width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    {search || roleFilter || companyFilter ? '找不到符合條件的聯絡人' : '尚無聯絡人資料'}
                  </td>
                </tr>
              )}
              {pageData.map(c => {
                const role = getRoleFromTags(c.tags)
                const tagsArr = Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' ? c.tags.split(',').map(t => t.trim()) : [])
                const titleTag = tagsArr.find(t => t.startsWith('職稱:'))
                const title = titleTag ? titleTag.replace('職稱:', '') : null
                const isExpanded = expandedId === c.id
                const contactInteractions = getContactInteractions(c)

                return (
                  <React.Fragment key={c.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : c.id)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        background: isExpanded ? 'var(--bg-hover)' : 'transparent',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: '50%',
                            background: 'var(--accent-cyan-dim, rgba(6,182,212,0.15))',
                            color: 'var(--accent-cyan)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 700, flexShrink: 0,
                          }}>
                            {(c.name || '?')[0]}
                          </div>
                          {c.name || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                        {c.company ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Building2 size={13} style={{ opacity: 0.5 }} /> {c.company}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {role && (
                            <span style={{
                              padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                              background: ROLE_COLORS[role]?.bg || 'var(--bg-tertiary)',
                              color: ROLE_COLORS[role]?.color || 'var(--text-secondary)',
                            }}>{role}</span>
                          )}
                          {title && (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{title}</span>
                          )}
                          {!role && !title && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {c.phone ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Phone size={12} style={{ opacity: 0.5 }} /> {c.phone}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                        {c.email ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Mail size={12} style={{ opacity: 0.5 }} /> {c.email}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 12 }}>
                        {formatDate(c.updated_at || c.created_at)}
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                        {c.assigned_to || '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={e => openEdit(c, e)}
                            title="編輯"
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                              color: 'var(--text-muted)', borderRadius: 6,
                            }}
                          ><Edit3 size={14} /></button>
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteTarget(c) }}
                            title="刪除"
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                              color: 'var(--text-muted)', borderRadius: 6,
                            }}
                          ><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div style={{
                            padding: '16px 24px', background: 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border)',
                          }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                              {/* Contact Info */}
                              <div>
                                <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-primary)' }}>
                                  聯絡人詳情
                                </h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                                  <div><span style={{ color: 'var(--text-muted)', marginRight: 8 }}>狀態:</span>{c.status || '—'}</div>
                                  <div><span style={{ color: 'var(--text-muted)', marginRight: 8 }}>建立時間:</span>{c.created_at ? new Date(c.created_at).toLocaleString('zh-TW') : '—'}</div>
                                  {c.email && (
                                    <div>
                                      <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>Email:</span>
                                      <a href={`mailto:${c.email}`} style={{ color: 'var(--accent-cyan)' }}>{c.email}</a>
                                    </div>
                                  )}
                                  {c.phone && (
                                    <div>
                                      <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>電話:</span>
                                      <a href={`tel:${c.phone}`} style={{ color: 'var(--accent-cyan)' }}>{c.phone}</a>
                                    </div>
                                  )}
                                  {tagsArr.length > 0 && (
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                                      {tagsArr.map((tag, i) => (
                                        <span key={i} style={{
                                          padding: '2px 8px', borderRadius: 10, fontSize: 11,
                                          background: 'var(--bg-tertiary, rgba(255,255,255,0.05))',
                                          color: 'var(--text-secondary)',
                                        }}>{tag}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Recent Touchpoints */}
                              <div>
                                <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-primary)' }}>
                                  <MessageCircle size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                                  近期接觸紀錄
                                </h4>
                                {contactInteractions.length === 0 ? (
                                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無互動紀錄（電話、Email、LINE、到訪等）</p>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {contactInteractions.map(int => {
                                      const tp = TOUCHPOINT_ICONS[int.type] || { icon: MessageCircle, label: int.type || '其他', color: 'var(--text-secondary)' }
                                      const TpIcon = tp.icon
                                      return (
                                        <div key={int.id} style={{
                                          padding: '8px 12px', borderRadius: 8,
                                          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                                          fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start',
                                        }}>
                                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: `${tp.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                                            <TpIcon size={11} style={{ color: tp.color }} />
                                          </div>
                                          <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                              <span style={{ fontWeight: 600 }}>
                                                <span style={{ color: tp.color, fontSize: 10, fontWeight: 700, marginRight: 4 }}>{tp.label}</span>
                                                {int.title}
                                              </span>
                                              <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>{formatDate(int.date)}</span>
                                            </div>
                                            {int.detail && <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{int.detail}</div>}
                                            {int.status && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{int.status}</span>}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            padding: '12px 20px', borderTop: '1px solid var(--border-subtle)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              顯示 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, sorted.length)} / {sorted.length} 筆
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-secondary"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                style={{ padding: '4px 10px', fontSize: 12 }}
              >
                <ChevronLeft size={14} /> 上一頁
              </button>
              <span style={{ padding: '4px 12px', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                {page + 1} / {totalPages}
              </span>
              <button
                className="btn btn-secondary"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                style={{ padding: '4px 10px', fontSize: 12 }}
              >
                下一頁 <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal
          title={editingContact ? '編輯聯絡人' : '新增聯絡人'}
          onClose={() => setShowModal(false)}
          onSubmit={handleSave}
          submitLabel={editingContact ? '更新' : '新增'}
        >
          <Field label="姓名 *">
            <input
              className="input"
              placeholder="聯絡人姓名"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="公司">
            <select
              className="input"
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
            >
              <option value="">— 選擇公司 —</option>
              {companies.map(co => (
                <option key={co.id} value={co.name}>{co.name}</option>
              ))}
              {/* Also include companies from contacts not in company_accounts */}
              {uniqueCompanies
                .filter(c => !companies.some(co => co.name === c))
                .map(c => <option key={c} value={c}>{c}</option>)
              }
            </select>
          </Field>
          <Field label="角色">
            <select
              className="input"
              value={formRole}
              onChange={e => setFormRole(e.target.value)}
            >
              <option value="">— 選擇角色 —</option>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="職稱">
            <input
              className="input"
              placeholder="例：總經理、採購主管"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
            />
          </Field>
          <Field label="電話">
            <input
              className="input"
              placeholder="電話號碼"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              placeholder="email@example.com"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          </Field>
          <Field label="負責人">
            <input
              className="input"
              placeholder="負責業務"
              value={form.assigned_to}
              onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
            />
          </Field>
          <Field label="備註">
            <textarea
              className="input"
              rows={3}
              placeholder="備註..."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
          </Field>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'var(--bg-modal-overlay)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onMouseDown={e => { if (e.target === e.currentTarget) setDeleteTarget(null) }}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)',
            borderRadius: 16, padding: 24, maxWidth: 400, width: '100%',
            boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease',
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>確認刪除</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              確定要刪除聯絡人「<strong>{deleteTarget.name}</strong>」嗎？此操作無法復原。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>取消</button>
              <button
                className="btn btn-primary"
                onClick={handleDelete}
                style={{ background: 'var(--accent-red)' }}
              >刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
