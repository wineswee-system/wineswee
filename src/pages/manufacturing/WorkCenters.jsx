import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, Factory, Gauge } from 'lucide-react'
import { getWorkCenters, createWorkCenter, updateWorkCenter, deleteWorkCenter, getManufacturingOrders } from '../../lib/db'
import { calculateCapacityRequirements } from '../../lib/mrpEngine'
import LoadingSpinner from '../../components/LoadingSpinner'

import { confirm } from '../../lib/confirm'
const TYPES = ['加工', '組裝', '測試', '包裝']
const STATUSES = ['啟用', '停用', '維修']

const emptyForm = {
  code: '', name: '', type: '加工', available_hours_per_day: '8',
  efficiency_rate: '100', hourly_rate: '0', status: '啟用', notes: '',
}

export default function WorkCenters() {
  const [centers, setCenters] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('list') // list | capacity
  const [capacityData, setCapacityData] = useState([])
  const [capacityLoading, setCapacityLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const { data, error } = await getWorkCenters()
    if (error) setError(error.message)
    else setCenters(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.code || !form.name) return
    setSaving(true)
    const payload = {
      ...form,
      available_hours_per_day: Number(form.available_hours_per_day),
      efficiency_rate: Number(form.efficiency_rate),
      hourly_rate: Number(form.hourly_rate),
    }
    delete payload.id

    if (editingId) {
      const { error } = await updateWorkCenter(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await createWorkCenter(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    load()
  }

  const handleEdit = (wc) => {
    setForm({
      code: wc.code, name: wc.name, type: wc.type || '加工',
      available_hours_per_day: String(wc.available_hours_per_day),
      efficiency_rate: String(wc.efficiency_rate),
      hourly_rate: String(wc.hourly_rate || 0),
      status: wc.status, notes: wc.notes || '',
    })
    setEditingId(wc.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ message: '確定要刪除此工作中心？' }))) return
    const { error } = await deleteWorkCenter(id)
    if (error) setError(error.message)
    else load()
  }

  const loadCapacity = async () => {
    setCapacityLoading(true)
    const { data: orders } = await getManufacturingOrders()
    const activeOrders = (orders || []).filter(o => ['待生產', '生產中'].includes(o.status))

    const plannedOrders = activeOrders.map(o => ({
      product: o.product_name,
      qty: o.quantity || 0,
      start_date: o.start_date,
      due_date: o.due_date,
    }))

    // Map work centers to CRP format with mock product hours
    const wcForCRP = centers.map(wc => ({
      name: wc.name,
      work_center_id: wc.code,
      available_hours_per_day: wc.available_hours_per_day,
      products: activeOrders.map(o => ({ product_code: o.product_name, hours_per_unit: 0.5 })),
    }))

    const result = calculateCapacityRequirements(plannedOrders, wcForCRP)
    setCapacityData(result)
    setCapacityLoading(false)
  }

  useEffect(() => {
    if (tab === 'capacity' && centers.length > 0) loadCapacity()
  }, [tab, centers.length])

  const statusColor = (s) => s === '啟用' ? 'var(--accent-green)' : s === '維修' ? 'var(--accent-orange)' : 'var(--accent-red)'

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏭</span> 工作中心</h2>
            <p>Work Centers — 工作中心管理與產能分析</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增工作中心
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      {/* Stat cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">工作中心</div>
          <div className="stat-card-value">{centers.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用</div>
          <div className="stat-card-value">{centers.filter(c => c.status === '啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">維修中</div>
          <div className="stat-card-value">{centers.filter(c => c.status === '維修').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">日總產能 (hrs)</div>
          <div className="stat-card-value">{centers.filter(c => c.status === '啟用').reduce((s, c) => s + (c.available_hours_per_day || 0), 0)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', padding: 4, borderRadius: 8, width: 'fit-content', border: '1px solid var(--border)' }}>
        <button onClick={() => setTab('list')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === 'list' ? 'var(--accent-blue)' : 'transparent', color: tab === 'list' ? '#fff' : 'var(--text-secondary)' }}>
          <Factory size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> 工作中心清單
        </button>
        <button onClick={() => setTab('capacity')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === 'capacity' ? 'var(--accent-blue)' : 'transparent', color: tab === 'capacity' ? '#fff' : 'var(--text-secondary)' }}>
          <Gauge size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> 產能利用率
        </button>
      </div>

      {tab === 'list' && (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>代碼</th>
                <th>名稱</th>
                <th>類型</th>
                <th style={{ textAlign: 'right' }}>日產能 (hrs)</th>
                <th style={{ textAlign: 'right' }}>效率 (%)</th>
                <th style={{ textAlign: 'right' }}>時薪成本</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {centers.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無工作中心</td></tr>
              ) : centers.map(wc => (
                <tr key={wc.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{wc.code}</td>
                  <td style={{ fontWeight: 600 }}>{wc.name}</td>
                  <td>{wc.type}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{wc.available_hours_per_day}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{wc.efficiency_rate}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>NT$ {(wc.hourly_rate || 0).toLocaleString()}</td>
                  <td>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: `color-mix(in srgb, ${statusColor(wc.status)} 15%, transparent)`, color: statusColor(wc.status) }}>{wc.status}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => handleEdit(wc)}><Edit3 size={13} /></button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(wc.id)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'capacity' && (
        <div>
          {capacityLoading ? <LoadingSpinner /> : capacityData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>無進行中的製令，無法計算產能利用率</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {capacityData.map((cap, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontWeight: 700 }}>{cap.workCenter}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: cap.overloaded ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                      {cap.utilization_pct}%
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 4, width: `${Math.min(cap.utilization_pct, 100)}%`,
                      background: cap.overloaded ? 'var(--accent-red)' : cap.utilization_pct > 80 ? 'var(--accent-orange)' : 'var(--accent-green)',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span>需求: {cap.required_hours}h</span>
                    <span>可用: {cap.available_hours}h</span>
                    {cap.overloaded && <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>超載!</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 480, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯工作中心' : '新增工作中心'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>代碼 *</label>
                  <input type="text" value={form.code} onChange={e => set('code', e.target.value)} placeholder="WC-XXX" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>名稱 *</label>
                  <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="工作中心名稱" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>類型</label>
                  <select value={form.type} onChange={e => set('type', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>狀態</label>
                  <select value={form.status} onChange={e => set('status', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>日產能 (hrs)</label>
                  <input type="number" value={form.available_hours_per_day} onChange={e => set('available_hours_per_day', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>效率 (%)</label>
                  <input type="number" value={form.efficiency_rate} onChange={e => set('efficiency_rate', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>時薪成本</label>
                  <input type="number" value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>備註</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
