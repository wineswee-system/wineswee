import { createContext, useContext, useMemo } from 'react'
import { useAuth } from './AuthContext'

const TenantContext = createContext(null)

export function TenantProvider({ children }) {
  const { profile, organization } = useAuth()

  const authorizedOrgId = profile?.organization_id ?? null

  // Derive tenant shape from AuthContext — no separate DB query, no localStorage
  const tenant = useMemo(
    () => authorizedOrgId != null ? { organization_id: authorizedOrgId, organization } : null,
    [authorizedOrgId, organization]
  )

  const switchTenant = async (tenantData) => {
    const incoming = tenantData?.organization_id ?? tenantData?.id ?? null
    if (authorizedOrgId !== null && incoming !== null && incoming !== authorizedOrgId) {
      return { error: 'Tenant switch denied: org mismatch' }
    }
    return { error: null }
  }

  const clearTenant = () => {}

  const value = useMemo(
    () => ({ tenant, organization, loading: false, switchTenant, clearTenant }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenant, organization]
  )

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  )
}

export const useTenant = () => useContext(TenantContext)
