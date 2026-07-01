import { useState, useEffect } from 'react'
import { toast } from '../../lib/toast'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import {
  getDriverProfiles,
  getVehicles,
  createDriverProfile,
  upsertDriverAvailability,
} from '../../lib/db/dispatch'

const STATUS_MAP = {
  active: { label: '啟用', cls: 'badge badge-success' },
  inactive: { label: '停用', cls: 'badge badge-danger' },
}

function parseZones(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  return String(raw).split(',').map(z => z.trim()).filter(Boolean)
}

export default function DriverList() {
  const orgId = useOrgId()
  const [drivers, setDrivers] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({
    employee_id: '', license_type: '', service_zones: '', daily_limit: 20, vehicle_id: '',
  })

  const [availDriver, setAvailDriver] = useState(null)
  const [availForm, setAvailForm] = useState({ date: '', available: true, note: '' })

  const load = async () => {
    setLoading(true)
    const [{ data: dData, error: dErr }, { data: vData, error: vErr }] = await Promise.all([
      getDriverProfiles(),
      getVehicles(orgId),
    ])
    if (dErr) setError(dErr.message)
    else setDrivers(dData ?? [])
    if (!vErr) setVehicles(vData ?? [])
    setLoading(false)
  }

  useEffect(() => { if (orgId) load() }, [orgId])

  const today = new Date().toISOString().slice(0, 10)

  const stats = {
    total: drivers.length,
    availToday: drivers.filter(d => {
      const avail = (d.availability ?? []).find(a => a.date === today)
      return !avail || avail.available !== false
    }).length,
    unavailToday: drivers.filter(d => {
      const avail = (d.availability ?? []).find(a => a.date === today)
      return avail && avail.available === false
    }).length,
  }

  const handleAdd = async () => {
    const zones = parseZones(addForm.service_zones)
    const payload = {
      employee_id: addForm.employee_id || null,
      license_type: addForm.license_type,
      service_zones: zones,
      daily_job_limit: Number(addForm.daily_limit),
      vehicle_id: addForm.vehicle_id || null,
      is_active: true,
    }
    const { error: err } = await createDriverProfile(payload)
    if (err) { toast.error('新增失敗', { description: err.message }); return }
    toast.success('司機已新增')
    setShowAddModal(false)
    setAddForm({ employee_id: '', license_type: '', service_zones: '', daily_limit: 20, vehicle_id: '' })
    load()
  }

  const handleSaveAvail = async () => {
    if (!availDriver) return
    const { error: err } = await upsertDriverAvailability({
      driver_id: availDriver.id,
      date: availForm.date,
      available: availForm.available,
      note: availForm.note || null,
    })
    if (err) { toast.error('儲存失敗', { description: err.message }); return }
    toast.success('可用性已更新')
    setAvailDriver(null)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧑‍✈️</span> 司機管理</h2>
            <p>駕照資料、服務區域與可用性設定</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>＋ 新增司機</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">司機總數</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">今日可用</div>
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>{stats.availToday}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">今日不可用</div>
          <div className="stat-value" style={{ color: 'var(--accent-red)' }}>{stats.unavailToday}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title"><span className="card-title-icon">📋</span> 司機列表</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>電話</th>
                <th>駕照</th>
                <th>服務區域</th>
                <th>每日上限</th>
                <th>指派車輛</th>
                <th>狀態</th>
                <th>動作</th>
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>尚無司機資料</td></tr>
              )}
              {drivers.map(d => {
                const zones = parseZones(d.service_zones)
                const statusDef = STATUS_MAP[d.is_active ? 'active' : 'inactive']
                return (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.employees?.name ?? '—'}</td>
                    <td>{d.employees?.phone ?? '—'}</td>
                    <td>{d.license_type ?? '—'}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {zones.length === 0
                          ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                          : zones.map(z => (
                            <span key={z} className="badge badge-info">{z}</span>
                          ))}
                      </div>
                    </td>
                    <td>{d.daily_job_limit ?? '—'}</td>
                    <td>{d.dispatch_vehicles?.plate_number ?? '—'}</td>
                    <td><span className={statusDef.cls}>{statusDef.label}</span></td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => {
                          setAvailDriver(d)
                          setAvailForm({ date: today, available: true, note: '' })
                        }}
                      >
                        編輯可用性
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <Modal
          title="新增司機"
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAdd}
          submitLabel="新增"
        >
          <Field label="員工 ID">
            <input className="form-input" value={addForm.employee_id} onChange={e => setAddForm(f => ({ ...f, employee_id: e.target.value }))} placeholder="員工 ID（UUID）" />
          </Field>
          <Field label="駕照類型">
            <input className="form-input" value={addForm.license_type} onChange={e => setAddForm(f => ({ ...f, license_type: e.target.value }))} placeholder="例：職業小型車、大型車" />
          </Field>
          <Field label="服務區域" hint="以逗號分隔，例：台北市,新北市">
            <input className="form-input" value={addForm.service_zones} onChange={e => setAddForm(f => ({ ...f, service_zones: e.target.value }))} placeholder="台北市,新北市" />
          </Field>
          <Field label="每日上限">
            <input className="form-input" type="number" min={1} max={999} value={addForm.daily_limit} onChange={e => setAddForm(f => ({ ...f, daily_limit: e.target.value }))} />
          </Field>
          <Field label="指派車輛">
            <select className="form-input" value={addForm.vehicle_id} onChange={e => setAddForm(f => ({ ...f, vehicle_id: e.target.value }))}>
              <option value="">— 不指派 —</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.plate_number} ({v.type})</option>
              ))}
            </select>
          </Field>
        </Modal>
      )}

      {availDriver && (
        <Modal
          title={`編輯可用性 — ${availDriver.employees?.name ?? availDriver.id}`}
          onClose={() => setAvailDriver(null)}
          onSubmit={handleSaveAvail}
          submitLabel="儲存"
        >
          <Field label="日期">
            <input className="form-input" type="date" value={availForm.date} onChange={e => setAvailForm(f => ({ ...f, date: e.target.value }))} />
          </Field>
          <Field label="可用">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={availForm.available}
                onChange={e => setAvailForm(f => ({ ...f, available: e.target.checked }))}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>當日可出勤</span>
            </label>
          </Field>
          <Field label="備份備注">
            <input className="form-input" value={availForm.note} onChange={e => setAvailForm(f => ({ ...f, note: e.target.value }))} placeholder="請假原因、調休等" />
          </Field>
        </Modal>
      )}
    </div>
  )
}
