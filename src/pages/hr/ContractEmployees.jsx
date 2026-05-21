import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { FileCheck, Plus, Search, X, ChevronDown, ChevronUp, RefreshCcw, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react'

const CONTRACT_TYPES = ['定期勞動契約', '勞務承攬', '兼職', '派遣']
const PAY_TYPES = [{ value: 'monthly', label: '月薪' }, { value: 'hourly', label: '時薪' }, { value: 'project', label: '專案制' }]
const STATUS_FILTERS = ['全部', '進行中', '即將到期', '已過期', '已終止']

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function contractStatus(c) {
  if (c.status === 'terminated') return 'terminated'
  if (c.status === 'renewed') return 'renewed'
  const days = daysUntil(c.end_date)
  if (days === null) return 'active'
  if (days < 0) return 'expired'
  if (days <= 30) return 'expiring'
  return 'active'
}

function StatusChip({ status }) {
  const map = {
    active:     { label: '進行中', bg: 'var(--accent-green-dim)', color: 'var(--accent-green)' },
    expiring:   { label: '即將到期', bg: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' },
    expired:    { label: '已過期', bg: 'var(--accent-red-dim)', color: 'var(--accent-red)' },
    terminated: { label: '已終止', bg: 'var(--bg-secondary)', color: 'var(--text-muted)' },
    renewed:    { label: '已續約', bg: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' },
  }
  const s = map[status] || map.active
  return (
    <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

const EMPTY_FORM = { employee_id: '', contract_type: '定期勞動契約', position: '', department: '', store: '',
  start_date: '', end_date: '', pay_type: 'monthly', monthly_pay: '', hourly_rate: '', notes: '' }

export default function ContractEmployees() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [tab, setTab] = useState('list')
  const [contracts, setContracts] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('全部')
  const [modal, setModal] = useState(null) // null | { mode: 'add'|'edit'|'renew', data }
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: cs }, { data: emps }] = await Promise.all([
      supabase.from('employee_contracts')
        .select('*, employee:employees!employee_id(id, name, dept, position, store)')
        .eq('organization_id', orgId)
        .order('end_date', { ascending: true }),
      supabase.from('employees')
        .select('id, name, dept, position, store, employment_type')
        .eq('organization_id', orgId)
        .in('employment_type', ['約聘', '派遣'])
        .eq('status', '在職')
        .order('name'),
    ])
    setContracts(cs || [])
    setEmployees(emps || [])
    setLoading(false)
  }

  useEffect(() => { if (orgId) load() }, [orgId])

  const filtered = useMemo(() => {
    return contracts.filter(c => {
      const st = contractStatus(c)
      const matchStatus = statusFilter === '全部' ||
        (statusFilter === '進行中' && st === 'active') ||
        (statusFilter === '即將到期' && st === 'expiring') ||
        (statusFilter === '已過期' && st === 'expired') ||
        (statusFilter === '已終止' && st === 'terminated')
      const name = c.employee?.name || ''
      const matchSearch = !search || name.includes(search) || (c.position || '').includes(search)
      return matchStatus && matchSearch
    })
  }, [contracts, statusFilter, search])

  // Expiry summary
  const expiryGroups = useMemo(() => {
    const now = new Date()
    const in30 = contracts.filter(c => { const d = daysUntil(c.end_date); return d !== null && d >= 0 && d <= 30 && contractStatus(c) !== 'terminated' })
    const in60 = contracts.filter(c => { const d = daysUntil(c.end_date); return d !== null && d > 30 && d <= 60 && contractStatus(c) !== 'terminated' })
    const expired = contracts.filter(c => contractStatus(c) === 'expired')
    return { in30, in60, expired }
  }, [contracts])

  const openAdd = () => { setForm(EMPTY_FORM); setModal({ mode: 'add' }) }
  const openEdit = (c) => {
    setForm({ employee_id: c.employee_id, contract_type: c.contract_type, position: c.position || '',
      department: c.department || '', store: c.store || '', start_date: c.start_date, end_date: c.end_date,
      pay_type: c.pay_type, monthly_pay: c.monthly_pay || '', hourly_rate: c.hourly_rate || '', notes: c.notes || '' })
    setModal({ mode: 'edit', id: c.id })
  }
  const openRenew = (c) => {
    setForm({ employee_id: c.employee_id, contract_type: c.contract_type, position: c.position || '',
      department: c.department || '', store: c.store || '', start_date: c.end_date, end_date: '',
      pay_type: c.pay_type, monthly_pay: c.monthly_pay || '', hourly_rate: c.hourly_rate || '', notes: '' })
    setModal({ mode: 'renew', renewOf: c.id })
  }

  const handleSave = async () => {
    if (!form.employee_id || !form.start_date || !form.end_date) { alert('請填寫員工、起始日、結束日'); return }
    setSaving(true)
    const payload = { ...form, organization_id: orgId,
      employee_id: Number(form.employee_id),
      monthly_pay: form.monthly_pay ? Number(form.monthly_pay) : null,
      hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
    }
    if (modal.mode === 'add') {
      await supabase.from('employee_contracts').insert(payload)
    } else if (modal.mode === 'edit') {
      await supabase.from('employee_contracts').update(payload).eq('id', modal.id)
    } else if (modal.mode === 'renew') {
      await supabase.from('employee_contracts').insert({ ...payload, renewal_of: modal.renewOf })
      await supabase.from('employee_contracts').update({ status: 'renewed' }).eq('id', modal.renewOf)
    }
    setSaving(false)
    setModal(null)
    load()
  }

  const handleTerminate = async (id) => {
    if (!confirm('確定終止此合約？')) return
    await supabase.from('employee_contracts').update({ status: 'terminated' }).eq('id', id)
    load()
  }

  if (loading) return <LoadingSpinner />

  const counts = { active: contracts.filter(c => contractStatus(c) === 'active').length,
    expiring: contracts.filter(c => contractStatus(c) === 'expiring').length,
    expired: contracts.filter(c => contractStatus(c) === 'expired').length }

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, color: 'var(--text-primary)' }}>約聘管理</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{contracts.length} 份合約</p>
        </div>
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={openAdd}>
          <Plus size={15} /> 新增合約
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: '進行中', count: counts.active, icon: CheckCircle, color: 'var(--accent-green)' },
          { label: '即將到期（≤30天）', count: counts.expiring, icon: AlertTriangle, color: 'var(--accent-orange)' },
          { label: '已過期', count: counts.expired, icon: XCircle, color: 'var(--accent-red)' },
        ].map(({ label, count, icon: Icon, color }) => (
          <div key={label} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
              <Icon size={20} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{count}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color)' }}>
        {[['list', '合約列表'], ['expiry', '到期追蹤']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: tab === k ? 700 : 400,
            color: tab === k ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            borderBottom: tab === k ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            marginBottom: -1,
          }}>{l}</button>
        ))}
      </div>

      {tab === 'list' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋員工姓名 / 職稱"
                style={{ width: '100%', paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                  border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)', fontSize: 13 }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {STATUS_FILTERS.map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)',
                  background: statusFilter === s ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                  color: statusFilter === s ? '#fff' : 'var(--text-secondary)',
                  fontSize: 12, cursor: 'pointer', fontWeight: statusFilter === s ? 700 : 400,
                }}>{s}</button>
              ))}
            </div>
          </div>

          {/* Contract list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                <FileCheck size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
                <p>沒有符合條件的合約</p>
              </div>
            )}
            {filtered.map(c => {
              const st = contractStatus(c)
              const days = daysUntil(c.end_date)
              return (
                <div key={c.id} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {c.employee?.name || '—'}
                      </span>
                      <StatusChip status={st} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.contract_type} · {c.position || c.employee?.position || '—'} · {c.department || c.employee?.dept || '—'}
                    </div>
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 160 }}>
                    <div>{c.start_date} ～ {c.end_date}</div>
                    {days !== null && st !== 'terminated' && (
                      <div style={{ fontSize: 12, color: days < 0 ? 'var(--accent-red)' : days <= 30 ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                        {days < 0 ? `已過期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `剩 ${days} 天`}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 100 }}>
                    {c.pay_type === 'monthly' && c.monthly_pay && `NT$ ${Number(c.monthly_pay).toLocaleString()} / 月`}
                    {c.pay_type === 'hourly' && c.hourly_rate && `NT$ ${c.hourly_rate} / 時`}
                    {c.pay_type === 'project' && '專案制'}
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }}
                      onClick={() => openEdit(c)}>編輯</button>
                    {st !== 'terminated' && st !== 'renewed' && (
                      <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => openRenew(c)}>
                        <RefreshCcw size={12} /> 續約
                      </button>
                    )}
                    {st !== 'terminated' && (
                      <button onClick={() => handleTerminate(c.id)} style={{
                        fontSize: 12, padding: '5px 12px', borderRadius: 8,
                        border: '1px solid var(--accent-red)', background: 'transparent',
                        color: 'var(--accent-red)', cursor: 'pointer' }}>終止</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {tab === 'expiry' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {[
            { title: '本月到期（≤30 天）', items: expiryGroups.in30, color: 'var(--accent-orange)' },
            { title: '次月到期（31-60 天）', items: expiryGroups.in60, color: 'var(--accent-blue)' },
            { title: '已過期', items: expiryGroups.expired, color: 'var(--accent-red)' },
          ].map(({ title, items, color }) => (
            <div key={title}>
              <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} /> {title}（{items.length} 筆）
              </div>
              {items.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', paddingLeft: 4 }}>無</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map(c => {
                    const days = daysUntil(c.end_date)
                    return (
                      <div key={c.id} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${color}` }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>{c.employee?.name}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{c.contract_type}</span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>到期：{c.end_date}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color }}>
                          {days !== null && days < 0 ? `逾期 ${Math.abs(days)} 天` : `剩 ${days} 天`}
                        </div>
                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => openRenew(c)}>
                          <RefreshCcw size={11} /> 續約
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--text-primary)' }}>
                { modal.mode === 'add' ? '新增合約' : modal.mode === 'renew' ? '續約' : '編輯合約' }
              </h3>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>員工 *</label>
                <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                  disabled={modal.mode !== 'add'}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                  <option value="">— 選擇員工 —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}（{e.dept || e.store || '—'}）</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>合約類型</label>
                  <select value={form.contract_type} onChange={e => setForm(f => ({ ...f, contract_type: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                    {CONTRACT_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>職稱</label>
                  <input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>起始日 *</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>結束日 *</label>
                  <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>薪資類型</label>
                  <select value={form.pay_type} onChange={e => setForm(f => ({ ...f, pay_type: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }}>
                    {PAY_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    {form.pay_type === 'hourly' ? '時薪 (NT$)' : '月薪 (NT$)'}
                  </label>
                  <input type="number" value={form.pay_type === 'hourly' ? form.hourly_rate : form.monthly_pay}
                    onChange={e => setForm(f => form.pay_type === 'hourly'
                      ? { ...f, hourly_rate: e.target.value }
                      : { ...f, monthly_pay: e.target.value })}
                    disabled={form.pay_type === 'project'}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>備註</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>取消</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '儲存中…' : modal.mode === 'renew' ? '建立續約' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
