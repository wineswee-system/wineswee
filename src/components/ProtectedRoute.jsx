import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/**
 * Route-level auth guard. Wraps routes that require authentication.
 * Optionally checks for specific permission codes.
 *
 * Usage:
 *   <Route element={<ProtectedRoute />}> ... child routes ... </Route>
 *   <Route element={<ProtectedRoute requiredPermission="finance.edit" />}> ... </Route>
 */
export default function ProtectedRoute({ children, requiredPermission }) {
  const { user, loading, hasPermission } = useAuth()

  if (loading) return null

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <h2 style={{ margin: 0 }}>權限不足</h2>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>您沒有存取此頁面的權限（需要：{requiredPermission}）</p>
        <button className="btn btn-primary" onClick={() => window.history.back()}>返回</button>
      </div>
    )
  }

  return children
}
