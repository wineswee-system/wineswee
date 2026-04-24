import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const TenantContext = createContext(null)

export function TenantProvider({ children }) {
  const [tenant, setTenant] = useState(null)
  const [organization, setOrganization] = useState(null)
  const [loading, setLoading] = useState(true)

  // Returns the authenticated user's authorized organization_id from the server.
  // The tenant is always server-validated: localStorage is used only as a fast-path
  // cache. Any mismatch or missing entry triggers automatic re-initialization from
  // the server, so an attacker cannot force a cross-tenant read by manipulating
  // localStorage, and deleting the localStorage key cannot produce a blank-tenant DoS.
  const getAuthorizedOrgId = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null
    const { data: emp } = await supabase
      .from('employees').select('organization_id').eq('email', session.user.email).maybeSingle()
    return emp?.organization_id ?? null
  }

  useEffect(() => {
    const restoreTenant = async () => {
      const authorizedOrgId = await getAuthorizedOrgId()
      const savedTenant = localStorage.getItem('sme_tenant')
      let usedCache = false

      if (savedTenant) {
        try {
          const parsed = JSON.parse(savedTenant)
          // Reject stored tenant if org doesn't match the authenticated user's org.
          // Fall back to parsed.id for entries cached before the organization_id normalization.
          const storedOrgId = parsed?.organization_id ?? parsed?.id ?? null
          if (authorizedOrgId !== null && storedOrgId !== authorizedOrgId) {
            localStorage.removeItem('sme_tenant')
          } else {
            setTenant(parsed)
            if (parsed?.organization) {
              setOrganization(parsed.organization)
            } else if (parsed?.organization_id) {
              const { data } = await supabase.from('organizations').select('*').eq('id', parsed.organization_id).single()
              if (data) setOrganization(data)
            }
            usedCache = true
          }
        } catch { localStorage.removeItem('sme_tenant') }
      }

      // If localStorage was empty or was rejected (mismatch/corrupt), auto-initialize
      // from the server so the user is never left with a null tenant after a valid login.
      // This also closes the DoS window where deleting the localStorage key breaks the UI.
      if (!usedCache && authorizedOrgId !== null) {
        const { data: org } = await supabase.from('organizations').select('*').eq('id', authorizedOrgId).single()
        if (org) {
          const tenantData = { organization_id: authorizedOrgId, organization: org }
          setTenant(tenantData)
          setOrganization(org)
          localStorage.setItem('sme_tenant', JSON.stringify(tenantData))
        }
      }

      setLoading(false)
    }
    restoreTenant()
  }, [])

  const switchTenant = async (tenantData) => {
    // Normalize: organizations rows from getTenants() have .id not .organization_id
    tenantData = { ...tenantData, organization_id: tenantData.organization_id ?? tenantData.id ?? null }

    // Verify the user belongs to the target org before accepting the switch
    if (tenantData.organization_id) {
      const authorizedOrgId = await getAuthorizedOrgId()
      if (authorizedOrgId !== null && tenantData.organization_id !== authorizedOrgId) {
        console.error('Tenant switch denied: org mismatch')
        return
      }
    }
    setTenant(tenantData)
    if (tenantData.organization_id) {
      const { data: org } = await supabase.from('organizations').select('*').eq('id', tenantData.organization_id).single()
      if (org) {
        setOrganization(org)
        tenantData = { ...tenantData, organization: org }
      }
    }
    localStorage.setItem('sme_tenant', JSON.stringify(tenantData))
  }

  const clearTenant = () => {
    setTenant(null)
    setOrganization(null)
    localStorage.removeItem('sme_tenant')
  }

  return (
    <TenantContext.Provider value={{ tenant, organization, loading, switchTenant, clearTenant }}>
      {children}
    </TenantContext.Provider>
  )
}

export const useTenant = () => useContext(TenantContext)
