import { Navigate, Route } from 'react-router-dom'

// Converts a module manifest entry into an array of <Route> elements.
// Handles four manifest patterns:
//   subRoutes   — extra permission-guarded routes before the wildcard
//   alsoBase    — also register the exact basePath (e.g. /analytics, /sales, /pos)
//   superAdminOnly — isSuperAdmin check instead of canAccess
//   default     — single wildcard route
export function renderModule(m, { canAccess, canAccessWithPerm, isSuperAdmin }) {
  const blocked = <Navigate to="/" replace />
  const hasAccess = (perm) => perm ? canAccessWithPerm(m.basePath, perm) : canAccess(m.basePath)
  const Comp = m.component
  const routes = []

  for (const sub of m.subRoutes ?? []) {
    routes.push(
      <Route key={`${m.basePath}/${sub.path}`} path={`${m.basePath}/${sub.path}`}
        element={hasAccess(sub.perm) ? <Comp /> : blocked} />
    )
  }

  if (m.alsoBase) {
    routes.push(
      <Route key={m.basePath} path={m.basePath}
        element={hasAccess(m.perm) ? <Comp /> : blocked} />
    )
  }

  routes.push(
    <Route key={`${m.basePath}/*`} path={`${m.basePath}/*`}
      element={m.superAdminOnly
        ? (isSuperAdmin ? <Comp /> : blocked)
        : (hasAccess(m.perm) ? <Comp /> : blocked)} />
  )

  return routes
}
