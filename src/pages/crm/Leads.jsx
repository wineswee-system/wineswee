import { useState, useEffect } from 'react'
import { Plus, Trash2, UserPlus, XCircle, ArrowRight, GripVertical, Search, Filter } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getCRMLeads, createCRMLead, updateCRMLead, deleteCRMLead } from '../../lib/db'
import { calculateLeadScore } from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { getEventBus } from '../../lib/events/index.js'

const STAGES = ['新線索', '已聯繫', '合格', '已轉換', '不合格']
const SOURCES = ['官網', '展覽', '轉介', 'LINE', '廣告', '表單', '其他']
const SALES_REPS = ['王經理', '李業務', '陳主任', '張專員', '林業務']
const DQ_REASONS = ['預算不足', '需求不符', '重複', '無法聯繫', '競爭對手', '其他']

const STAGE_COLORS = {
  '新線索': { accent: 'var(--accent-blue)', dim: 'var(--accent-blue-dim, rgba(59,130,246,0.12))' },
  '已聯繫': { accent: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim, rgba(6,182,212,0.12))' },
  '合格': { accent: 'var(--accent-purple)', dim: 'var(--accent-purple-dim, rgba(139,92,246,0.12))' },
  '已轉換': { accent: 'var(--accent-green)', dim: 'var(--accent-green-dim, rgba(34,197,94,0.12))' },
  '不合格': { accent: 'var(--accent-red)', dim: 'var(--accent-red-dim, rgba(239,68,68,0.12))' },
}

const emptyForm = { name: '', company: '', phone: '', email: '', source: '官網', assigned_to: '', notes: '', tags: '' }

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('kanban')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')

  // Convert modal
  const [convertLead, setConvertLead] = useState(null)
  const [createDeal, setCreateDeal] = useState(false)
  const [dealTitle, setDealTitle] = useState('')

  // Disqualify modal
  const [dqLead, setDqLead] = useState(null)
  const [dqReason, setDqReason] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    getCRMLeads()
      .then(({ data, error: err }) => {
        if (err) throw err
        setLeads(data || [])
      })
      .catch(() => setError('載入失敗'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = leads.filter(l => {
    if (search && !l.name.includes(search) && !(l.company || '').includes(search) && !(l.email || '').includes(search)) return false
    if (sourceFilter && l.source !== sourceFilter) return false
    return true
  })

  const handleCreate = async () => {
    if (!form.name || saving) return
    setSaving(true)
    try {
      const score = calculateLeadScore({ ...form, status: '潛在' })
      const { data, error: err } = await createCRMLead({ ...form, stage: '新線索', score: score?.total || 0 })
      if (err) throw err
      setLeads(prev => [data, ...prev])
      const bus = getEventBus()
      await bus.publish('crm.lead.created', {
        lead_id: String(data.id),
        name: data.name,
        company: data.company || '',
        source: data.source || '',
        assigned_to: data.assigned_to || '',
        score: data.score || 0,
      })
      setShowModal(false)
      setForm(emptyForm)
    } catch (err) {
      alert('建立失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  const handleStageChange = async (id, stage) => {
    if (stage === '已轉換') {
      const lead = leads.find(l => l.id === id)
      setConvertLead(lead)
      setCreateDeal(false)
      setDealTitle(`${lead?.name} - 商機`)
      return
    }
    if (stage === '不合格') {
      const lead = leads.find(l => l.id === id)
      setDqLead(lead)
      setDqReason('')
      return
    }
    const { data, error: err } = await updateCRMLead(id, { stage })
    if (err) { alert('更新失敗'); return }
    setLeads(prev => prev.map(l => l.id === id ? data : l))
  }

  const handleConvert = async () => {
    if (!convertLead) return
    try {
      // Create customer
      const { data: customer, error: custErr } = await supabase.from('customers').insert({
        name: convertLead.name,
        company: convertLead.company,
        phone: convertLead.phone,
        email: convertLead.email,
        source: convertLead.source || '線索轉換',
        status: '活躍',
        assigned_to: convertLead.assigned_to,
      }).select().single()
      if (custErr) throw custErr

      let dealId = null
      // Optionally create deal
      if (createDeal && dealTitle) {
        const { data: deal, error: dealErr } = await supabase.from('opportunities').insert({
          customer_name: convertLead.name,
          title: dealTitle,
          stage: '初步接觸',
          amount: 0,
          pipeline_id: 'default',
          assignee: convertLead.assigned_to,
        }).select().single()
        if (dealErr) throw dealErr
        dealId = deal.id
      }

      // Update lead
      const { data } = await updateCRMLead(convertLead.id, {
        stage: '已轉換',
        converted_customer_id: customer.id,
        converted_deal_id: dealId,
      })
      if (data) setLeads(prev => prev.map(l => l.id === convertLead.id ? data : l))
      const bus = getEventBus()
      await bus.publish('crm.lead.converted', {
        lead_id: String(convertLead.id),
        customer_id: String(customer.id),
        deal_id: dealId ? String(dealId) : null,
        customer_name: customer.name,
        source: convertLead.source || '',
      })
      setConvertLead(null)
      alert(`線索已轉換為客戶！${dealId ? '商機也已建立。' : ''}`)
    } catch (err) {
      alert('轉換失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleDisqualify = async () => {
    if (!dqLead) return
    const { data } = await updateCRMLead(dqLead.id, { stage: '不合格', disqualify_reason: dqReason })
    if (data) setLeads(prev => prev.map(l => l.id === dqLead.id ? data : l))
    setDqLead(null)
  }

  const handleDelete = async (id) => {
    if (!confirm('確定要刪除此線索？')) return
    await deleteCRMLead(id)
    setLeads(prev => prev.filter(l => l.id !== id))
  }

  // Stats
  const activeStages = ['新線索', '已聯繫', '合格']
  const activeLeads = leads.filter(l => activeStages.includes(l.stage))
  const convertedCount = leads.filter(l => l.stage === '已轉換').length
  const dqCount = leads.filter(l => l.stage === '不合格').length
  const conversionRate = leads.length > 0 ? Math.round((convertedCount / leads.length) * 100) : 0

  const filterBtn = (active) => ({
    padding: '4px 12px', borderRadius: 7, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 11, fontWeight: 500,
  })

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><UserPlus size={20} /></span> 線索管理</h2>
            <p>Leads — 潛在客戶線索追蹤與轉換</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn ${view === 'kanban' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 12 }} onClick={() => setView('kanban')}>看板</button>
            <button className={`btn ${view === 'table' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 12 }} onClick={() => setView('table')}>列表</button>
            <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setShowModal(true) }}>
              <Plus size={14} /> 新增線索
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">進行中線索</div><div className="stat-card-value">{activeLeads.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已轉換</div><div className="stat-card-value">{convertedCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">不合格</div><div className="stat-card-value">{dqCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">轉換率</div><div className="stat-card-value">{conversionRate}%</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', maxWidth: 280 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" placeholder="搜尋姓名、公司、Email..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 30 }} />
        </div>
        <Filter size={14} style={{ color: 'var(--text-muted)' }} />
        <button style={filterBtn(!sourceFilter)} onClick={() => setSourceFilter('')}>全部來源</button>
        {SOURCES.map(s => (
          <button key={s} style={filterBtn(sourceFilter === s)} onClick={() => setSourceFilter(s)}>{s}</button>
        ))}
      </div>

      {/* KANBAN VIEW */}
      {view === 'kanban' && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
          {STAGES.filter(s => s !== '已轉換' && s !== '不合格').map(stage => {
            const stageLeads = filtered.filter(l => l.stage === stage)
            const colors = STAGE_COLORS[stage]
            return (
              <div key={stage} style={{ minWidth: 280, flex: 1, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.accent }} />
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{stage}</span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, background: colors.dim, padding: '2px 8px', borderRadius: 10 }}>{stageLeads.length}</span>
                </div>
                <div style={{ padding: 8, flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 100 }}>
                  {stageLeads.map(lead => (
                    <div key={lead.id} style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: 'var(--bg-primary)', border: `1px solid ${colors.accent}22`,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{lead.name}</div>
                      {lead.company && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{lead.company}</div>}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                        {lead.source && <span style={{ background: colors.dim, color: colors.accent, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, marginRight: 4 }}>{lead.source}</span>}
                        {lead.assigned_to || '未指派'}
                      </div>
                      {lead.score > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--accent-purple)', fontWeight: 600, marginBottom: 4 }}>分數：{lead.score}</div>
                      )}
                      <select className="form-input" style={{ fontSize: 11, padding: '2px 6px', width: '100%' }} value={lead.stage} onChange={e => handleStageChange(lead.id, e.target.value)}>
                        {STAGES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  ))}
                  {stageLeads.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>無線索</div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Converted + Disqualified columns */}
          {['已轉換', '不合格'].map(stage => {
            const stageLeads = filtered.filter(l => l.stage === stage)
            const colors = STAGE_COLORS[stage]
            return (
              <div key={stage} style={{ minWidth: 200, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)', opacity: 0.7 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: colors.accent }}>{stage}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, background: colors.dim, color: colors.accent, padding: '2px 8px', borderRadius: 10 }}>{stageLeads.length}</span>
                </div>
                <div style={{ padding: 8, maxHeight: 300, overflow: 'auto' }}>
                  {stageLeads.map(lead => (
                    <div key={lead.id} style={{ padding: '6px 8px', borderRadius: 6, marginBottom: 4, background: colors.dim, fontSize: 12 }}>
                      <span style={{ fontWeight: 600 }}>{lead.name}</span>
                      {lead.disqualify_reason && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({lead.disqualify_reason})</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* TABLE VIEW */}
      {view === 'table' && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>姓名</th><th>公司</th><th>來源</th><th>負責人</th><th>分數</th><th>階段</th><th>建立日期</th><th>操作</th></tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無線索</td></tr>}
                {filtered.map(lead => {
                  const colors = STAGE_COLORS[lead.stage] || STAGE_COLORS['新線索']
                  return (
                    <tr key={lead.id}>
                      <td style={{ fontWeight: 600 }}>
                        {lead.name}
                        {lead.email && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{lead.email}</div>}
                      </td>
                      <td style={{ fontSize: 12 }}>{lead.company || '-'}</td>
                      <td><span style={{ fontSize: 10, fontWeight: 600, background: colors.dim, color: colors.accent, padding: '1px 6px', borderRadius: 4 }}>{lead.source || '-'}</span></td>
                      <td>{lead.assigned_to || '-'}</td>
                      <td style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>{lead.score || 0}</td>
                      <td>
                        <select className="form-input" style={{ fontSize: 12, padding: '2px 6px' }} value={lead.stage} onChange={e => handleStageChange(lead.id, e.target.value)}>
                          {STAGES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(lead.created_at).toLocaleDateString('zh-TW')}</td>
                      <td>
                        <button className="btn btn-sm" style={{ color: 'var(--accent-red)', padding: '2px 6px' }} onClick={() => handleDelete(lead.id)} title="刪除">
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* NEW LEAD MODAL */}
      {showModal && (
        <Modal title="新增線索" onClose={() => setShowModal(false)} onSubmit={handleCreate} submitLabel={saving ? '建立中...' : '建立'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="姓名 *"><input className="form-input" style={{ width: '100%' }} value={form.name} onChange={e => set('name', e.target.value)} placeholder="聯絡人姓名" /></Field>
            <Field label="公司"><input className="form-input" style={{ width: '100%' }} value={form.company} onChange={e => set('company', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="電話"><input className="form-input" style={{ width: '100%' }} value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
            <Field label="Email"><input className="form-input" type="email" style={{ width: '100%' }} value={form.email} onChange={e => set('email', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="來源">
              <select className="form-input" style={{ width: '100%' }} value={form.source} onChange={e => set('source', e.target.value)}>
                {SOURCES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}>
                <option value="">未指派</option>
                {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <Field label="備註"><textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
        </Modal>
      )}

      {/* CONVERT MODAL */}
      {convertLead && (
        <Modal title="轉換線索為客戶" onClose={() => setConvertLead(null)} onSubmit={handleConvert} submitLabel="確定轉換">
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            <p>將 <strong>{convertLead.name}</strong> 轉換為正式客戶。</p>
            {convertLead.company && <p style={{ color: 'var(--text-secondary)' }}>公司：{convertLead.company}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={createDeal} onChange={e => setCreateDeal(e.target.checked)} />
              同時建立商機
            </label>
          </div>
          {createDeal && (
            <Field label="商機名稱">
              <input className="form-input" style={{ width: '100%' }} value={dealTitle} onChange={e => setDealTitle(e.target.value)} />
            </Field>
          )}
        </Modal>
      )}

      {/* DISQUALIFY MODAL */}
      {dqLead && (
        <Modal title="標記為不合格" onClose={() => setDqLead(null)} onSubmit={handleDisqualify} submitLabel="確定">
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            將 <strong>{dqLead.name}</strong> 標記為不合格線索。
          </div>
          <Field label="不合格原因">
            <select className="form-input" style={{ width: '100%' }} value={dqReason} onChange={e => setDqReason(e.target.value)}>
              <option value="">請選擇</option>
              {DQ_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
