import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { signIn, signInWithProvider } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await signIn(email, password)
    if (err) setError('帳號或密碼錯誤')
    setLoading(false)
  }

  const handleOAuth = async (provider) => {
    setError('')
    setLoading(true)
    const { error: err } = await signInWithProvider(provider)
    if (err) setError(`${provider} 登入失敗：${err.message}`)
    setLoading(false)
  }

  const oauthBtnStyle = (bg, color) => ({
    width: '100%', padding: '10px', fontSize: 13, fontWeight: 600,
    borderRadius: 10, border: '1px solid var(--border-medium)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: bg, color,
  })

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)',
    }}>
      <div style={{
        width: '100%', maxWidth: 400,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-medium)',
        borderRadius: 20, padding: 40,
        boxShadow: 'var(--shadow-xl)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 12px',
            background: 'linear-gradient(135deg, var(--accent-cyan-dim), var(--accent-purple-dim))',
            border: '1px solid var(--accent-cyan)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, color: 'var(--accent-cyan)',
          }}>AI</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>SME Ops</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>請登入您的帳號</p>
        </div>

        {/* OAuth buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <button onClick={() => handleOAuth('google')} disabled={loading}
            style={oauthBtnStyle('#fff', '#333')}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Google 登入
          </button>

          <button onClick={() => handleOAuth('facebook')} disabled={loading}
            style={oauthBtnStyle('#1877F2', '#fff')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            Facebook 登入
          </button>

          <button onClick={() => handleOAuth('line')} disabled={loading}
            style={oauthBtnStyle('#06C755', '#fff')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .348-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .349-.281.63-.63.63h-2.386a.63.63 0 01-.63-.63V8.108c0-.348.282-.63.63-.63h2.386c.349 0 .63.282.63.63 0 .349-.281.631-.63.631H17.61v1.125h1.755zm-3.855 3.016a.63.63 0 01-.63.63.629.629 0 01-.51-.26l-2.443-3.317v2.947a.63.63 0 01-1.26 0V8.108a.63.63 0 01.63-.63c.2 0 .385.096.51.26l2.443 3.317V8.108a.63.63 0 011.26 0v4.771zm-5.741 0a.63.63 0 01-1.26 0V8.108a.63.63 0 011.26 0v4.771zm-2.466.63H4.917a.63.63 0 01-.63-.63V8.108c0-.348.282-.63.63-.63.349 0 .63.282.63.63v4.141h1.756c.348 0 .63.283.63.63 0 .349-.282.63-.63.63M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
            LINE 登入
          </button>
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border-medium)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>或使用 Email</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border-medium)' }} />
        </div>

        {/* Email/Password form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Email</label>
            <input
              className="form-input"
              type="email"
              style={{ width: '100%' }}
              placeholder="your@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>密碼</label>
            <input
              className="form-input"
              type="password"
              style={{ width: '100%' }}
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div style={{
              background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)',
              borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--accent-red)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '10px', fontSize: 14, marginTop: 4 }}
            disabled={loading}
          >
            {loading ? '登入中...' : 'Email 登入'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          登入後系統會自動連結您的員工帳號
        </div>
      </div>
    </div>
  )
}
