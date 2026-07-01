import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { toast } from '../../lib/toast'
import { getDispatchRoute, updateDispatchRoute } from '../../lib/db/dispatch'

const STOP_STATUS_MAP = {
  pending: { label: '待送達', cls: 'badge badge-warning' },
  arrived: { label: '已到達', cls: 'badge badge-info' },
  delivered: { label: '已送達', cls: 'badge badge-success' },
}

const ROUTE_STATUS_MAP = {
  pending: { label: '待出發', cls: 'badge badge-warning' },
  active: { label: '進行中', cls: 'badge badge-cyan' },
  completed: { label: '已完成', cls: 'badge badge-success' },
  cancelled: { label: '已取消', cls: 'badge badge-danger' },
}

export default function RouteDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const orgId = useOrgId()
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    if (!id) return
    getDispatchRoute(id)
      .then(({ data, error: err }) => {
        if (err) throw err
        setRoute(data)
      })
      .catch(() => setError('路線資料載入失敗'))
      .finally(() => setLoading(false))
  }, [id])

  const handleStart = async () => {
    setActing(true)
    const { error: err } = await updateDispatchRoute(id, { status: 'active', actual_start: new Date().toISOString() })
    if (err) { toast.error('操作失敗'); setActing(false); return }
    setRoute(r => ({ ...r, status: 'active' }))
    window.dispatchEvent(new CustomEvent('dispatch:route:started', { detail: { id, orgId } }))
    toast.success('路線已開始')
    setActing(false)
  }

  const handleComplete = async () => {
    setActing(true)
    const { error: err } = await updateDispatchRoute(id, { status: 'completed', actual_end: new Date().toISOString() })
    if (err) { toast.error('操作失敗'); setActing(false); return }
    setRoute(r => ({ ...r, status: 'completed' }))
    window.dispatchEvent(new CustomEvent('dispatch:route:completed', { detail: { id, orgId } }))
    toast.success('路線已完成')
    setActing(false)
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => navigate('/dispatch/routes')} style={{ marginTop: 16 }}>返回列表</button>
    </div>
  )

  const stops = (route?.stops || []).slice().sort((a, b) => a.sequence - b.sequence)
  const statusInfo = ROUTE_STATUS_MAP[route?.status] || { label: route?.status, cls: 'badge' }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <button className="btn btn-secondary" onClick={() => navigate('/dispatch/routes')} style={{ marginBottom: 8 }}>← 返回路線列表</button>
            <h2><span className="header-icon">🚚</span> 路線詳情</h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {route?.status === 'pending' && (
              <button className="btn btn-primary" onClick={handleStart} disabled={acting}>開始路線</button>
            )}
            {route?.status === 'active' && (
              <button className="btn btn-primary" onClick={handleComplete} disabled={acting} style={{ background: 'var(--accent-green)' }}>完成路線</button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title"><span className="card-title-icon">📋</span>路線資訊</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '4px 0' }}>
            {[
              ['路線編號', route?.route_number],
              ['司機', route?.driver_name],
              ['車牌號碼', route?.vehicle_plate],
              ['出車日期', route?.route_date],
              ['預計時長', route?.estimated_duration ? `${route.estimated_duration} 分鐘` : '—'],
              ['狀態', <span key="s" className={statusInfo.cls}>{statusInfo.label}</span>],
            ].map(([label, val]) => (
              <div key={label} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{val ?? '—'}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title"><span className="card-title-icon">🗺️</span>地圖追蹤</span>
          </div>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 8, height: 160,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 22, border: '1px dashed var(--border-medium)',
          }}>
            🗺️ 即時地圖
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title"><span className="card-title-icon">📍</span>停靠站列表</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stops.length} 站</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>順序</th>
                <th>收件人</th>
                <th>地址</th>
                <th>時間窗口</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {stops.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>無停靠站資料</td></tr>
              )}
              {stops.map((stop, i) => {
                const s = STOP_STATUS_MAP[stop.status] || { label: stop.status, cls: 'badge' }
                return (
                  <tr key={stop.id || i}>
                    <td style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{stop.sequence}</td>
                    <td>{stop.recipient_name}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{stop.address}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {stop.time_window_start && stop.time_window_end
                        ? `${stop.time_window_start} – ${stop.time_window_end}`
                        : '—'}
                    </td>
                    <td><span className={s.cls}>{s.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
