import { useState, useEffect } from 'react'
import { Search, Package } from 'lucide-react'
import { getInventoryLots } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function Lots() {
  const [lots, setLots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    getInventoryLots().then(({ data }) => { setLots(data || []) }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = lots.filter(l =>
    search === '' || l.lot_number?.includes(search) || l.sku_id?.toString().includes(search)
  )

  const today = new Date().toISOString().split('T')[0]
  const thirtyDaysLater = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const totalLots = filtered.length
  const expiringSoon = filtered.filter(l => l.expiry_date && l.expiry_date >= today && l.expiry_date <= thirtyDaysLater).length
  const expired = filtered.filter(l => l.expiry_date && l.expiry_date < today).length

  const isExpired = (date) => date && date < today
  const isExpiringSoon = (date) => date && date >= today && date <= thirtyDaysLater

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📦</span> 批號追蹤</h2>
            <p>庫存批號與效期管理</p>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總批號數</div>
          <div className="stat-card-value">{totalLots}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">即將到期</div>
          <div className="stat-card-value">{expiringSoon}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已過期</div>
          <div className="stat-card-value">{expired}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Package size={16} /></span> 批號列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋批號..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>批號</th><th>SKU ID</th><th>數量</th><th>倉庫</th><th>儲位</th><th>效期</th><th>入庫日期</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無批號資料</td></tr>}
              {filtered.map(l => (
                <tr key={l.id} style={isExpired(l.expiry_date) ? { background: 'rgba(239, 68, 68, 0.08)' } : undefined}>
                  <td style={{ fontWeight: 600 }}>{l.lot_number}</td>
                  <td>{l.sku_id}</td>
                  <td>{(l.quantity || 0).toLocaleString()}</td>
                  <td>{l.warehouse}</td>
                  <td>{l.location_code}</td>
                  <td style={{ color: isExpired(l.expiry_date) ? 'var(--accent-red)' : isExpiringSoon(l.expiry_date) ? 'var(--accent-orange)' : undefined, fontWeight: isExpired(l.expiry_date) ? 600 : undefined }}>
                    {l.expiry_date}
                  </td>
                  <td>{l.received_date}</td>
                  <td>
                    <span className={`badge ${l.status === '正常' ? 'badge-success' : l.status === '已過期' ? 'badge-danger' : l.status === '即將到期' ? 'badge-warning' : 'badge-info'}`}>
                      <span className="badge-dot"></span>{isExpired(l.expiry_date) ? '已過期' : l.status || '正常'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
