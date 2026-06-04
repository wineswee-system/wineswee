import { createContext, useContext, useState, useMemo, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { setTenantOrgId } from '../lib/events/middleware/tenantContext'

const TenantContext = createContext(null)

export function TenantProvider({ children }) {
  const { profile, organization } = useAuth()

  const authorizedOrgId = profile?.organization_id ?? null

  // super_admin impersonation state — null means "use own org"
  const [impersonatedTenant, setImpersonatedTenant] = useState(null)

  // Derive the effective tenant: impersonated (super_admin) takes precedence over own org
  const tenant = useMemo(() => {
    if (impersonatedTenant) return impersonatedTenant
    if (authorizedOrgId != null) return { organization_id: authorizedOrgId, organization }
    return null
  }, [impersonatedTenant, authorizedOrgId, organization])

  const switchTenant = useCallback(async (tenantData) => {
    const incoming = tenantData?.organization_id ?? tenantData?.id ?? null
    // Regular users: reject cross-org switch
    if (authorizedOrgId !== null && incoming !== null && incoming !== authorizedOrgId) {
      return { error: 'Tenant switch denied: org mismatch' }
    }
    // super_admin (authorizedOrgId === null) or own-org switch: allow
    setImpersonatedTenant(tenantData ?? null)
    setTenantOrgId(incoming)
    return { error: null }
  }, [authorizedOrgId])

  const clearTenant = useCallback(() => {
    setImpersonatedTenant(null)
    setTenantOrgId(authorizedOrgId)
  }, [authorizedOrgId])

  const value = useMemo(
    () => ({ tenant, organization, loading: false, switchTenant, clearTenant }),
    [tenant, organization, switchTenant, clearTenant]
  )

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  )
}

export const useTenant = () => useContext(TenantContext)
