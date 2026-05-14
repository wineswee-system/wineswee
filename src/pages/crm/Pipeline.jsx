import { useState, useEffect, useCallback } from 'react'
import { Plus, AlertTriangle, GripVertical, Clock, Trophy, XCircle, Package, ChevronDown, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEventBus } from '../../lib/events/index.js'
import { createQuotation, batchCreateQuotationLines } from '../../lib/db'
import { DEFAULT_PIPELINES, PRODUCT_CATALOG, calculateDealTotal, WIN_REASONS, LOSS_REASONS } from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import ActivityTimeline from './components/ActivityTimeline'
import NotesPanel from './components/NotesPanel'

import { toast } from '../../lib/toast'
const STAGE_PALETTE = [
  { accent: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)' },
  { accent: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)' },
  { accent: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  { accent: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  { accent: 'var(--accent-green)', dim: 'var(--accent-green-dim)' },
  { accent: 'var(--accent-red)', dim: 'var(--accent-red-dim)' },
]

function getStageColor(stages, stage) {
  const idx = stages.indexOf(stage)
  if (idx < 0) return STAGE_PALETTE[0]
  return STAGE_PALETTE[idx % STAGE_PALETTE.length]
}

function getProbability(stages, stage) {
  const total = stages.length
  const idx = stages.indexOf(stage)
  if (idx < 0) return 0
  // Last stage = win (100), second-to-last = loss (0)
  if (idx === total - 1) return 0
  if (idx === total - 2) return 100
  return Math.round((idx + 1) / (total - 2) * 100)
}

function isWinStage(stages, stage) {
  return stages.length >= 2 && stage === stages[stages.length - 2]
}

function isLossStage(stages, stage) {
  return stages.length >= 1 && stage === stages[stages.length - 1]
}

const STALE_DAYS = 14

function isDealStale(opp, stages) {
  if (isWinStage(stages, opp.stage) || isLossStage(stages, opp.stage)) return false
  const ref = opp.updated_at || opp.created_at
  if (!ref) return false
  const days = (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24)
  return days >= STALE_DAYS
}

function staleDays(opp) {
  const ref = opp.updated_at || opp.created_at
  if (!ref) return 0
  return Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24))
}

export default function Pipeline() {
  const [opps, setOpps] = useState([])
  const [customers, setCustomers] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('kanban')
  const [locFilter, setLocFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [error, setError] = useState(null)
  const [autoMsg, setAutoMsg] = useState('')

  // Multi-pipeline
  const [activePipelineId, setActivePipelineId] = useState('default')
  const activePipeline = DEFAULT_PIPELINES.find(p => p.id === activePipelineId) || DEFAULT_PIPELINES[0]
  const STAGES = activePipeline.stages

  // Form state
  const emptyForm = { customer_name: '', title: '', stage: '', amount: '', probability: 10, expected_close: '', assignee: '', notes: '', location_id: '', pipeline_id: 'default', line_items: [], win_reason: '', loss_reason: '' }
  const [form, setForm] = useState({ ...emptyForm, stage: DEFAULT_PIPELINES[0].stages[0] })

  // Line items tab in modal
  const [modalTab, setModalTab] = useState('details')

  // Win/Loss modal
  const [reasonModal, setReasonModal] = useState(null) // { oppId, stage, type: 'win'|'loss' }
  const [selectedReason, setSelectedReason] = useState('')
  const [reasonNotes, setReasonNotes] = useState('')

  // Drag state
  const [dragId, setDragId] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('opportunities').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name'),
      supabase.from('stores').select('*'),
    ]).then(([o, c, l]) => {
      setOpps(o.data || [])
      setCustomers(c.data || [])
      setLocations(l.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // --- Line Items helpers ---
  const addLineItem = () => {
    setForm(f => ({
      ...f,
      line_items: [...f.line_items, { product_id: '', product_name: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_rate: 5 }]
    }))
  }

  const updateLineItem = (idx, key, value) => {
    setForm(f => {
      const items = [...f.line_items]
      items[idx] = { ...items[idx], [key]: value }
      // If product selected, auto-fill price
      if (key === 'product_id') {
        const prod = PRODUCT_CATALOG.find(p => p.id === value)
        if (prod) {
          items[idx].product_name = prod.name
          items[idx].unit_price = prod.price
        }
      }
      return { ...f, line_items: items }
    })
  }

  const removeLineItem = (idx) => {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }))
  }

  const dealTotals = form.line_items.length > 0 ? calculateDealTotal(form.line_items) : null

  // --- Submit new opp ---
  const handleSubmit = async () => {
    if (!form.title || !form.customer_name) return
    const amount = dealTotals ? dealTotals.grandTotal : (Number(form.amount) || 0)
    const insertData = {
      customer_name: form.customer_name,
      title: form.title,
      stage: form.stage,
      amount,
      probability: getProbability(STAGES, form.stage),
      expected_close: form.expected_close || null,
      assignee: form.assignee || null,
      notes: form.notes || null,
      location_id: form.location_id || null,
      pipeline_id: form.pipeline_id || 'default',
      line_items: form.line_items.length > 0 ? form.line_items : null,
    }
    const { data } = await supabase.from('opportunities').insert(insertData).select().single()
    if (data) {
      setOpps(prev => [data, ...prev])
      setShowModal(false)
      setForm({ ...emptyForm, stage: STAGES[0], pipeline_id: activePipelineId })
      setModalTab('details')
    }
  }

  // --- Stage update with win/loss reason ---
  const updateStage = useCallback(async (id, stage, extraFields = {}) => {
    const updateData = {
      stage,
      probability: getProbability(STAGES, stage),
      updated_at: new Date().toISOString(),
      ...extraFields,
    }
    const { data } = await supabase.from('opportunities').update(updateData).eq('id', id).select().single()
    if (data) {
      setOpps(prev => prev.map(o => o.id === id ? data : o))
      // Auto AR on win
      if (isWinStage(STAGES, stage) && data.amount > 0) {
        getEventBus().publish('wms.shipment.completed', {
          shipment_id: data.id,
          customer: data.customer_name,
          order_ref: `OPP-${data.id}`,
          total_amount: data.amount,
        }, { source: 'Pipeline.jsx' })
        setAutoMsg(`\u2705 已發送成交事件，應收帳款將自動建立（NT$ ${data.amount.toLocaleString()}）`)
        setTimeout(() => setAutoMsg(''), 5000)
      }
    }
  }, [STAGES])

  const handleStageChange = (oppId, newStage) => {
    if (isWinStage(STAGES, newStage)) {
      setReasonModal({ oppId, stage: newStage, type: 'win' })
      setSelectedReason('')
      setReasonNotes('')
    } else if (isLossStage(STAGES, newStage)) {
      setReasonModal({ oppId, stage: newStage, type: 'loss' })
      setSelectedReason('')
      setReasonNotes('')
    } else {
      updateStage(oppId, newStage)
    }
  }

  const submitReason = () => {
    if (!reasonModal || !selectedReason) return
    const extra = reasonModal.type === 'win'
      ? { win_reason: selectedReason, win_reason_notes: reasonNotes }
      : { loss_reason: selectedReason, loss_reason_notes: reasonNotes }
    updateStage(reasonModal.oppId, reasonModal.stage, extra)
    setReasonModal(null)
  }

  // --- Drag & Drop ---
  const onDragStart = (e, oppId) => {
    setDragId(oppId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', oppId)
  }

  const onDragOver = (e, stage) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stage)
  }

  const onDragLeave = () => {
    setDragOverStage(null)
  }

  const onDrop = (e, stage) => {
    e.preventDefault()
    setDragOverStage(null)
    const oppId = e.dataTransfer.getData('text/plain') || dragId
    if (!oppId) return
    const opp = opps.find(o => String(o.id) === String(oppId))
    if (opp && opp.stage !== stage) {
      handleStageChange(opp.id, stage)
    }
    setDragId(null)
  }

  const onDragEnd = () => {
    setDragId(null)
    setDragOverStage(null)
  }

  /* ── Generate quotation from deal ─────────────── */
  const generateQuote = async (opp) => {
    try {
      const quoteNumber = `QT-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-4)}`
      const lineItems = opp.line_items || []
      const totals = lineItems.length > 0 ? calculateDealTotal(lineItems) : null

      const { data: quote, error: qErr } = await createQuotation({
        quote_number: quoteNumber,
        customer: opp.customer_name,
        items: lineItems,
        subtotal: totals ? totals.subtotal : (opp.amount || 0),
        discount: totals ? totals.totalDiscount : 0,
        tax: totals ? totals.totalTax : 0,
        total: totals ? totals.grandTotal : (opp.amount || 0),
        valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        notes: `來自商機：${opp.title}`,
        status: '草稿',
        created_by: opp.assignee || '系統',
      })
      if (qErr) throw qErr

      // Create quotation lines if deal has line items
      if (lineItems.length > 0 && quote) {
        const lines = lineItems.map(item => ({
          quotation_id: quote.id,
          description: item.product_name || item.name || '',
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          discount_percent: item.discount_percent || 0,
          tax_rate: (item.tax_rate || 5) / 100,
        }))
        await batchCreateQuotationLines(lines)
      }

      toast.error(`報價單 ${quoteNumber} 已建立！\n金額：NT$ ${(quote.total || opp.amount || 0).toLocaleString()}\n可在「銷售管理 > 報價單」查看`)
    } catch (err) {
      toast.error('建立報價單失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = opps.filter(o => locFilter === '' || String(o.location_id) === locFilter)
    .filter(o => !o.pipeline_id || o.pipeline_id === activePipelineId)
  const activeOpps = filtered.filter(o => !isWinStage(STAGES, o.stage) && !isLossStage(STAGES, o.stage))
  const totalForecast = activeOpps.reduce((s, o) => s + (o.amount || 0) * ((o.probability || 0) / 100), 0)

  const filterBtnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  const pipelineBtnStyle = (active) => ({
    padding: '7px 18px', borderRadius: 8, border: active ? '2px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
    color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.15s ease'
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon">{'\u{1F4C8}'}</span> 銷售漏斗</h2><p>商機管理與業績預測</p></div>
          <button className="btn btn-primary" onClick={() => { setForm({ ...emptyForm, stage: STAGES[0], pipeline_id: activePipelineId }); setModalTab('details'); setShowModal(true) }}><Plus size={14} /> 新增商機</button>
        </div>
        {autoMsg && (
          <div style={{ marginTop: 8, padding: '10px 16px', borderRadius: 10, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontSize: 13, fontWeight: 600 }}>
            {autoMsg}
          </div>
        )}
      </div>

      {/* Pipeline selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {DEFAULT_PIPELINES.map(p => (
          <button key={p.id} style={pipelineBtnStyle(activePipelineId === p.id)} onClick={() => setActivePipelineId(p.id)}>
            {p.name}
          </button>
        ))}
      </div>

      {/* Location filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={filterBtnStyle(locFilter === '')} onClick={() => setLocFilter('')}>全部分店</button>
        {locations.map(l => (
          <button key={l.id} style={filterBtnStyle(locFilter === String(l.id))} onClick={() => setLocFilter(String(l.id))}>{l.name}</button>
        ))}
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">進行中商機</div><div className="stat-card-value">{activeOpps.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">商機總金額</div><div className="stat-card-value">$ {activeOpps.reduce((s, o) => s + (o.amount || 0), 0).toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">預計成交金額</div><div className="stat-card-value">$ {Math.round(totalForecast).toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">本月贏單</div><div className="stat-card-value">{filtered.filter(o => isWinStage(STAGES, o.stage)).length}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {[['kanban', '\u{1F4CB} 看板'], ['table', '\u{1F4CA} 列表']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: view === k ? 'var(--accent-cyan)' : 'transparent', color: view === k ? '#fff' : 'var(--text-muted)' }}>{l}</button>
        ))}
      </div>

      {view === 'kanban' && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 12, overflowX: 'auto' }}>
          {STAGES.map(stage => {
            const stageOpps = filtered.filter(o => o.stage === stage)
            const color = getStageColor(STAGES, stage)
            const isOver = dragOverStage === stage
            return (
              <div
                key={stage}
                style={{ minWidth: 160 }}
                onDragOver={(e) => onDragOver(e, stage)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, stage)}
              >
                <div style={{ padding: '8px 12px', borderRadius: '8px 8px 0 0', background: color.dim, borderBottom: `2px solid ${color.accent}`, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: color.accent }}>{stage}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stageOpps.length} 筆 · ${stageOpps.reduce((s, o) => s + (o.amount || 0), 0).toLocaleString()}</div>
                </div>
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60,
                  borderRadius: 8,
                  transition: 'all 0.2s ease',
                  background: isOver ? color.dim : 'transparent',
                  border: isOver ? `2px dashed ${color.accent}` : '2px dashed transparent',
                  padding: isOver ? 6 : 0,
                }}>
                  {stageOpps.map(o => {
                    const stale = isDealStale(o, STAGES)
                    const dragging = String(dragId) === String(o.id)
                    return (
                      <div
                        key={o.id}
                        className="card"
                        draggable
                        onDragStart={(e) => onDragStart(e, o.id)}
                        onDragEnd={onDragEnd}
                        style={{
                          padding: '10px 12px',
                          cursor: 'grab',
                          opacity: dragging ? 0.4 : 1,
                          transform: dragging ? 'scale(0.95)' : 'none',
                          transition: 'opacity 0.15s, transform 0.15s',
                          borderLeft: stale ? '3px solid var(--accent-orange)' : undefined,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                          <GripVertical size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <div style={{ fontWeight: 700, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title}</div>
                          {stale && (
                            <span title={`已停滯 ${staleDays(o)} 天未推進`} style={{ display: 'flex', alignItems: 'center' }}>
                              <Clock size={13} style={{ color: 'var(--accent-orange)' }} />
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{o.customer_name}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: color.accent, marginBottom: 6 }}>$ {(o.amount || 0).toLocaleString()}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                          成交率 {o.probability}% · {o.expected_close || '未設定'}
                          {stale && <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}> · 停滯{staleDays(o)}天</span>}
                        </div>
                        {o.win_reason && <div style={{ fontSize: 10, color: 'var(--accent-green)', marginBottom: 4 }}><Trophy size={10} /> {o.win_reason}</div>}
                        {o.loss_reason && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginBottom: 4 }}><XCircle size={10} /> {o.loss_reason}</div>}
                        <select className="form-input" style={{ fontSize: 11, padding: '2px 6px', width: '100%' }} value={o.stage} onChange={e => handleStageChange(o.id, e.target.value)}>
                          {STAGES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {view === 'table' && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>商機名稱</th><th>客戶</th><th>分店</th><th>金額</th><th>成交率</th><th>預計成交</th><th>負責人</th><th>狀態</th><th>階段</th><th style={{ width: 60 }}>操作</th></tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無商機</td></tr>}
                {filtered.map(o => {
                  const stale = isDealStale(o, STAGES)
                  return (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {stale && <Clock size={13} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} title={`停滯 ${staleDays(o)} 天`} />}
                          {o.title}
                        </div>
                      </td>
                      <td>{o.customer_name}</td>
                      <td style={{ fontSize: 12 }}>{locations.find(l => l.id === o.location_id)?.name || '-'}</td>
                      <td style={{ fontWeight: 700 }}>$ {(o.amount || 0).toLocaleString()}</td>
                      <td>{o.probability}%</td>
                      <td style={{ fontSize: 12 }}>{o.expected_close || '-'}</td>
                      <td>{o.assignee}</td>
                      <td style={{ fontSize: 11 }}>
                        {o.win_reason && <span style={{ color: 'var(--accent-green)' }}><Trophy size={10} /> {o.win_reason}</span>}
                        {o.loss_reason && <span style={{ color: 'var(--accent-red)' }}><XCircle size={10} /> {o.loss_reason}</span>}
                        {stale && <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}> 停滯{staleDays(o)}天</span>}
                      </td>
                      <td>
                        <select className="form-input" style={{ fontSize: 12, padding: '2px 6px' }} value={o.stage} onChange={e => handleStageChange(o.id, e.target.value)}>
                          {STAGES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--accent-purple)' }} onClick={() => generateQuote(o)} title="產生報價單">
                          <FileText size={12} />
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

      {/* New opportunity modal */}
      {showModal && (
        <Modal title="新增商機" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-elevated)', borderRadius: 8, padding: 3, border: '1px solid var(--border-subtle)' }}>
            {[['details', '\u{1F4DD} 基本資料'], ['items', '\u{1F4E6} 產品明細'], ['related', '\u{1F4CB} 活動/備註']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setModalTab(k)} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: modalTab === k ? 'var(--accent-cyan)' : 'transparent', color: modalTab === k ? '#fff' : 'var(--text-muted)' }}>{l}</button>
            ))}
          </div>

          {modalTab === 'details' && (
            <>
              <Field label="商機名稱" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="Q3 大單採購..." value={form.title} onChange={e => set('title', e.target.value)} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="客戶名稱" required>
                  <input className="form-input" type="text" style={{ width: '100%' }} list="customer-list" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
                  <datalist id="customer-list">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist>
                </Field>
                <Field label="所屬分店">
                  <select className="form-input" style={{ width: '100%' }} value={form.location_id} onChange={e => set('location_id', e.target.value)}>
                    <option value="">請選擇分店</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="金額（手動）">
                  <input className="form-input" type="number" style={{ width: '100%' }} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder={dealTotals ? `自動計算: ${dealTotals.grandTotal}` : ''} />
                </Field>
                <Field label="預計成交日"><input className="form-input" type="date" style={{ width: '100%' }} value={form.expected_close} onChange={e => set('expected_close', e.target.value)} /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="負責業務"><input className="form-input" type="text" style={{ width: '100%' }} value={form.assignee} onChange={e => set('assignee', e.target.value)} /></Field>
                <Field label="階段">
                  <select className="form-input" style={{ width: '100%' }} value={form.stage} onChange={e => set('stage', e.target.value)}>
                    {STAGES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="備註"><textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
            </>
          )}

          {modalTab === 'items' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  <Package size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  產品明細 ({form.line_items.length} 項)
                </div>
                <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={addLineItem}>
                  <Plus size={12} /> 新增品項
                </button>
              </div>

              {form.line_items.length === 0 && (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                  尚未新增產品，點選「新增品項」開始
                </div>
              )}

              {form.line_items.map((item, idx) => (
                <div key={idx} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 12, marginBottom: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>品項 #{idx + 1}</span>
                    <button type="button" onClick={() => removeLineItem(idx)} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>移除</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
                    <Field label="產品">
                      <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={item.product_id} onChange={e => updateLineItem(idx, 'product_id', e.target.value)}>
                        <option value="">選擇產品</option>
                        {PRODUCT_CATALOG.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit}) - ${p.price}</option>)}
                      </select>
                    </Field>
                    <Field label="數量">
                      <input className="form-input" type="number" min="1" style={{ width: '100%', fontSize: 12 }} value={item.quantity} onChange={e => updateLineItem(idx, 'quantity', Number(e.target.value))} />
                    </Field>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <Field label="單價">
                      <input className="form-input" type="number" style={{ width: '100%', fontSize: 12 }} value={item.unit_price} onChange={e => updateLineItem(idx, 'unit_price', Number(e.target.value))} />
                    </Field>
                    <Field label="折扣 %">
                      <input className="form-input" type="number" min="0" max="100" style={{ width: '100%', fontSize: 12 }} value={item.discount_percent} onChange={e => updateLineItem(idx, 'discount_percent', Number(e.target.value))} />
                    </Field>
                    <Field label="稅率 %">
                      <input className="form-input" type="number" min="0" style={{ width: '100%', fontSize: 12 }} value={item.tax_rate} onChange={e => updateLineItem(idx, 'tax_rate', Number(e.target.value))} />
                    </Field>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    小計: $ {((item.quantity || 0) * (item.unit_price || 0)).toLocaleString()}
                  </div>
                </div>
              ))}

              {dealTotals && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 10, padding: 14, border: '1px solid var(--border-medium)', marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>
                    <span>小計</span><span>$ {dealTotals.subtotal.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, color: 'var(--accent-orange)' }}>
                    <span>折扣</span><span>-$ {dealTotals.totalDiscount.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8, color: 'var(--text-secondary)' }}>
                    <span>稅金</span><span>$ {dealTotals.totalTax.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, borderTop: '1px solid var(--border-subtle)', paddingTop: 8, color: 'var(--accent-cyan)' }}>
                    <span>合計</span><span>$ {dealTotals.grandTotal.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {modalTab === 'related' && form.id ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: 12 }}>
                <ActivityTimeline entityType="opportunity" entityId={form.id} />
              </div>
              <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: 12 }}>
                <NotesPanel entityType="opportunity" entityId={form.id} />
              </div>
            </div>
          ) : modalTab === 'related' ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              請先儲存商機後再新增活動與備註
            </div>
          ) : null}
        </Modal>
      )}

      {/* Win/Loss Reason Modal */}
      {reasonModal && (
        <Modal
          title={reasonModal.type === 'win' ? '\u{1F3C6} 贏單原因' : '\u274C 輸單原因'}
          onClose={() => setReasonModal(null)}
          onSubmit={submitReason}
        >
          <Field label={reasonModal.type === 'win' ? '贏單原因 *' : '輸單原因 *'}>
            <select className="form-input" style={{ width: '100%' }} value={selectedReason} onChange={e => setSelectedReason(e.target.value)}>
              <option value="">請選擇原因</option>
              {(reasonModal.type === 'win' ? WIN_REASONS : LOSS_REASONS).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="補充說明">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={reasonNotes} onChange={e => setReasonNotes(e.target.value)} placeholder="詳細說明..." />
          </Field>
          {reasonModal.type === 'win' && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontSize: 12, marginTop: 8 }}>
              <Trophy size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              確認後將自動產生應收帳款
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
