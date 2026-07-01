import { Navigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

// ════════════════════════════════════════════════════════════════
// /analytics/* RBAC gate
//   · tier 1（全部分析頁）：perm 'analytics.tier_1'
//     → 預設授予 admin / manager（super_admin 永遠通過）
//   · tier 2（門市相關頁）：perm 'analytics.tier_2'
//     → 預設授予 admin / manager / store_staff
//   · 其他角色：在「系統設定 → 員工個別權限」手動授予
// ════════════════════════════════════════════════════════════════

export default function AnalyticsRouteGuard({ children, tier = 1 }) {
  const { hasPermission, profileReady } = useAuth()

  if (!profileReady) return <LoadingSpinner />

  const permCode = tier === 2 ? 'analytics.tier_2' : 'analytics.tier_1'

  if (!hasPermission(permCode)) {
    return (
      <div style={{
        padding: 48, textAlign: 'center',
        background: 'var(--bg-card)', borderRadius: 16,
        border: '1px solid var(--border-subtle)',
        margin: 32,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 16,
        }}>
          <Lock size={32} />
        </div>
        <h3 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>權限不足</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
          這個分析頁面需要 <b>{permCode}</b> 權限。<br />
          請聯絡管理員在「員工個別權限」中開通。
        </p>
        <Navigate to="/" replace />
      </div>
    )
  }

  return children
}
