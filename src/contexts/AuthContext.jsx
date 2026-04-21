import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [organization, setOrganization] = useState(null)
  const [role, setRole] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [profileReady, setProfileReady] = useState(false)
  const profileLoaded = useRef(false)

  const loadProfile = async (authUser) => {
    if (!authUser?.email) {
      setProfile(null); setOrganization(null); setRole(null); setPermissions([])
      profileLoaded.current = false
      setProfileReady(true)
      return
    }
    if (profileLoaded.current) return
    profileLoaded.current = true
    setProfileReady(false)

    try {
      const { data: emp } = await supabase
        .from('employees').select('*').eq('email', authUser.email).maybeSingle()
      setProfile(emp || null)
      if (!emp) return

      // Load organization
      if (emp.organization_id) {
        const { data: org } = await supabase
          .from('organizations').select('*').eq('id', emp.organization_id).maybeSingle()
        setOrganization(org || null)
      }

      // Load role + permissions
      if (emp.role_id) {
        const { data: roleData } = await supabase
          .from('roles').select('*').eq('id', emp.role_id).maybeSingle()
        setRole(roleData || null)

        const { data: perms } = await supabase
          .from('role_permissions').select('permissions(code)').eq('role_id', emp.role_id)
        setPermissions((perms || []).map(p => p.permissions?.code).filter(Boolean))
      }
    } catch (err) {
      console.error('Failed to load employee profile:', err)
      setProfile(null)
    } finally {
      setProfileReady(true)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      loadProfile(u)
    }).catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (u) {
        loadProfile(u)
      } else {
        setProfile(null); setOrganization(null); setRole(null); setPermissions([])
        profileLoaded.current = false
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null); setProfile(null); setOrganization(null); setRole(null); setPermissions([])
    profileLoaded.current = false
  }

  const hasPermission = useCallback((code) => {
    if (permissions.includes('admin.system')) return true
    return permissions.includes(code)
  }, [permissions])

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
    || role?.name === 'admin' || role?.name === 'super_admin'
  const isSuperAdmin = profile?.role === 'super_admin' || role?.name === 'super_admin'

  return (
    <AuthContext.Provider value={{
      user, profile, organization, role, permissions, loading, profileReady,
      isAuthenticated: !!user,
      isAdmin, isSuperAdmin, hasPermission,
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
