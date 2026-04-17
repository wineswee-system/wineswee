import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)       // Supabase auth user
  const [profile, setProfile] = useState(null) // employees table row
  const [loading, setLoading] = useState(true)

  const loadProfile = async (authUser) => {
    if (!authUser?.email) { setProfile(null); return }
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('email', authUser.email)
        .maybeSingle()

      if (error) console.error('Profile query error:', error)
      setProfile(data || null)
    } catch (err) {
      console.error('Failed to load employee profile:', err)
      setProfile(null)
    }
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        loadProfile(u).finally(() => { if (mounted) setLoading(false) })
      } else {
        setLoading(false)
      }
    }).catch(() => {
      if (mounted) setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        await loadProfile(u)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signInWithProvider = (provider) =>
    supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const isAuthenticated = !!user
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const isSuperAdmin = profile?.role === 'super_admin'

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      isAuthenticated, isAdmin, isSuperAdmin,
      signIn, signInWithProvider, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
