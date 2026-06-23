import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Roles allowed to access the floor panel
const ALLOWED_ROLES = ['super_admin', 'admin', 'manager']

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]         = useState(undefined) // undefined = loading
  const [employee, setEmployee] = useState(null)
  const [loading, setLoading]   = useState(true)

  async function loadEmployee(authUser) {
    if (!authUser) {
      setEmployee(null)
      setLoading(false)
      return
    }
    setLoading(true)

    // Match by auth_user_id (set by the line-login edge function and email/password login)
    const { data: emp } = await supabase
      .from('employees')
      .select('id, name, role, organization_id, store_id')
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    setEmployee(emp ?? null)
    setLoading(false)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')

    if (tokenHash) {
      // token_hash path: verifyOtp exchanges the magic-link token for a session.
      // Skip getSession() — there is no session yet. onAuthStateChange fires on completion.
      const type = params.get('type') || 'magiclink'
      supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        .then(() => window.history.replaceState({}, '', '/'))
        .catch(() => { setUser(null); setEmployee(null); setLoading(false) })
    } else {
      // Normal path: check for an existing session (page refresh, email/password login)
      supabase.auth.getSession().then(({ data }) => {
        const u = data.session?.user ?? null
        setUser(u)
        loadEmployee(u)
      })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        loadEmployee(u)
      } else {
        setEmployee(null)
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const isAllowed = !!employee && ALLOWED_ROLES.includes(employee.role)

  return (
    <AuthCtx.Provider value={{ user, employee, loading, isAllowed }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
