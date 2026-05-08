import { useState, useEffect } from 'react'
import { CheckCheck } from 'lucide-react'
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

const typeIcon = { leave: '📅', task: '✅', system: '⚙️', performance: '⭐', hr: '👥' }

export default function Notifications() {
  const { user, profile } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    getNotifications(user.id, profile?.id).then(({ data }) => {
      setNotifications(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [user?.id, profile?.id])

  const handleMarkRead = async (id) => {
    try {
      const { error } = await markNotificationRead(id)
      if (error) throw error
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleMarkAllRead = async () => {
    try {
      const { error } = await markAllNotificationsRead(user?.id, profile?.id)
      if (error) throw error
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const unread = notifications.filter(n => !n.read).length

  const formatTime = (ts) => {
    if (!ts) return ''
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins} 分鐘前`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} 小時前`
    return `${Math.floor(hrs / 24)} 天前`
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔔</span> 通知管理</h2>
            <p>系統通知與訊息中心</p>
          </div>
          <button className="btn btn-secondary" onClick={handleMarkAllRead}><CheckCheck size={14} /> 全部標為已讀</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">未讀通知</div>
          <div className="stat-card-value">{unread}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已讀</div>
          <div className="stat-card-value">{notifications.filter(n => n.read).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總計</div>
          <div className="stat-card-value">{notifications.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {notifications.map(n => (
            <div
              key={n.id}
              onClick={() => !n.read && handleMarkRead(n.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 8, cursor: n.read ? 'default' : 'pointer',
                background: n.read ? 'transparent' : 'var(--glass-light)',
                border: n.read ? '1px solid transparent' : '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: 18, flexShrink: 0 }} aria-label={n.type || '通知'}>{typeIcon[n.type] || '📣'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600 }}>{n.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{formatTime(n.created_at)}</div>
              </div>
              {!n.read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-cyan)', flexShrink: 0 }}></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
