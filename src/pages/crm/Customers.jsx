import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, ChevronDown, ChevronRight, Phone, Mail, Upload, Download, Building2, Users, AlertTriangle, Merge, Clock, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
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

import CustomerListTab from './components/CustomerListTab'
import CompanyAccountsTab from './components/CompanyAccountsTab'
import DuplicateMergeTab from './components/DuplicateMergeTab'
import ImportExportTab from './components/ImportExportTab'
import CustomerFormModal from './components/CustomerFormModal'
import CompanyFormModal from './components/CompanyFormModal'
import ContactFormModal from './components/ContactFormModal'
import ImportModal from './components/ImportModal'

const TAGS = ['VIP', '潛力客戶', '愛砍價', '潛在經銷商', '老客戶', '冷客戶']
const TABS = ['客戶列表', '公司帳戶', '查重合併', '匯入匯出']
const PAGE_SIZE = 10

export default function Customers() {
  const { profile } = useAuth()
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
      supabase.from('stores').select('*'),
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
      organization_id: profile?.organization_id || null,
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
      obj.organization_id = profile?.organization_id || null
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

      {activeTab === '客戶列表' && (
        <CustomerListTab
          filtered={filtered} locations={locations}
          locFilter={locFilter} setLocFilter={setLocFilter}
          tagFilter={tagFilter} setTagFilter={setTagFilter}
          TAGS={TAGS} search={search} setSearch={setSearch}
          expanded={expanded} toggleExpand={toggleExpand}
          contacts={contacts} activityPages={activityPages}
          loadMoreActivities={loadMoreActivities}
          outboundOrders={outboundOrders}
          companyLinks={companyLinks} companies={companies}
          getLeadScore={getLeadScore} getScoreColor={getScoreColor}
          setActiveCustomerId={setActiveCustomerId}
          setShowContactModal={setShowContactModal}
          filterBtnStyle={filterBtnStyle}
        />
      )}

      {activeTab === '公司帳戶' && (
        <CompanyAccountsTab
          companies={companies} companyLinks={companyLinks}
          customers={customers} setShowCompanyModal={setShowCompanyModal}
        />
      )}

      {activeTab === '查重合併' && (
        <DuplicateMergeTab
          duplicates={duplicates} dupScanning={dupScanning}
          runDuplicateDetection={runDuplicateDetection}
          handleMerge={handleMerge}
        />
      )}

      {activeTab === '匯入匯出' && (
        <ImportExportTab
          filtered={filtered} handleExport={handleExport}
          resetImport={resetImport} setShowImportModal={setShowImportModal}
        />
      )}

      {/* Modals */}
      {showModal && (
        <CustomerFormModal
          form={form} set={set} toggleTag={toggleTag}
          locations={locations} companies={companies}
          onClose={() => setShowModal(false)} onSubmit={handleSubmit}
        />
      )}

      {showContactModal && (
        <ContactFormModal
          contactForm={contactForm} setC={setC}
          onClose={() => setShowContactModal(false)} onSubmit={handleAddContact}
        />
      )}

      {showCompanyModal && (
        <CompanyFormModal
          companyForm={companyForm} setComp={setComp}
          onClose={() => setShowCompanyModal(false)} onSubmit={handleAddCompany}
        />
      )}

      {showImportModal && (
        <ImportModal
          importStep={importStep} importData={importData}
          importMapping={importMapping} setImportMapping={setImportMapping}
          handleFileUpload={handleFileUpload}
          handleImportConfirm={handleImportConfirm}
          resetImport={resetImport}
        />
      )}
    </div>
  )
}
