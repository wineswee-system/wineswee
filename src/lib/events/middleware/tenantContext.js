/**
 * Middleware: inject tenant_id from localStorage into event metadata.
 * Mirrors the TenantContext.jsx pattern used in the React app.
 */
export async function tenantContextMiddleware(event, next) {
  if (!event.metadata.tenant_id) {
    try {
      const saved = localStorage.getItem('sme_tenant')
      if (saved) {
        const parsed = JSON.parse(saved)
        event.metadata.tenant_id = parsed?.id || null
      }
    } catch {
      // localStorage may not be available (SSR, tests)
    }
  }
  return next()
}
