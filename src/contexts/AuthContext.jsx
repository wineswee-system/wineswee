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

  const loadProfile = useCallback(async (authUser) => {
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
      // H-7: Prefer auth_user_id (immune to email-change hijack); fall back to email for legacy records
      const EMP_FIELDS = 'id, name, name_en, email, role, role_id, organization_id, dept, status, phone, avatar, avatar_url, store, store_id, position'
      let { data: emp } = await supabase
        .from('employees').select(EMP_FIELDS).eq('auth_user_id', authUser.id).maybeSingle()
      if (!emp) {
        const { data: empByEmail } = await supabase
          .from('employees').select(EMP_FIELDS).eq('email', authUser.email).maybeSingle()
        emp = empByEmail
      }
      setProfile(emp || null)
      if (!emp) return

      // Load organization
      if (emp.organization_id) {
        const { data: org } = await supabase
          .from('organizations').select('id, name, slug, plan, status').eq('id', emp.organization_id).maybeSingle()
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
  }, [])

  useEffect(() => {
    // Track whether the subscription has already handled auth state.
    // If it has, the getSession() fallback below becomes a no-op.
    const fired = { current: false }

    // Safety fallback: resolve auth state via a direct API call in case
    // onAuthStateChange doesn't fire (offline mode, SW interception).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (fired.current) return
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (u) loadProfile(u)
      else setProfileReady(true)
    }).catch(() => {
      if (!fired.current) { setLoading(false); setProfileReady(true) }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      fired.current = true
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (u) {
        loadProfile(u)
      } else {
        setProfile(null); setOrganization(null); setRole(null); setPermissions([])
        profileLoaded.current = false
        setProfileReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [loadProfile])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null); setProfile(null); setOrganization(null); setRole(null); setPermissions([])
    profileLoaded.current = false
  }

  const hasPermission = useCallback((code) => {
    if (role?.name === 'super_admin') return true
    return permissions.includes(code)
  }, [permissions, role])

  const isAdmin = role?.name === 'admin' || role?.name === 'super_admin'
  const isSuperAdmin = role?.name === 'super_admin'

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
