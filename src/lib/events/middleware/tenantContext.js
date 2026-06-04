/**
 * Middleware: inject organization_id from auth context into event metadata.
 *
 * AuthContext calls setTenantOrgId(orgId) after loadProfile() resolves and
 * on signOut(). This gives the singleton EventBus access to the current
 * session's org without touching localStorage (which has no per-session scope).
 */

let _orgId = null

/** Called by AuthContext after profile loads and on signOut. */
export function setTenantOrgId(orgId) {
  _orgId = orgId ?? null
}

export async function tenantContextMiddleware(event, next) {
  if (!event.metadata.organization_id && _orgId) {
    event.metadata.organization_id = _orgId
  }
  return next()
}
