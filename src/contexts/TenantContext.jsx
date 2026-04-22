import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const TenantContext = createContext(null)

export function TenantProvider({ children }) {
  const [tenant, setTenant] = useState(null)
  const [organization, setOrganization] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const savedTenant = localStorage.getItem('sme_tenant')
    if (savedTenant) {
      try {
        const parsed = JSON.parse(savedTenant)
        setTenant(parsed)
        if (parsed?.organization) {
          setOrganization(parsed.organization)
        } else if (parsed?.organization_id) {
          supabase.from('organizations').select('*').eq('id', parsed.organization_id).single()
            .then(({ data }) => { if (data) setOrganization(data) })
        }
      } catch { /* ignore corrupt data */ }
    }
    setLoading(false)
  }, [])

  const switchTenant = async (tenantData) => {
    setTenant(tenantData)
    if (tenantData?.organization_id) {
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
