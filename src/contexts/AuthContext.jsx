import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const profileLoaded = useRef(false)

  useEffect(() => {
    // 1. Check session immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false) // Always stop loading here, never wait for profile

      // Load profile in background (non-blocking)
      if (u?.email && !profileLoaded.current) {
        profileLoaded.current = true
        supabase.from('employees').select('*').eq('email', u.email).maybeSingle()
          .then(({ data }) => setProfile(data || null))
          .catch(() => setProfile(null))
      }
    }).catch(() => setLoading(false))

    // 2. Listen for auth changes (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)

      if (u?.email) {
        supabase.from('employees').select('*').eq('email', u.email).maybeSingle()
          .then(({ data }) => setProfile(data || null))
          .catch(() => setProfile(null))
      } else {
        setProfile(null)
        profileLoaded.current = false
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    profileLoaded.current = false
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      isAuthenticated: !!user,
      isAdmin: profile?.role === 'admin' || profile?.role === 'super_admin',
      isSuperAdmin: profile?.role === 'super_admin',
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
