import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)       // Supabase auth user
  const [profile, setProfile] = useState(null) // employees table row
  const [loading, setLoading] = useState(true)

  const loadProfile = async (authUser) => {
    if (!authUser) { setProfile(null); return }
    try {
      // Try matching by email first
      let { data } = await supabase
        .from('employees')
        .select('*')
        .eq('email', authUser.email)
        .single()

      // If no match by email, try by auth user metadata (for OAuth users)
      if (!data && authUser.user_metadata?.full_name) {
        const res = await supabase
          .from('employees')
          .select('*')
          .eq('name', authUser.user_metadata.full_name)
          .single()
        data = res.data
      }

      setProfile(data || null)
    } catch (err) {
      console.error('Failed to load employee profile:', err)
      setProfile(null)
    }
  }

  useEffect(() => {
    // Timeout to prevent infinite loading
    const timeout = setTimeout(() => setLoading(false), 5000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      loadProfile(u).finally(() => { clearTimeout(timeout); setLoading(false) })
    }).catch((err) => {
      console.error('Failed to retrieve session:', err)
      clearTimeout(timeout)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        const u = session?.user ?? null
        setUser(u)
        await loadProfile(u)
      } catch (err) {
        console.error('Auth state change error:', err)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signInWithProvider = (provider) =>
    supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
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
