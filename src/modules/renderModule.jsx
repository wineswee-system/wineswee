import { Navigate, Route } from 'react-router-dom'
import PagePermGuard from '../components/PagePermGuard'
import { isOrgScopedPrefix } from '../lib/orgPath'

// Converts a module manifest entry into an array of <Route> elements.
// Handles four manifest patterns:
//   subRoutes   — extra permission-guarded routes before the wildcard
//   alsoBase    — also register the exact basePath (e.g. /analytics, /sales, /pos)
//   superAdminOnly — isSuperAdmin check instead of canAccess
//   default     — single wildcard route
//
// 每個 module Comp 外再包一層 PagePermGuard：依當前 pathname 對細項頁面權限做
// 中央檢查（見 components/PagePermGuard.jsx 的 PAGE_PERM）。module 級放行後，
// 個別特權頁仍會被細項碼擋下，也補上「直接打網址」繞過 sidebar 的洞。
export function renderModule(m, { canAccess, canAccessWithPerm, isSuperAdmin }) {
  const blocked = <Navigate to="/" replace />
  const hasAccess = (perm) => perm ? canAccessWithPerm(m.basePath, perm) : canAccess(m.basePath)
  const Comp = m.component
  const guarded = <PagePermGuard><Comp /></PagePermGuard>
  const routes = []

  // org-scoped 模組:網址帶入 org 段 → /{basePath}/:orgId/{page}
  // (super_admin 專屬工具維持原路徑,不帶 orgId)
  const orgSeg = isOrgScopedPrefix(m.basePath) ? '/:orgId' : ''

  for (const sub of m.subRoutes ?? []) {
    routes.push(
      <Route key={`${m.basePath}/${sub.path}`} path={`${m.basePath}${orgSeg}/${sub.path}`}
        element={hasAccess(sub.perm) ? guarded : blocked} />
    )
  }

  if (m.alsoBase) {
    routes.push(
      <Route key={m.basePath} path={`${m.basePath}${orgSeg}`}
        element={m.superAdminOnly
          ? (isSuperAdmin ? guarded : blocked)
          : (hasAccess(m.perm) ? guarded : blocked)} />
    )
  }

  routes.push(
    <Route key={`${m.basePath}/*`} path={`${m.basePath}${orgSeg}/*`}
      element={m.superAdminOnly
        ? (isSuperAdmin ? guarded : blocked)
        : (hasAccess(m.perm) ? guarded : blocked)} />
  )

  return routes
}
