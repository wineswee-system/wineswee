import { useState, useEffect } from 'react'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'
import { getVehicles, getDriverProfiles, createVehicle, createDriverProfile } from '../../lib/db/dispatch'

const TYPE_ZH = { van: '廂型車', truck: '貨車', motorcycle: '機車', bicycle: '自行車', other: '其他' }

const STATUS_BADGE = {
  active: <span className="badge badge-success">使用中</span>,
  maintenance: <span className="badge badge-warning">維修中</span>,
  retired: <span className="badge badge-danger">已除役</span>,
}

const BLANK_VEHICLE = { plate: '', type: 'van', max_weight_kg: '', max_volume_m3: '' }
const BLANK_DRIVER = { employee_id: '', license_type: '', service_zones: '', max_daily_orders: '', assigned_vehicle_id: '' }

export default function FleetManagement() {
  const orgId = useOrgId()
  const [tab, setTab] = useState('車輛')
  const [vehicles, setVehicles] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showVehicleModal, setShowVehicleModal] = useState(false)
  const [showDriverModal, setShowDriverModal] = useState(false)
  const [vehicleForm, setVehicleForm] = useState(BLANK_VEHICLE)
  const [driverForm, setDriverForm] = useState(BLANK_DRIVER)

  const setV = (k, v) => setVehicleForm(f => ({ ...f, [k]: v }))
  const setD = (k, v) => setDriverForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    Promise.all([getVehicles(orgId), getDriverProfiles(orgId)])
      .then(([v, d]) => {
        setVehicles(v.data || [])
        setDrivers(d.data || [])
      })
      .catch(() => toast.error('資料載入失敗'))
      .finally(() => setLoading(false))
  }, [orgId])

  const handleAddVehicle = async () => {
    if (!vehicleForm.plate) { toast.error('請填寫車牌'); return false }
    const { error } = await createVehicle({ ...vehicleForm, org_id: orgId })
    if (error) { toast.error('新增失敗'); return false }
    const { data } = await getVehicles(orgId)
    setVehicles(data || [])
    setShowVehicleModal(false)
    setVehicleForm(BLANK_VEHICLE)
    toast.success('車輛已新增')
  }

  const handleAddDriver = async () => {
    if (!driverForm.employee_id) { toast.error('請填寫員工 ID'); return false }
    const payload = {
      ...driverForm,
      service_zones: driverForm.service_zones ? driverForm.service_zones.split(',').map(s => s.trim()) : [],
      max_daily_orders: driverForm.max_daily_orders ? Number(driverForm.max_daily_orders) : null,
    }
    const { error } = await createDriverProfile(payload)
    if (error) { toast.error('新增失敗'); return false }
    const { data } = await getDriverProfiles(orgId)
    setDrivers(data || [])
    setShowDriverModal(false)
    setDriverForm(BLANK_DRIVER)
    toast.success('司機已新增')
  }

  if (loading) return <LoadingSpinner />

  const activeVehicles = vehicles.filter(v => v.status === 'active').length
  const maintenanceVehicles = vehicles.filter(v => v.status === 'maintenance').length
  const availableDrivers = drivers.filter(d => d.status === 'active').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">🚛</span> 車隊管理</h2>
      </div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border-medium)' }}>
        {['車輛', '司機'].map(t => (
          <div
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              color: tab === t ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              borderBottom: tab === t ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              marginBottom: -1, transition: 'all 0.15s',
            }}
          >
            {t}
          </div>
        ))}
      </div>

      {tab === '車輛' && (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            {[
              { label: '總車輛', value: vehicles.length, color: 'var(--accent-blue)' },
              { label: '使用中', value: activeVehicles, color: 'var(--accent-green)' },
              { label: '維修中', value: maintenanceVehicles, color: 'var(--accent-orange)' },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title"><span className="card-title-icon">🚗</span>車輛列表</span>
              <button className="btn btn-primary" onClick={() => setShowVehicleModal(true)}>+ 新增車輛</button>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>車牌</th><th>類型</th><th>最大承重(kg)</th><th>最大容積(m³)</th><th>狀態</th><th>動作</th></tr>
                </thead>
                <tbody>
                  {vehicles.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>尚無車輛資料</td></tr>
                  )}
                  {vehicles.map(v => (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>{v.plate}</td>
                      <td>{TYPE_ZH[v.type] || v.type}</td>
                      <td>{v.max_weight_kg ?? '—'}</td>
                      <td>{v.max_volume_m3 ?? '—'}</td>
                      <td>{STATUS_BADGE[v.status] || <span className="badge">{v.status}</span>}</td>
                      <td><button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }}>編輯</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === '司機' && (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            {[
              { label: '司機總數', value: drivers.length, color: 'var(--accent-blue)' },
              { label: '今日可用', value: availableDrivers, color: 'var(--accent-green)' },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title"><span className="card-title-icon">👤</span>司機列表</span>
              <button className="btn btn-primary" onClick={() => setShowDriverModal(true)}>+ 新增司機</button>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>員工姓名</th><th>電話</th><th>駕照類型</th><th>服務區域</th><th>最大每日件數</th><th>指派車輛</th><th>狀態</th></tr>
                </thead>
                <tbody>
                  {drivers.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>尚無司機資料</td></tr>
                  )}
                  {drivers.map(d => {
                    const assignedVehicle = vehicles.find(v => v.id === d.assigned_vehicle_id)
                    return (
                      <tr key={d.id}>
                        <td style={{ fontWeight: 500 }}>{d.employee_name || '—'}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{d.phone || '—'}</td>
                        <td>{d.license_type || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {Array.isArray(d.service_zones) ? d.service_zones.join('、') : d.service_zones || '—'}
                        </td>
                        <td>{d.max_daily_orders ?? '—'}</td>
                        <td>{assignedVehicle ? assignedVehicle.plate : '—'}</td>
                        <td>{STATUS_BADGE[d.status] || <span className="badge">{d.status}</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showVehicleModal && (
        <Modal title="新增車輛" onClose={() => { setShowVehicleModal(false); setVehicleForm(BLANK_VEHICLE) }} onSubmit={handleAddVehicle} submitLabel="新增">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="車牌" required>
              <input className="form-input" type="text" value={vehicleForm.plate} onChange={e => setV('plate', e.target.value)} placeholder="例：ABC-1234" />
            </Field>
            <Field label="類型">
              <select className="form-input" value={vehicleForm.type} onChange={e => setV('type', e.target.value)}>
                {Object.entries(TYPE_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="最大承重(kg)">
                <input className="form-input" type="number" min="0" value={vehicleForm.max_weight_kg} onChange={e => setV('max_weight_kg', e.target.value)} placeholder="0" />
              </Field>
              <Field label="最大容積(m³)">
                <input className="form-input" type="number" min="0" step="0.1" value={vehicleForm.max_volume_m3} onChange={e => setV('max_volume_m3', e.target.value)} placeholder="0.0" />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {showDriverModal && (
        <Modal title="新增司機" onClose={() => { setShowDriverModal(false); setDriverForm(BLANK_DRIVER) }} onSubmit={handleAddDriver} submitLabel="新增">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="員工 ID" required>
              <input className="form-input" type="text" value={driverForm.employee_id} onChange={e => setD('employee_id', e.target.value)} placeholder="員工 UUID" />
            </Field>
            <Field label="駕照類型">
              <input className="form-input" type="text" value={driverForm.license_type} onChange={e => setD('license_type', e.target.value)} placeholder="例：普通小型車、大型車" />
            </Field>
            <Field label="服務區域" hint="逗號分隔">
              <input className="form-input" type="text" value={driverForm.service_zones} onChange={e => setD('service_zones', e.target.value)} placeholder="例：台北市, 新北市" />
            </Field>
            <Field label="每日上限（件）">
              <input className="form-input" type="number" min="0" value={driverForm.max_daily_orders} onChange={e => setD('max_daily_orders', e.target.value)} placeholder="0" />
            </Field>
            <Field label="指派車輛">
              <select className="form-input" value={driverForm.assigned_vehicle_id} onChange={e => setD('assigned_vehicle_id', e.target.value)}>
                <option value="">不指派</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate} ({TYPE_ZH[v.type] || v.type})</option>)}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
