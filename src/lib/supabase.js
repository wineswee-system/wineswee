import { createClient } from '@supabase/supabase-js'
import { recordResponse } from './outageBus'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

async function resilientFetch(input, init) {
  try {
    const res = await fetch(input, init)
    recordResponse(res.status)
    return res
  } catch (err) {
    throw err
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  global: { fetch: resilientFetch },
})
