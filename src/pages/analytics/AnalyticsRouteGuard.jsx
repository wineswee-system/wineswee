import { Navigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

// ════════════════════════════════════════════════════════════════
// /analytics/* RBAC gate
//   · ANALYTICS_TIER_1（全部分析頁）：super_admin / admin / manager
//   · ANALYTICS_TIER_2（只 POS/庫存等門市相關）：+ store_staff
//   · 其他角色全擋
// ════════════════════════════════════════════════════════════════

const TIER_1_ROLES = ['super_admin', 'admin', 'manager']
const TIER_2_ROLES = [...TIER_1_ROLES, 'store_staff']

export default function AnalyticsRouteGuard({ children, tier = 1 }) {
  const { role, profileReady } = useAuth()

  if (!profileReady) return <LoadingSpinner />

  const allowed = tier === 2 ? TIER_2_ROLES : TIER_1_ROLES
  const userRole = role?.name

  if (!allowed.includes(userRole)) {
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
          這個分析頁面僅限 {tier === 1 ? '主管以上' : '主管 / 門市人員'} 角色查看。
          <br />
          目前你的角色：<b>{userRole || '未設定'}</b>
        </p>
        <Navigate to="/" replace />
      </div>
    )
  }

  return children
}
