import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Shield, Plus, X, AlertTriangle, CheckCircle, Building, Home, DollarSign, Users } from 'lucide-react'

const NATIONALITIES = ['越南', '印尼', '泰國', '菲律賓', '其他']
const DOC_TYPES = [
  { value: 'work_permit', label: '工作許可' },
  { value: 'arc', label: '居留證 (ARC)' },
  { value: 'health_check', label: '健康檢查' },
  { value: 'passport', label: '護照' },
  { value: 'other', label: '其他' },
]
const QUOTA_CATS = ['製造業', '服務業', '營造業', '養護機構', '農業', '其他']

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function ExpiryBadge({ expiry }) {
  const days = daysUntil(expiry)
  if (days === null) return null
  let bg, color, label
  if (days < 0)   { bg = 'var(--accent-red-dim)';    color = 'var(--accent-red)';    label = `逾期 ${Math.abs(days)} 天` }
  else if (days <= 30) { bg = 'var(--accent-red-dim)'; color = 'var(--accent-red)';  label = `剩 ${days} 天` }
  else if (days <= 90) { bg = 'var(--accent-orange-dim)'; color = 'var(--accent-orange)'; label = `剩 ${days} 天` }
  else               { bg = 'var(--accent-green-dim)'; color = 'var(--accent-green)'; label = `剩 ${days} 天` }
  return (
    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color }}>
      {label}
    </span>
  )
}

const EMPTY_PROFILE = { employee_id: '', nationality: '越南', passport_no: '', passport_expiry: '',
  broker_agency_id: '', broker_monthly_fee: 0, accommodation_fee: 0, meal_fee: 0,
  other_deductions: [], arrival_date: '', quota_category: '製造業', notes: '' }
const EMPTY_DOC = { employee_id: '', doc_type: 'work_permit', doc_number: '', issue_date: '', expiry_date: '', notes: '' }
const EMPTY_BROKER = { name: '', license_no: '', contact_name: '', contact_phone: '', contact_email: '', address: '', notes: '' }
const EMPTY_ACCOM = { name: '', address: '', capacity: 1, monthly_rent: '', notes: '' }

export default function ForeignWorkers() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [tab, setTab] = useState('overview')
  const [workers, setWorkers] = useState([])        // foreign_worker_profiles + employee
  const [docs, setDocs] = useState([])              // foreign_worker_docs
  const [brokers, setBrokers] = useState([])        // broker_agencies
  const [accommodations, setAccommodations] = useState([])
  const [assignments, setAssignments] = useState([])
  const [allEmployees, setAllEmployees] = useState([]) // for picker
  const [loading, setLoading] = useState(true)

  // Modal state
  const [profileModal, setProfileModal] = useState(null)
  const [docModal, setDocModal] = useState(null)
  const [brokerModal, setBrokerModal] = useState(null)
  const [accomModal, setAccomModal] = useState(null)
  const [assignModal, setAssignModal] = useState(null)
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE)
  const [docForm, setDocForm] = useState(EMPTY_DOC)
  const [brokerForm, setBrokerForm] = useState(EMPTY_BROKER)
  const [accomForm, setAccomForm] = useState(EMPTY_ACCOM)
  const [saving, setSaving] = useState(false)
  const [docFilter, setDocFilter] = useState('all') // all | work_permit | arc | health_check | expiring

  const load = async () => {
    setLoading(true)
    const [{ data: ws }, { data: ds }, { data: bs }, { data: acs }, { data: asns }, { data: emps }] = await Promise.all([
      supabase.from('foreign_worker_profiles')
        .select('*, employee:employees!employee_id(id, name, dept, position, store, employment_type), broker:broker_agencies!broker_agency_id(id, name, contact_phone)')
        .eq('organization_id', orgId),
      supabase.from('foreign_worker_docs')
        .select('*, employee:employees!employee_id(id, name)')
        .eq('organization_id', orgId)
        .order('expiry_date', { ascending: true }),
      supabase.from('broker_agencies').select('*').eq('organization_id', orgId).eq('is_active', true).order('name'),
      supabase.from('accommodations').select('*').eq('organization_id', orgId).order('name'),
      supabase.from('accommodation_assignments').select('*, employee:employees!employee_id(id, name), accommodation:accommodations!accommodation_id(id, name)').is('end_date', null),
      supabase.from('employees').select('id, name, dept, store').eq('organization_id', orgId).eq('status', '在職').order('name'),
    ])
    setWorkers(ws || [])
    setDocs(ds || [])
    setBrokers(bs || [])
    setAccommodations(acs || [])
    setAssignments(asns || [])
    setAllEmployees(emps || [])
    setLoading(false)
  }

  useEffect(() => { if (orgId) load() }, [orgId])

  // ── Profile CRUD ──
  const openAddProfile = () => { setProfileForm(EMPTY_PROFILE); setProfileModal({ mode: 'add' }) }
  const openEditProfile = (w) => {
    setProfileForm({ employee_id: w.employee_id, nationality: w.nationality, passport_no: w.passport_no || '',
      passport_expiry: w.passport_expiry || '', broker_agency_id: w.broker_agency_id || '',
      broker_monthly_fee: w.broker_monthly_fee || 0, accommodation_fee: w.accommodation_fee || 0,
      meal_fee: w.meal_fee || 0, other_deductions: w.other_deductions || [],
      arrival_date: w.arrival_date || '', quota_category: w.quota_category || '製造業', notes: w.notes || '' })
    setProfileModal({ mode: 'edit', id: w.id })
  }
  const saveProfile = async () => {
    if (!profileForm.employee_id) { alert('請選擇員工'); return }
    setSaving(true)
    const payload = { ...profileForm, organization_id: orgId, employee_id: Number(profileForm.employee_id),
      broker_agency_id: profileForm.broker_agency_id ? Number(profileForm.broker_agency_id) : null,
      broker_monthly_fee: Number(profileForm.broker_monthly_fee) || 0,
      accommodation_fee: Number(profileForm.accommodation_fee) || 0,
      meal_fee: Number(profileForm.meal_fee) || 0,
    }
    if (profileModal.mode === 'add') {
      await supabase.from('foreign_worker_profiles').insert(payload)
      await supabase.from('employees').update({ employment_type: '外籍' }).eq('id', payload.employee_id)
    } else {
      await supabase.from('foreign_worker_profiles').update(payload).eq('id', profileModal.id)
    }
    setSaving(false); setProfileModal(null); load()
  }

  // ── Doc CRUD ──
  const openAddDoc = (employeeId = '') => { setDocForm({ ...EMPTY_DOC, employee_id: employeeId }); setDocModal({ mode: 'add' }) }
  const openEditDoc = (d) => {
    setDocForm({ employee_id: d.employee_id, doc_type: d.doc_type, doc_number: d.doc_number || '',
      issue_date: d.issue_date || '', expiry_date: d.expiry_date, notes: d.notes || '' })
    setDocModal({ mode: 'edit', id: d.id })
  }
  const saveDoc = async () => {
    if (!docForm.employee_id || !docForm.expiry_date) { alert('請填寫員工與到期日'); return }
    setSaving(true)
    const payload = { ...docForm, organization_id: orgId, employee_id: Number(docForm.employee_id) }
    if (docModal.mode === 'add') await supabase.from('foreign_worker_docs').insert(payload)
    else await supabase.from('foreign_worker_docs').update(payload).eq('id', docModal.id)
    setSaving(false); setDocModal(null); load()
  }
  const deleteDoc = async (id) => { if (!confirm('確定刪除？')) return; await supabase.from('foreign_worker_docs').delete().eq('id', id); load() }

  // ── Broker CRUD ──
  const openAddBroker = () => { setBrokerForm(EMPTY_BROKER); setBrokerModal({ mode: 'add' }) }
  const openEditBroker = (b) => {
    setBrokerForm({ name: b.name, license_no: b.license_no || '', contact_name: b.contact_name || '',
      contact_phone: b.contact_phone || '', contact_email: b.contact_email || '', address: b.address || '', notes: b.notes || '' })
    setBrokerModal({ mode: 'edit', id: b.id })
  }
  const saveBroker = async () => {
    if (!brokerForm.name) { alert('請填寫仲介公司名稱'); return }
    setSaving(true)
    const payload = { ...brokerForm, organization_id: orgId }
    if (brokerModal.mode === 'add') await supabase.from('broker_agencies').insert(payload)
    else await supabase.from('broker_agencies').update(payload).eq('id', brokerModal.id)
    setSaving(false); setBrokerModal(null); load()
  }

  // ── Accommodation CRUD ──
  const saveAccom = async () => {
    if (!accomForm.name) { alert('請填寫宿舍名稱'); return }
    setSaving(true)
    const payload = { ...accomForm, organization_id: orgId, capacity: Number(accomForm.capacity) || 1, monthly_rent: accomForm.monthly_rent ? Number(accomForm.monthly_rent) : null }
    if (accomModal.mode === 'add') await supabase.from('accommodations').insert(payload)
    else await supabase.from('accommodations').update(payload).eq('id', accomModal.id)
    setSaving(false); setAccomModal(null); load()
  }

  const filteredDocs = useMemo(() => {
    if (docFilter === 'all') return docs
    if (docFilter === 'expiring') return docs.filter(d => { const day = daysUntil(d.expiry_date); return day !== null && day <= 90 })
    return docs.filter(d => d.doc_type === docFilter)
  }, [docs, docFilter])

  // Expiry alerts summary
  const alerts = useMemo(() => ({
    critical: docs.filter(d => { const day = daysUntil(d.expiry_date); return day !== null && day <= 30 }).length,
    warning:  docs.filter(d => { const day = daysUntil(d.expiry_date); return day !== null && day > 30 && day <= 90 }).length,
  }), [docs])

  if (loading) return <LoadingSpinner />

  const TABS = [['overview', '員工總覽'], ['docs', '證件看板'], ['brokers', '仲介管理'], ['accommodation', '宿舍管理']]

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, color: 'var(--text-primary)' }}>外籍移工管理</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{workers.length} 名外籍員工</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'overview' && <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={openAddProfile}><Plus size={15} /> 新增外籍員工</button>}
          {tab === 'docs' && <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => openAddDoc()}><Plus size={15} /> 新增證件</button>}
          {tab === 'brokers' && <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={openAddBroker}><Plus size={15} /> 新增仲介</button>}
          {tab === 'accommodation' && <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { setAccomForm(EMPTY_ACCOM); setAccomModal({ mode: 'add' }) }}><Plus size={15} /> 新增宿舍</button>}
        </div>
      </div>

      {/* Alert banner */}
      {(alerts.critical > 0 || alerts.warning > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {alerts.critical > 0 && (
            <div style={{ padding: '10px 16px', borderRadius: 10, background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent-red)', fontWeight: 700 }}>
              <AlertTriangle size={15} /> {alerts.critical} 份證件 30 天內到期或已逾期
            </div>
          )}
          {alerts.warning > 0 && (
            <div style={{ padding: '10px 16px', borderRadius: 10, background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent-orange)', fontWeight: 700 }}>
              <AlertTriangle size={15} /> {alerts.warning} 份證件 90 天內到期
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color)' }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14,
            fontWeight: tab === k ? 700 : 400,
            color: tab === k ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            borderBottom: tab === k ? '2px solid var(--accent-cyan)' : '2px solid transparent', marginBottom: -1,
          }}>{l}</button>
        ))}
      </div>

      {/* ── 員工總覽 ── */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {workers.length === 0 && (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
              <Users size={36} style={{ opacity: 0.3, marginBottom: 8 }} /><p>尚未建立外籍員工資料</p>
            </div>
          )}
          {workers.map(w => {
            const totalDeduct = (w.broker_monthly_fee || 0) + (w.accommodation_fee || 0) + (w.meal_fee || 0) +
              (w.other_deductions || []).reduce((s, d) => s + (d.amount || 0), 0)
            const myDocs = docs.filter(d => d.employee_id === w.employee_id)
            const criticalDoc = myDocs.find(d => { const day = daysUntil(d.expiry_date); return day !== null && day <= 30 })
            return (
              <div key={w.id} className="card" style={{ padding: '16px 20px', borderLeft: criticalDoc ? '3px solid var(--accent-red)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{w.employee?.name || '—'}</span>
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', fontWeight: 700 }}>{w.nationality}</span>
                      {criticalDoc && <AlertTriangle size={13} style={{ color: 'var(--accent-red)' }} />}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {w.employee?.dept || w.employee?.store || '—'} · 到台：{w.arrival_date || '—'} · {w.quota_category || '—'}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 150 }}>
                    <div style={{ fontWeight: 600 }}>每月扣款 NT$ {Number(totalDeduct).toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>仲介 {w.broker_monthly_fee || 0} · 宿舍 {w.accommodation_fee || 0} · 伙食 {w.meal_fee || 0}</div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 120 }}>
                    <div>仲介：{w.broker?.name || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{w.broker?.contact_phone || ''}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 120 }}>
                    {myDocs.length > 0 ? myDocs.map(d => {
                      const day = daysUntil(d.expiry_date)
                      return (
                        <div key={d.id} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
                          <span>{DOC_TYPES.find(t => t.value === d.doc_type)?.label || d.doc_type}</span>
                          <ExpiryBadge expiry={d.expiry_date} />
                        </div>
                      )
                    }) : <span>無證件記錄</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => openEditProfile(w)}>編輯</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => openAddDoc(w.employee_id)}>+ 證件</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 證件看板 ── */}
      {tab === 'docs' && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {[['all', '全部'], ['expiring', '即將到期'], ['work_permit', '工作許可'], ['arc', '居留證'], ['health_check', '健康檢查'], ['passport', '護照']].map(([k, l]) => (
              <button key={k} onClick={() => setDocFilter(k)} style={{
                padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)',
                background: docFilter === k ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                color: docFilter === k ? '#fff' : 'var(--text-secondary)',
                fontSize: 12, cursor: 'pointer', fontWeight: docFilter === k ? 700 : 400,
              }}>{l}</button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filteredDocs.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                <Shield size={36} style={{ opacity: 0.3, marginBottom: 8 }} /><p>沒有符合條件的證件</p>
              </div>
            )}
            {filteredDocs.map(d => {
              const days = daysUntil(d.expiry_date)
              const isCritical = days !== null && days <= 30
              const isWarning = days !== null && days > 30 && days <= 90
              return (
                <div key={d.id} className="card" style={{ padding: '16px 18px', position: 'relative', overflow: 'hidden',
                  borderLeft: `4px solid ${isCritical ? 'var(--accent-red)' : isWarning ? 'var(--accent-orange)' : 'var(--accent-green)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                        {d.employee?.name || '—'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {DOC_TYPES.find(t => t.value === d.doc_type)?.label || d.doc_type}
                        {d.doc_number && ` · ${d.doc_number}`}
                      </div>
                    </div>
                    <ExpiryBadge expiry={d.expiry_date} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                    {d.issue_date && <span>核發：{d.issue_date} → </span>}
                    到期：<strong style={{ color: isCritical ? 'var(--accent-red)' : 'var(--text-secondary)' }}>{d.expiry_date}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', flex: 1 }} onClick={() => openEditDoc(d)}>編輯</button>
                    <button onClick={() => deleteDoc(d.id)} style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--accent-red)', borderRadius: 8, background: 'transparent', color: 'var(--accent-red)', cursor: 'pointer' }}>刪除</button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── 仲介管理 ── */}
      {tab === 'brokers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {brokers.length === 0 && (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
              <Building size={36} style={{ opacity: 0.3, marginBottom: 8 }} /><p>尚未建立仲介公司資料</p>
            </div>
          )}
          {brokers.map(b => {
            const count = workers.filter(w => w.broker_agency_id === b.id).length
            return (
              <div key={b.id} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.license_no && `許可字號：${b.license_no} · `}負責人：{b.contact_name || '—'}</div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  <div>{b.contact_phone || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.contact_email || ''}</div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>管理 {count} 名員工</div>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => openEditBroker(b)}>編輯</button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 宿舍管理 ── */}
      {tab === 'accommodation' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {accommodations.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
              <Home size={36} style={{ opacity: 0.3, marginBottom: 8 }} /><p>尚未建立宿舍資料</p>
            </div>
          )}
          {accommodations.map(a => {
            const residents = assignments.filter(as => as.accommodation_id === a.id)
            const occupancy = residents.length
            return (
              <div key={a.id} className="card" style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.address || '—'}</div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    background: occupancy >= a.capacity ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)',
                    color: occupancy >= a.capacity ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    {occupancy}/{a.capacity} 人
                  </span>
                </div>
                {a.monthly_rent && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    月租：NT$ {Number(a.monthly_rent).toLocaleString()}
                  </div>
                )}
                {residents.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    {residents.map(r => (
                      <div key={r.id} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{r.employee?.name}</span>
                        {r.monthly_fee && <span style={{ color: 'var(--text-muted)' }}>NT$ {r.monthly_fee}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px', width: '100%' }}
                  onClick={() => { setAccomForm({ name: a.name, address: a.address || '', capacity: a.capacity, monthly_rent: a.monthly_rent || '', notes: a.notes || '' }); setAccomModal({ mode: 'edit', id: a.id }) }}>
                  編輯
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Profile Modal ── */}
      {profileModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>{profileModal.mode === 'add' ? '新增外籍員工' : '編輯外籍員工'}</h3>
              <button onClick={() => setProfileModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {profileModal.mode === 'add' && (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>員工 *</label>
                  <select value={profileForm.employee_id} onChange={e => setProfileForm(f => ({ ...f, employee_id: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                    <option value="">— 選擇員工 —</option>
                    {allEmployees.map(e => <option key={e.id} value={e.id}>{e.name}（{e.dept || e.store || '—'}）</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>國籍</label>
                  <select value={profileForm.nationality} onChange={e => setProfileForm(f => ({ ...f, nationality: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                    {NATIONALITIES.map(n => <option key={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>配額類別</label>
                  <select value={profileForm.quota_category} onChange={e => setProfileForm(f => ({ ...f, quota_category: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                    {QUOTA_CATS.map(q => <option key={q}>{q}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>護照號碼</label>
                  <input value={profileForm.passport_no} onChange={e => setProfileForm(f => ({ ...f, passport_no: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>護照到期日</label>
                  <input type="date" value={profileForm.passport_expiry} onChange={e => setProfileForm(f => ({ ...f, passport_expiry: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>抵台日</label>
                  <input type="date" value={profileForm.arrival_date} onChange={e => setProfileForm(f => ({ ...f, arrival_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>仲介公司</label>
                  <select value={profileForm.broker_agency_id} onChange={e => setProfileForm(f => ({ ...f, broker_agency_id: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                    <option value="">— 無 —</option>
                    {brokers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>每月扣款設定</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  {[['broker_monthly_fee', '仲介費'], ['accommodation_fee', '宿舍費'], ['meal_fee', '伙食費']].map(([k, l]) => (
                    <div key={k}>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{l} (NT$)</label>
                      <input type="number" value={profileForm[k]} onChange={e => setProfileForm(f => ({ ...f, [k]: e.target.value }))}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>備註</label>
                <textarea value={profileForm.notes} onChange={e => setProfileForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setProfileModal(null)}>取消</button>
              <button className="btn btn-primary" onClick={saveProfile} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Doc Modal ── */}
      {docModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>{docModal.mode === 'add' ? '新增證件' : '編輯證件'}</h3>
              <button onClick={() => setDocModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>員工 *</label>
                <select value={docForm.employee_id} onChange={e => setDocForm(f => ({ ...f, employee_id: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                  <option value="">— 選擇員工 —</option>
                  {workers.map(w => <option key={w.employee_id} value={w.employee_id}>{w.employee?.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>證件類型</label>
                  <select value={docForm.doc_type} onChange={e => setDocForm(f => ({ ...f, doc_type: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                    {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>證件號碼</label>
                  <input value={docForm.doc_number} onChange={e => setDocForm(f => ({ ...f, doc_number: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>核發日</label>
                  <input type="date" value={docForm.issue_date} onChange={e => setDocForm(f => ({ ...f, issue_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>到期日 *</label>
                  <input type="date" value={docForm.expiry_date} onChange={e => setDocForm(f => ({ ...f, expiry_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>備註</label>
                <input value={docForm.notes} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDocModal(null)}>取消</button>
              <button className="btn btn-primary" onClick={saveDoc} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Broker Modal ── */}
      {brokerModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>{brokerModal.mode === 'add' ? '新增仲介公司' : '編輯仲介公司'}</h3>
              <button onClick={() => setBrokerModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[['name', '公司名稱 *', 'text'], ['license_no', '許可字號', 'text'], ['contact_name', '負責人', 'text'], ['contact_phone', '聯絡電話', 'text'], ['contact_email', 'Email', 'email'], ['address', '地址', 'text']].map(([k, l, t]) => (
                <div key={k}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{l}</label>
                  <input type={t} value={brokerForm[k]} onChange={e => setBrokerForm(f => ({ ...f, [k]: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setBrokerModal(null)}>取消</button>
              <button className="btn btn-primary" onClick={saveBroker} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Accommodation Modal ── */}
      {accomModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>{accomModal.mode === 'add' ? '新增宿舍' : '編輯宿舍'}</h3>
              <button onClick={() => setAccomModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[['name', '宿舍名稱 *'], ['address', '地址']].map(([k, l]) => (
                <div key={k}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{l}</label>
                  <input value={accomForm[k]} onChange={e => setAccomForm(f => ({ ...f, [k]: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>容納人數</label>
                  <input type="number" value={accomForm.capacity} onChange={e => setAccomForm(f => ({ ...f, capacity: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>月租 (NT$)</label>
                  <input type="number" value={accomForm.monthly_rent} onChange={e => setAccomForm(f => ({ ...f, monthly_rent: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setAccomModal(null)}>取消</button>
              <button className="btn btn-primary" onClick={saveAccom} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
