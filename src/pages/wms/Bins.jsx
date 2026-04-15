import { useState, useEffect } from 'react'
import { Plus, Trash2, X, ChevronDown, ChevronRight, MapPin, Package, Warehouse } from 'lucide-react'
import { getWarehouses, createWarehouse, getWarehouseZones, createWarehouseZone, deleteWarehouseZone, getWarehouseBins, createWarehouseBin, updateWarehouseBin, deleteWarehouseBin } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const ZONE_TYPES = ['收貨', '儲存', '揀貨', '出貨', '退貨']
const BIN_STATUSES = ['可用', '已滿', '停用']

export default function Bins() {
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedWh, setExpandedWh] = useState(null)
  const [expandedZone, setExpandedZone] = useState(null)
  const [zones, setZones] = useState([])
  const [bins, setBins] = useState([])

  // Forms
  const [showWhModal, setShowWhModal] = useState(false)
  const [whForm, setWhForm] = useState({ code: '', name: '', address: '', type: '一般' })
  const [showZoneModal, setShowZoneModal] = useState(false)
  const [zoneForm, setZoneForm] = useState({ code: '', name: '', zone_type: '儲存' })
  const [showBinModal, setShowBinModal] = useState(false)
  const [binForm, setBinForm] = useState({ code: '', max_capacity: '100', status: '可用' })

  const load = async () => {
    setLoading(true)
    const { data, error } = await getWarehouses()
    if (error) setError(error.message)
    else setWarehouses(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const toggleWh = async (id) => {
    if (expandedWh === id) { setExpandedWh(null); setExpandedZone(null); return }
    setExpandedWh(id)
    setExpandedZone(null)
    const { data } = await getWarehouseZones(id)
    setZones(data || [])
  }

  const toggleZone = async (id) => {
    if (expandedZone === id) { setExpandedZone(null); return }
    setExpandedZone(id)
    const { data } = await getWarehouseBins(id)
    setBins(data || [])
  }

  const handleAddWarehouse = async () => {
    if (!whForm.code || !whForm.name) return
    const { error } = await createWarehouse(whForm)
    if (error) { setError(error.message); return }
    setShowWhModal(false)
    setWhForm({ code: '', name: '', address: '', type: '一般' })
    load()
  }

  const handleAddZone = async () => {
    if (!zoneForm.code || !zoneForm.name) return
    const { error } = await createWarehouseZone({ ...zoneForm, warehouse_id: expandedWh })
    if (error) { setError(error.message); return }
    setShowZoneModal(false)
    setZoneForm({ code: '', name: '', zone_type: '儲存' })
    const { data } = await getWarehouseZones(expandedWh)
    setZones(data || [])
  }

  const handleDeleteZone = async (id) => {
    if (!confirm('刪除此儲區會同時刪除所有儲位，確定？')) return
    await deleteWarehouseZone(id)
    const { data } = await getWarehouseZones(expandedWh)
    setZones(data || [])
  }

  const handleAddBin = async () => {
    if (!binForm.code) return
    const { error } = await createWarehouseBin({ ...binForm, max_capacity: Number(binForm.max_capacity), zone_id: expandedZone })
    if (error) { setError(error.message); return }
    setShowBinModal(false)
    setBinForm({ code: '', max_capacity: '100', status: '可用' })
    const { data } = await getWarehouseBins(expandedZone)
    setBins(data || [])
  }

  const handleDeleteBin = async (id) => {
    await deleteWarehouseBin(id)
    const { data } = await getWarehouseBins(expandedZone)
    setBins(data || [])
  }

  const toggleBinStatus = async (bin) => {
    const next = bin.status === '可用' ? '停用' : '可用'
    await updateWarehouseBin(bin.id, { status: next })
    const { data } = await getWarehouseBins(expandedZone)
    setBins(data || [])
  }

  const statusColor = (s) => s === '可用' ? 'var(--accent-green)' : s === '已滿' ? 'var(--accent-orange)' : 'var(--accent-red)'
  const zoneTypeColor = (t) => {
    switch (t) { case '收貨': return '#3b82f6'; case '儲存': return '#34d399'; case '揀貨': return '#a78bfa'; case '出貨': return '#fb923c'; case '退貨': return '#f87171'; default: return '#94a3b8' }
  }

  if (loading) return <LoadingSpinner />

  const totalBins = warehouses.length // approximate; actual count would require loading all
  const activeWh = warehouses.filter(w => w.is_active).length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📍</span> 倉庫儲位管理</h2>
            <p>Warehouse Bins — 倉庫、儲區、儲位三層管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowWhModal(true)}>
            <Plus size={14} /> 新增倉庫
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">倉庫數量</div>
          <div className="stat-card-value">{warehouses.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用中</div>
          <div className="stat-card-value">{activeWh}</div>
        </div>
      </div>

      {/* Warehouse tree */}
      {warehouses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>尚無倉庫資料</div>
      ) : warehouses.map(wh => (
        <div key={wh.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', marginBottom: 12, overflow: 'hidden' }}>
          {/* Warehouse row */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', gap: 10 }} onClick={() => toggleWh(wh.id)}>
            {expandedWh === wh.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Warehouse size={18} style={{ color: 'var(--accent-blue)' }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 700, fontFamily: 'monospace', marginRight: 8 }}>{wh.code}</span>
              <span style={{ fontWeight: 600 }}>{wh.name}</span>
              {wh.address && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-secondary)' }}>{wh.address}</span>}
            </div>
            <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: wh.is_active ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)', color: wh.is_active ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>{wh.type}</span>
          </div>

          {/* Zones */}
          {expandedWh === wh.id && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '8px 16px 12px 40px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>儲區 ({zones.length})</span>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setShowZoneModal(true)}>
                  <Plus size={12} /> 新增儲區
                </button>
              </div>

              {zones.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>尚無儲區</div>
              ) : zones.map(zone => (
                <div key={zone.id} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer' }} onClick={() => toggleZone(zone.id)}>
                    {expandedZone === zone.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <MapPin size={14} style={{ color: zoneTypeColor(zone.zone_type) }} />
                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13 }}>{zone.code}</span>
                    <span style={{ fontSize: 13 }}>{zone.name}</span>
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: `color-mix(in srgb, ${zoneTypeColor(zone.zone_type)} 15%, transparent)`, color: zoneTypeColor(zone.zone_type), fontWeight: 600 }}>{zone.zone_type}</span>
                    <span style={{ flex: 1 }} />
                    <button className="btn btn-secondary" style={{ padding: '2px 6px', color: 'var(--accent-red)' }} onClick={e => { e.stopPropagation(); handleDeleteZone(zone.id) }}><Trash2 size={12} /></button>
                  </div>

                  {/* Bins */}
                  {expandedZone === zone.id && (
                    <div style={{ paddingLeft: 28, paddingTop: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>儲位 ({bins.length})</span>
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setShowBinModal(true)}>
                          <Plus size={11} /> 新增儲位
                        </button>
                      </div>
                      {bins.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 8 }}>尚無儲位</div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                          {bins.map(bin => {
                            const pct = bin.max_capacity > 0 ? Math.round((bin.current_qty / bin.max_capacity) * 100) : 0
                            return (
                              <div key={bin.id} style={{ background: 'var(--bg-main)', borderRadius: 8, border: '1px solid var(--border)', padding: 10, position: 'relative' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{bin.code}</span>
                                  <span style={{ fontSize: 10, padding: '1px 4px', borderRadius: 3, background: `color-mix(in srgb, ${statusColor(bin.status)} 15%, transparent)`, color: statusColor(bin.status), fontWeight: 600, cursor: 'pointer' }} onClick={() => toggleBinStatus(bin)}>{bin.status}</span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{bin.current_qty} / {bin.max_capacity}</div>
                                <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: pct >= 90 ? 'var(--accent-red)' : pct >= 70 ? 'var(--accent-orange)' : 'var(--accent-green)', borderRadius: 2 }} />
                                </div>
                                <button style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', opacity: 0.5 }} onClick={() => handleDeleteBin(bin.id)}><Trash2 size={10} /></button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Warehouse Modal */}
      {showWhModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh' }} onClick={() => setShowWhModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border-medium)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>新增倉庫</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="text" placeholder="倉庫代碼 *" value={whForm.code} onChange={e => setWhForm(f => ({ ...f, code: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <input type="text" placeholder="倉庫名稱 *" value={whForm.name} onChange={e => setWhForm(f => ({ ...f, name: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <input type="text" placeholder="地址" value={whForm.address} onChange={e => setWhForm(f => ({ ...f, address: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <select value={whForm.type} onChange={e => setWhForm(f => ({ ...f, type: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                {['一般', '冷藏', '冷凍', '危險品'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowWhModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAddWarehouse}>新增</button>
            </div>
          </div>
        </div>
      )}

      {/* Zone Modal */}
      {showZoneModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh' }} onClick={() => setShowZoneModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 380, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>新增儲區</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="text" placeholder="儲區代碼 *" value={zoneForm.code} onChange={e => setZoneForm(f => ({ ...f, code: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <input type="text" placeholder="儲區名稱 *" value={zoneForm.name} onChange={e => setZoneForm(f => ({ ...f, name: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <select value={zoneForm.zone_type} onChange={e => setZoneForm(f => ({ ...f, zone_type: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                {ZONE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowZoneModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAddZone}>新增</button>
            </div>
          </div>
        </div>
      )}

      {/* Bin Modal */}
      {showBinModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh' }} onClick={() => setShowBinModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 360, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>新增儲位</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="text" placeholder="儲位代碼 * (e.g. A-01-03)" value={binForm.code} onChange={e => setBinForm(f => ({ ...f, code: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <input type="number" placeholder="最大容量" value={binForm.max_capacity} onChange={e => setBinForm(f => ({ ...f, max_capacity: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowBinModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAddBin}>新增</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
