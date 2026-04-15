import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Edit3, X, Truck, CheckCircle, XCircle, Plus } from 'lucide-react'
import { getCarrierConfigs, createCarrierConfig, updateCarrierConfig, getShipments, updateShipment } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const CARRIERS = ['黑貓宅急便', '新竹物流', '中華郵政', '順豐速運', '7-11 交貨便', '全家店到店']

export default function CarrierIntegration() {
  const [configs, setConfigs] = useState([])
  const [shipments, setShipments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('configs')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ carrier_name: CARRIERS[0], api_url: '', api_key: '', is_active: true })
  const [editingId, setEditingId] = useState(null)

  const load = async () => {
    setLoading(true)
    const [cfgRes, shipRes] = await Promise.all([getCarrierConfigs(), getShipments()])
    setConfigs(cfgRes.data || [])
    setShipments(shipRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.carrier_name) return
    if (editingId) {
      const { error } = await updateCarrierConfig(editingId, form)
      if (error) { setError(error.message); return }
    } else {
      const { error } = await createCarrierConfig(form)
      if (error) { setError(error.message); return }
    }
    setShowModal(false); setForm({ carrier_name: CARRIERS[0], api_url: '', api_key: '', is_active: true }); setEditingId(null); load()
  }

  const toggleActive = async (cfg) => {
    await updateCarrierConfig(cfg.id, { is_active: !cfg.is_active })
    load()
  }

  const refreshTracking = async (shipment) => {
    // Simulated tracking update — in production this would call the carrier API
    const timeline = [...(shipment.timeline || []), {
      time: new Date().toISOString(),
      status: '查詢中',
      description: `正在查詢 ${shipment.carrier} 單號 ${shipment.tracking_number}...`,
    }]
    await updateShipment(shipment.id, { timeline })
    load()
    alert(`已更新 ${shipment.shipment_number} 的追蹤資訊（模擬）`)
  }

  if (loading) return <LoadingSpinner />

  const activeCarriers = configs.filter(c => c.is_active).length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🚚</span> 物流整合</h2>
            <p>Carrier Integration — 物流商 API 串接與追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm({ carrier_name: CARRIERS[0], api_url: '', api_key: '', is_active: true }); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增物流商
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">物流商</div>
          <div className="stat-card-value">{configs.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已啟用</div>
          <div className="stat-card-value">{activeCarriers}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">運送中</div>
          <div className="stat-card-value">{shipments.filter(s => ['已出貨', '運送中'].includes(s.status)).length}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', padding: 4, borderRadius: 8, width: 'fit-content', border: '1px solid var(--border)' }}>
        {['configs', 'tracking'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === t ? 'var(--accent-blue)' : 'transparent', color: tab === t ? '#fff' : 'var(--text-secondary)' }}>
            {t === 'configs' ? '物流商設定' : '出貨追蹤'}
          </button>
        ))}
      </div>

      {tab === 'configs' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {configs.map(cfg => (
            <div key={cfg.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Truck size={18} style={{ color: cfg.is_active ? 'var(--accent-green)' : 'var(--text-secondary)' }} />
                  <span style={{ fontWeight: 700 }}>{cfg.carrier_name}</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: cfg.is_active ? 'var(--accent-green)' : 'var(--accent-red)' }} onClick={() => toggleActive(cfg)}>
                    {cfg.is_active ? <CheckCircle size={16} /> : <XCircle size={16} />}
                  </button>
                  <button className="btn btn-secondary" style={{ padding: '2px 6px' }} onClick={() => { setForm({ carrier_name: cfg.carrier_name, api_url: cfg.api_url || '', api_key: cfg.api_key || '', is_active: cfg.is_active }); setEditingId(cfg.id); setShowModal(true) }}>
                    <Edit3 size={12} />
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {cfg.api_url ? <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{cfg.api_url}</div> : <div>未設定 API</div>}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: cfg.is_active ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {cfg.is_active ? '已啟用' : '已停用'}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tracking' && (
        <div className="data-table">
          <table>
            <thead><tr><th>出貨單號</th><th>物流商</th><th>追蹤號碼</th><th>收件人</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {shipments.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無出貨紀錄</td></tr>
              ) : shipments.slice(0, 20).map(s => (
                <tr key={s.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.shipment_number}</td>
                  <td>{s.carrier || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.tracking_number || '-'}</td>
                  <td>{s.recipient || '-'}</td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: s.status === '已送達' ? 'var(--accent-green-dim)' : 'var(--accent-blue-dim)', color: s.status === '已送達' ? 'var(--accent-green)' : 'var(--accent-blue)' }}>{s.status}</span></td>
                  <td>
                    {s.tracking_number && (
                      <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => refreshTracking(s)}>查詢追蹤</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh' }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border-medium)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>{editingId ? '編輯物流商' : '新增物流商'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <select value={form.carrier_name} onChange={e => setForm(f => ({ ...f, carrier_name: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                {CARRIERS.map(c => <option key={c}>{c}</option>)}
              </select>
              <input type="text" placeholder="API URL" value={form.api_url} onChange={e => setForm(f => ({ ...f, api_url: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <input type="text" placeholder="API Key" value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit}>{editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
