import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const TenantContext = createContext(null)

export function TenantProvider({ children }) {
  const [tenant, setTenant] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const savedTenant = localStorage.getItem('sme_tenant')
    if (savedTenant) {
      try {
        const parsed = JSON.parse(savedTenant)
        setTenant(parsed)
        // Restore RLS tenant_id on page reload
        if (parsed?.id) {
          supabase.rpc('set_config', { setting: 'app.tenant_id', value: String(parsed.id) }).catch(() => {})
        }
      } catch { /* ignore corrupt data */ }
    }
    setLoading(false)
  }, [])

  const switchTenant = (tenantData) => {
    setTenant(tenantData)
    localStorage.setItem('sme_tenant', JSON.stringify(tenantData))
    // Set tenant_id header for Supabase RLS policies
    if (tenantData?.id) {
      supabase.rpc('set_config', { setting: 'app.tenant_id', value: String(tenantData.id) }).then(() => {})
    }
  }

  const clearTenant = () => {
    setTenant(null)
    localStorage.removeItem('sme_tenant')
  }

  return (
    <TenantContext.Provider value={{ tenant, loading, switchTenant, clearTenant }}>
      {children}
    </TenantContext.Provider>
  )
}

export const useTenant = () => useContext(TenantContext)
