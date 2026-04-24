/**
 * Middleware: inject organization_id from localStorage into event metadata.
 * TenantContext.jsx stores { organization_id, ... } under the 'sme_tenant' key.
 */
export async function tenantContextMiddleware(event, next) {
  if (!event.metadata.organization_id) {
    try {
      const saved = localStorage.getItem('sme_tenant')
      if (saved) {
        const parsed = JSON.parse(saved)
        event.metadata.organization_id = parsed?.organization_id || null
      }
    } catch {
      // localStorage may not be available (SSR, tests)
    }
  }
  return next()
}
