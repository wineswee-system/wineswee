import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const TenantContext = createContext(null)

export function TenantProvider({ children }) {
  // Derive authorized org from AuthContext — avoids a redundant employees table query
  const { profile, profileReady } = useAuth()
  const authorizedOrgId = profile?.organization_id ?? null
  const [tenant, setTenant] = useState(null)
  const [organization, setOrganization] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profileReady) return

    const restoreTenant = async () => {
      // User logged out or has no org — clear state and localStorage
      if (authorizedOrgId === null) {
        setTenant(null)
        setOrganization(null)
        localStorage.removeItem('sme_tenant')
        setLoading(false)
        return
      }

      const savedTenant = localStorage.getItem('sme_tenant')
      let usedCache = false

      if (savedTenant) {
        try {
          const parsed = JSON.parse(savedTenant)
          // Fall back to parsed.id for entries cached before organization_id normalization
          const storedOrgId = parsed?.organization_id ?? parsed?.id ?? null
          if (storedOrgId !== authorizedOrgId) {
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

      // No valid cache — initialize from server
      if (!usedCache) {
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
  }, [profileReady, authorizedOrgId])

  const switchTenant = async (tenantData) => {
    // Normalize: organizations rows from getTenants() have .id not .organization_id
    tenantData = { ...tenantData, organization_id: tenantData.organization_id ?? tenantData.id ?? null }

    if (tenantData.organization_id) {
      if (authorizedOrgId !== null && tenantData.organization_id !== authorizedOrgId) {
        return { error: 'Tenant switch denied: org mismatch' }
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
    return { error: null }
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
