import { useState, useEffect } from 'react'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from 'sonner'
import { getDispatchRoutes, getDriverProfiles, getVehicles, createDispatchRoute, updateDispatchRoute } from '../../lib/db/dispatch'
import { generateRouteNumber } from '../../lib/dispatch/routingEngine'

const STATUS_BADGE = { planned: 'badge-warning', active: 'badge-cyan', completed: 'badge-success', cancelled: 'badge-danger' }
const STATUS_LABEL = { planned: '計劃中', active: '進行中', completed: '已完成', cancelled: '已取消' }

export default function DispatchRoutes() {
  const orgId = useOrgId()
  const [routes, setRoutes] = useState([])
  const [drivers, setDrivers] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ date: '', driver_id: '', vehicle_id: '', notes: '' })

  const load = () => {
    if (!orgId) { setLoading(false); return }
    Promise.all([
      getDispatchRoutes(orgId),
      getDriverProfiles(),
      getVehicles(orgId),
    ]).then(([r, d, v]) => {
      setRoutes(r.data || [])
      setDrivers(d.data || [])
      setVehicles(v.data || [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [orgId])

  if (loading) return <LoadingSpinner />

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayRoutes = routes.filter(r => r.date === todayStr).length
  const activeRoutes = routes.filter(r => r.status === 'active').length
  const completedRoutes = routes.filter(r => r.status === 'completed').length

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openCreate = () => {
    setForm({ date: todayStr, driver_id: drivers[0]?.id || '', vehicle_id: vehicles[0]?.id || '', notes: '' })
    setShowModal(true)
  }

  const handleCreate = async () => {
    const route_number = generateRouteNumber()
    const { error } = await createDispatchRoute({
      route_number,
      org_id: orgId,
      date: form.date,
      driver_id: form.driver_id || null,
      vehicle_id: form.vehicle_id || null,
      notes: form.notes,
      status: 'planned',
    })
    if (error) { toast.error('新增路線失敗'); return }
    toast.success(`路線 ${route_number} 已建立`)
    setShowModal(false)
    load()
  }

  const handleStart = async route => {
    await updateDispatchRoute(route.id, { status: 'active' })
    toast.success(`路線 ${route.route_number} 已開始`)
    load()
  }

  const handleOptimize = route => {
    toast.info(`路線 ${route.route_number} 優化中...`)
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <h2><span className="header-icon">🗺️</span> 路線規劃</h2>
          <button className="btn btn-primary" onClick={openCreate}>+ 新增路線</button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>管理自有車隊配送路線與司機排班</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ borderTop: '3px solid var(--accent-blue)' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-blue)' }}>{todayRoutes}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>今日路線</div>
        </div>
        <div className="stat-card" style={{ borderTop: '3px solid var(--accent-cyan)' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-cyan)' }}>{activeRoutes}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>進行中</div>
        </div>
        <div className="stat-card" style={{ borderTop: '3px solid var(--accent-green)' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-green)' }}>{completedRoutes}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>已完成</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🚐</span> 路線列表</div>
          <span className="badge badge-neutral">{routes.length} 筆</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>路線編號</th>
                <th>日期</th>
                <th>司機</th>
                <th>車輛</th>
                <th>站數</th>
                <th>距離(km)</th>
                <th>狀態</th>
                <th>動作</th>
              </tr>
            </thead>
            <tbody>
              {routes.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                    尚無路線，請點選「新增路線」
                  </td>
                </tr>
              )}
              {routes.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 700, color: 'var(--accent-purple)', fontFamily: 'monospace' }}>{r.route_number}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{r.date}</td>
                  <td style={{ fontWeight: 600 }}>{r.driver_name || '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.vehicle_name || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{r.stop_count ?? '—'}</td>
                  <td style={{ textAlign: 'center' }}>{r.distance_km != null ? r.distance_km.toFixed(1) : '—'}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] || 'badge-neutral'}`}>
                      <span className="badge-dot"></span>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {r.status === 'planned' && (
                        <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => handleStart(r)}>開始</button>
                      )}
                      <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => handleOptimize(r)}>優化路線</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal
          title="新增配送路線"
          onClose={() => setShowModal(false)}
          onSubmit={handleCreate}
          submitLabel="建立路線"
        >
          <Field label="日期" required>
            <input type="date" className="form-input" value={form.date} onChange={e => set('date', e.target.value)} />
          </Field>
          <Field label="司機" required>
            <select className="form-input" value={form.driver_id} onChange={e => set('driver_id', e.target.value)}>
              <option value="">請選擇司機</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="車輛" required>
            <select className="form-input" value={form.vehicle_id} onChange={e => set('vehicle_id', e.target.value)}>
              <option value="">請選擇車輛</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate} {v.model}</option>)}
            </select>
          </Field>
          <Field label="備註">
            <input
              type="text"
              className="form-input"
              placeholder="選填"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </Field>
        </Modal>
      )}
    </div>
  )
}
