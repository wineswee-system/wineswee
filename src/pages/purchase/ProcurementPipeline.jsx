import React, { useState, useEffect, useCallback } from 'react'
import { Plus, GripVertical, Clock, Search, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, FileText, User, DollarSign } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const STAGES = ['需求確認', '供應商評估', '報價比較', '審核中', '採購下單', '交貨追蹤', '驗收完成', '已取消']

const STAGE_PALETTE = [
  { accent: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)' },
  { accent: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)' },
  { accent: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  { accent: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  { accent: 'var(--accent-green)', dim: 'var(--accent-green-dim)' },
  { accent: '#60a5fa', dim: 'rgba(96,165,250,0.12)' },
  { accent: 'var(--accent-green)', dim: 'var(--accent-green-dim)' },
  { accent: 'var(--accent-red)', dim: 'var(--accent-red-dim)' },
]

function getStageColor(stage) {
  const idx = STAGES.indexOf(stage)
  return idx >= 0 ? STAGE_PALETTE[idx] : STAGE_PALETTE[0]
}

const PRIORITY_MAP = {
  '緊急': { color: 'var(--accent-red)', bg: 'rgba(239,68,68,0.12)' },
  '高': { color: 'var(--accent-orange)', bg: 'rgba(249,115,22,0.12)' },
  '中': { color: 'var(--accent-cyan)', bg: 'rgba(34,211,238,0.12)' },
  '低': { color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' },
}

const PRIORITIES = ['緊急', '高', '中', '低']
const STALE_DAYS = 7

function isStale(item) {
  if (item.stage === '驗收完成' || item.stage === '已取消') return false
  const ref = item.updated_at || item.created_at
  if (!ref) return false
  return (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24) >= STALE_DAYS
}

function staleDays(item) {
  const ref = item.updated_at || item.created_at
  if (!ref) return 0
  return Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24))
}

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

export default function ProcurementPipeline() {
  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('kanban')
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')

  const emptyForm = {
    title: '', description: '', stage: STAGES[0], priority: '中',
    requester: '', department: '', supplier_name: '', estimated_amount: '',
    expected_date: '', notes: '',
  }
  const [form, setForm] = useState({ ...emptyForm })

  // Drag state
  const [dragId, setDragId] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('procurement_pipeline').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name'),
    ]).then(([p, s]) => {
      setItems(p.data || [])
      setSuppliers(s.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.title || !form.requester) return
    const insertData = {
      title: form.title,
      description: form.description || null,
      stage: form.stage,
      priority: form.priority,
      requester: form.requester,
      department: form.department || null,
      supplier_name: form.supplier_name || null,
      estimated_amount: Number(form.estimated_amount) || 0,
      expected_date: form.expected_date || null,
      notes: form.notes || null,
    }
    const { data } = await supabase.from('procurement_pipeline').insert(insertData).select().single()
    if (data) {
      setItems(prev => [data, ...prev])
      setShowModal(false)
      setForm({ ...emptyForm })
    }
  }

  const updateStage = useCallback(async (id, stage) => {
    const { data } = await supabase.from('procurement_pipeline')
      .update({ stage, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data) setItems(prev => prev.map(i => i.id === id ? data : i))
  }, [])

  // Drag & Drop
  const onDragStart = (e, id) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }
  const onDragOver = (e, stage) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage(stage) }
  const onDragLeave = () => setDragOverStage(null)
  const onDrop = (e, stage) => {
    e.preventDefault(); setDragOverStage(null)
    const itemId = e.dataTransfer.getData('text/plain') || dragId
    if (!itemId) return
    const item = items.find(i => String(i.id) === String(itemId))
    if (item && item.stage !== stage) updateStage(item.id, stage)
    setDragId(null)
  }
  const onDragEnd = () => { setDragId(null); setDragOverStage(null) }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = items.filter(i =>
    search === '' ||
    i.title?.includes(search) ||
    i.requester?.includes(search) ||
    i.supplier_name?.includes(search) ||
    i.department?.includes(search)
  )

  const activeItems = filtered.filter(i => i.stage !== '驗收完成' && i.stage !== '已取消')
  const totalEstimated = activeItems.reduce((s, i) => s + (i.estimated_amount || 0), 0)
  const urgentCount = activeItems.filter(i => i.priority === '緊急').length
  const staleCount = activeItems.filter(i => isStale(i)).length

  const viewBtnStyle = (active) => ({
    padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 500,
    background: active ? 'var(--accent-cyan)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">{'\u{1F6D2}'}</span> 採購流程管線</h2>
            <p>追蹤採購需求從提出到驗收的完整流程</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm({ ...emptyForm }); setShowModal(true) }}>
            <Plus size={14} /> 新增採購項目
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">進行中項目</div>
          <div className="stat-card-value">{activeItems.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">預估總金額</div>
          <div className="stat-card-value">{fmt(totalEstimated)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">緊急項目</div>
          <div className="stat-card-value">{urgentCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">停滯項目</div>
          <div className="stat-card-value">{staleCount}</div>
        </div>
      </div>

      {/* View toggle + Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
          {[['kanban', '\u{1F4CB} 看板'], ['table', '\u{1F4CA} 列表']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={viewBtnStyle(view === k)}>{l}</button>
          ))}
        </div>
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <Search className="search-icon" />
          <input type="text" placeholder="搜尋項目、申請人、供應商..." className="form-input" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Kanban View */}
      {view === 'kanban' && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 10, overflowX: 'auto', paddingBottom: 16 }}>
          {STAGES.map(stage => {
            const stageItems = filtered.filter(i => i.stage === stage)
            const color = getStageColor(stage)
            const isOver = dragOverStage === stage
            return (
              <div key={stage} style={{ minWidth: 170 }}
                onDragOver={(e) => onDragOver(e, stage)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, stage)}
              >
                <div style={{ padding: '8px 12px', borderRadius: '8px 8px 0 0', background: color.dim, borderBottom: `2px solid ${color.accent}`, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: color.accent }}>{stage}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {stageItems.length} 筆 · {fmt(stageItems.reduce((s, i) => s + (i.estimated_amount || 0), 0))}
                  </div>
                </div>
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60,
                  borderRadius: 8, transition: 'all 0.2s ease',
                  background: isOver ? color.dim : 'transparent',
                  border: isOver ? `2px dashed ${color.accent}` : '2px dashed transparent',
                  padding: isOver ? 6 : 0,
                }}>
                  {stageItems.map(item => {
                    const stale = isStale(item)
                    const dragging = String(dragId) === String(item.id)
                    const pri = PRIORITY_MAP[item.priority] || PRIORITY_MAP['中']
                    return (
                      <div key={item.id} className="card" draggable
                        onDragStart={(e) => onDragStart(e, item.id)}
                        onDragEnd={onDragEnd}
                        style={{
                          padding: '10px 12px', cursor: 'grab',
                          opacity: dragging ? 0.4 : 1,
                          transform: dragging ? 'scale(0.95)' : 'none',
                          transition: 'opacity 0.15s, transform 0.15s',
                          borderLeft: stale ? '3px solid var(--accent-orange)' : `3px solid ${pri.color}`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                          <GripVertical size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <div style={{ fontWeight: 700, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.title}
                          </div>
                          {stale && <Clock size={13} style={{ color: 'var(--accent-orange)' }} title={`停滯 ${staleDays(item)} 天`} />}
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: pri.bg, color: pri.color, fontWeight: 600 }}>
                            {item.priority}
                          </span>
                          {item.department && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                              {item.department}
                            </span>
                          )}
                        </div>
                        {item.supplier_name && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                            <User size={10} style={{ marginRight: 2 }} />{item.supplier_name}
                          </div>
                        )}
                        <div style={{ fontSize: 13, fontWeight: 700, color: color.accent, marginBottom: 4 }}>
                          {fmt(item.estimated_amount)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {item.requester} · {item.expected_date || '未設定日期'}
                          {stale && <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}> · 停滯{staleDays(item)}天</span>}
                        </div>
                        <select className="form-input" style={{ fontSize: 11, padding: '2px 6px', width: '100%', marginTop: 6 }}
                          value={item.stage} onChange={e => updateStage(item.id, e.target.value)}>
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

      {/* Table View */}
      {view === 'table' && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>項目名稱</th>
                  <th>優先度</th>
                  <th>申請人</th>
                  <th>部門</th>
                  <th>供應商</th>
                  <th>預估金額</th>
                  <th>預計日期</th>
                  <th>階段</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無採購項目</td></tr>
                )}
                {filtered.map(item => {
                  const stale = isStale(item)
                  const pri = PRIORITY_MAP[item.priority] || PRIORITY_MAP['中']
                  return (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {stale && <Clock size={13} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} title={`停滯 ${staleDays(item)} 天`} />}
                          {item.title}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: pri.bg, color: pri.color, fontWeight: 600 }}>
                          {item.priority}
                        </span>
                      </td>
                      <td>{item.requester}</td>
                      <td style={{ fontSize: 12 }}>{item.department || '-'}</td>
                      <td style={{ fontSize: 12 }}>{item.supplier_name || '-'}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(item.estimated_amount)}</td>
                      <td style={{ fontSize: 12 }}>{item.expected_date || '-'}</td>
                      <td>
                        <select className="form-input" style={{ fontSize: 12, padding: '2px 6px' }}
                          value={item.stage} onChange={e => updateStage(item.id, e.target.value)}>
                          {STAGES.map(s => <option key={s}>{s}</option>)}
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

      {/* New Item Modal */}
      {showModal && (
        <Modal title="新增採購項目" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="項目名稱" required>
              <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="例：辦公室設備採購" />
            </Field>
            <Field label="優先度">
              <select className="form-input" value={form.priority} onChange={e => set('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="申請人" required>
              <input className="form-input" value={form.requester} onChange={e => set('requester', e.target.value)} placeholder="申請人姓名" />
            </Field>
            <Field label="部門">
              <input className="form-input" value={form.department} onChange={e => set('department', e.target.value)} placeholder="所屬部門" />
            </Field>
            <Field label="供應商">
              <input className="form-input" list="supplier-list" value={form.supplier_name} onChange={e => set('supplier_name', e.target.value)} placeholder="選擇或輸入供應商" />
              <datalist id="supplier-list">
                {suppliers.map(s => <option key={s.id} value={s.name} />)}
              </datalist>
            </Field>
            <Field label="預估金額">
              <input className="form-input" type="number" value={form.estimated_amount} onChange={e => set('estimated_amount', e.target.value)} placeholder="0" />
            </Field>
            <Field label="預計交貨日">
              <input className="form-input" type="date" value={form.expected_date} onChange={e => set('expected_date', e.target.value)} />
            </Field>
            <Field label="起始階段">
              <select className="form-input" value={form.stage} onChange={e => set('stage', e.target.value)}>
                {STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="說明">
            <textarea className="form-input" rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="採購需求說明..." />
          </Field>
          <Field label="備註">
            <textarea className="form-input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="其他備註事項" />
          </Field>
        </Modal>
      )}
    </div>
  )
}
