import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { setTenantOrgId } from '../lib/events/middleware/tenantContext'

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
      const EMP_FIELDS = 'id, name, name_en, email, role, role_id, organization_id, dept, department_id, status, phone, avatar, avatar_url, store, store_id, position'
      let { data: emp } = await supabase
        .from('employees').select(EMP_FIELDS).eq('auth_user_id', authUser.id).maybeSingle()
      if (!emp) {
        const { data: empByEmail } = await supabase
          .from('employees').select(EMP_FIELDS).eq('email', authUser.email).maybeSingle()
        emp = empByEmail
      }
      setProfile(emp || null)
      setTenantOrgId(emp?.organization_id ?? null)
      if (!emp) return

      // Fetch org, role, and permissions in parallel (independent queries)
      const [orgResult, roleResult, permsResult] = await Promise.all([
        emp.organization_id
          ? supabase.from('organizations').select('id, name, slug, plan, status').eq('id', emp.organization_id).maybeSingle()
          : Promise.resolve({ data: null }),
        emp.role_id
          ? supabase.from('roles').select('*').eq('id', emp.role_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.rpc('get_employee_effective_permissions', { p_emp_id: emp.id }),
      ])
      setOrganization(orgResult.data || null)
      setRole(roleResult.data || null)
      // 用 effective_permissions RPC 抓含個人 override 的最終清單
      setPermissions((permsResult.data || []).filter(p => p.effective).map(p => p.code).filter(Boolean))
    } catch (err) {
      console.error('Failed to load employee profile:', err?.message ?? 'unknown error')
      setProfile(null)
      setTenantOrgId(null)
      // Allow retry on next auth event
      profileLoaded.current = false
    } finally {
      setProfileReady(true)
    }
  }, [])

  useEffect(() => {
    // Exchange magic-link token_hash redirected from the line-login edge function.
    // The edge function now redirects here directly (bypassing Supabase's redirect-URL
    // allowlist); verifyOtp exchanges the token for a session, then onAuthStateChange fires.
    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    if (tokenHash) {
      const type = params.get('type') || 'magiclink'
      supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        .then(() => window.history.replaceState({}, '', '/'))
    }

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
        setTenantOrgId(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [loadProfile])

  // Mid-session permission refresh: Realtime on employee_permissions
  // When admin grants/revokes a perm, the affected employee's session updates
  // immediately without needing a force-logout.
  useEffect(() => {
    const empId = profile?.id
    if (!empId) return
    const refreshPerms = async () => {
      const { data } = await supabase.rpc('get_employee_effective_permissions', { p_emp_id: empId })
      if (data) setPermissions(data.filter(p => p.effective).map(p => p.code).filter(Boolean))
    }
    const channel = supabase
      .channel(`perms-refresh-${empId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'employee_permissions',
        filter: `employee_id=eq.${empId}`,
      }, refreshPerms)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.id])

  // 強制登出：Realtime + polling 雙保險
  useEffect(() => {
    const empId = profile?.id
    if (!empId) return
    const loginTime = Date.now()

    // Realtime（需 employees 表在 supabase_realtime publication）
    const channel = supabase
      .channel(`force-logout-${empId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'employees',
        filter: `id=eq.${empId}`,
      }, (payload) => {
        // 跟 polling 同邏輯：只有 force_logout_at 比本次登入「晚」才登出，
        // 不然 admin 編輯員工資料 → UPDATE → 觸發 Realtime → 員工 force_logout_at
        // 還留著舊 timestamp → 誤觸 signOut
        const flag = payload.new?.force_logout_at
        if (flag && new Date(flag).getTime() > loginTime) {
          supabase.auth.signOut()
        }
      })
      .subscribe()

    // Polling 備援：每 60 秒查一次，如果 force_logout_at 比本次登入晚就登出
    // 連續失敗（Supabase 掛掉 521/522）最多退讓 4 個週期，避免 outage 期間打爆 API
    let failCount = 0
    const timer = setInterval(async () => {
      if (failCount >= 4) { failCount--; return }
      const { data, error } = await supabase
        .from('employees')
        .select('force_logout_at')
        .eq('id', empId)
        .maybeSingle()
      if (error) { failCount++; return }
      failCount = 0
      if (data?.force_logout_at) {
        const flagTime = new Date(data.force_logout_at).getTime()
        if (flagTime > loginTime) supabase.auth.signOut()
      }
    }, 60000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
    }
  }, [profile?.id])

  const signIn = useCallback((email, password) =>
    supabase.auth.signInWithPassword({ email, password }), [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null); setProfile(null); setOrganization(null); setRole(null); setPermissions([])
    profileLoaded.current = false
    setTenantOrgId(null)
  }, [])

  const hasPermission = useCallback((code) => {
    if (role?.name === 'super_admin') return true
    return permissions.includes(code)
  }, [permissions, role])

  const value = useMemo(() => ({
    user, profile, organization, role, permissions, loading, profileReady,
    isAuthenticated: !!user,
    isAdmin: role?.name === 'admin' || role?.name === 'super_admin',
    isSuperAdmin: role?.name === 'super_admin',
    hasPermission, signIn, signOut,
  }), [user, profile, organization, role, permissions, loading, profileReady, hasPermission, signIn, signOut])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
export const useOrgId = () => useContext(AuthContext)?.profile?.organization_id ?? null
