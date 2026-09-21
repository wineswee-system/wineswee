import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const LINE_ERROR_MSG = {
  auth_failed: 'LINE 驗證失敗，請重試',
  no_account:  '此 LINE 帳號尚未綁定，請先以Email登入',
  cancelled:   '已取消 LINE 登入',
}

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [lineLoading, setLineLoading] = useState(false)
  const [error, setError]       = useState('')
  const navigate = useNavigate()

  // Handle error params from the edge-function redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('line_error')
    if (code) {
      setError(LINE_ERROR_MSG[code] || code)
      window.history.replaceState({}, '', '/login')
    }
  }, [])

  async function submitEmail(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) { setError(err.message); return }
    navigate('/', { replace: true })
  }

  function signInWithLine() {
    setLineLoading(true)
    setError('')
    // Same edge function as sme-ops — pass site_url so it redirects back here
    const qs = new URLSearchParams({ action: 'authorize', site_url: window.location.origin })
    window.location.href = `${SUPABASE_URL}/functions/v1/line-login?${qs}`
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f1f5f9',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 360, background: '#ffffff',
        borderRadius: 16, border: '1px solid #e9ecf1',
        padding: '40px 36px',
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Floor Panel</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>限管理員、主管登入</div>
        </div>

        {/* LINE Login */}
        <button onClick={signInWithLine} disabled={lineLoading}
          style={{
            width: '100%', padding: '12px', marginBottom: 20,
            background: lineLoading ? '#04a244' : '#06C755',
            color: '#fff', border: 'none', borderRadius: 10,
            fontSize: 15, fontWeight: 700, cursor: lineLoading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            opacity: lineLoading ? 0.7 : 1,
          }}>
          <LineIcon />
          {lineLoading ? '導向 LINE…' : '以 LINE 帳號登入'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: '#e9ecf1' }} />
          <span style={{ fontSize: 12, color: '#6b7280' }}>或使用帳號密碼</span>
          <div style={{ flex: 1, height: 1, background: '#e9ecf1' }} />
        </div>

        {/* Email/password */}
        <form onSubmit={submitEmail} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 6 }}>Email</label>
            <input type="email" required autoFocus value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com" style={INPUT} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 6 }}>密碼</label>
            <input type="password" required value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" style={INPUT} />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', borderRadius: 8, padding: '10px 14px' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            padding: '12px', background: '#0891b2', color: '#fff',
            border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
          }}>
            {loading ? '登入中…' : '登入'}
          </button>
        </form>
      </div>
    </div>
  )
}

function LineIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.952 11.032C19.952 7.014 15.961 3.75 11.041 3.75c-4.92 0-8.911 3.264-8.911 7.282 0 3.6 3.193 6.617 7.507 7.192.292.063.69.193.79.443.09.227.06.583.029.813l-.128.77c-.039.227-.18.887.777.484.957-.403 5.165-3.044 7.047-5.21.008-.009.017-.019.025-.028 1.3-1.426 1.775-2.877 1.775-4.464z"/>
      <path fill="#06C755" d="M10.018 9.28H9.14a.228.228 0 00-.228.228v3.456c0 .126.102.228.228.228h.878a.228.228 0 00.228-.228V9.508a.228.228 0 00-.228-.228zM14.856 9.28h-.878a.228.228 0 00-.228.228v2.052l-1.583-2.142a.232.232 0 00-.019-.024l-.001-.001-.015-.015-.004-.004-.013-.01-.006-.004-.012-.007-.007-.004-.013-.005-.007-.003-.014-.003h-.008l-.014-.001H11.2a.228.228 0 00-.228.228v3.456c0 .126.102.228.228.228h.878a.228.228 0 00.228-.228v-2.05l1.585 2.143a.23.23 0 00.058.057l.003.002.014.008.005.002.011.004.01.003h.009l.015.003h.002a.23.23 0 00.057.008h.878a.228.228 0 00.228-.228V9.508a.228.228 0 00-.228-.228z"/>
    </svg>
  )
}

const INPUT = {
  width: '100%', background: '#f9fafb', border: '1px solid #d1d5db',
  borderRadius: 8, color: '#111827', padding: '10px 12px',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
