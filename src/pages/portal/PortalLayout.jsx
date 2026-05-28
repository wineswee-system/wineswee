import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { LogOut, Shield } from 'lucide-react'

export default function PortalLayout() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Top bar */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 56, flexShrink: 0,
        background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(16px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9,
            background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 800, color: '#fff',
          }}>S</div>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>SME OPS</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
            background: 'var(--accent-green-dim)', color: 'var(--accent-green)',
          }}>員工 Portal</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/')}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'var(--glass-light)', border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            <Shield size={12} /> 管理後台
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: profile?.avatar || 'var(--accent-cyan)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: '#fff',
            }}>{profile?.name?.[0]}</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{profile?.name}</span>
          </div>
          <button onClick={signOut} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
            <LogOut size={15} />
          </button>
        </div>
      </nav>

      {/* Content — flex:1 + overflow-y:auto 撐起內部捲動（body overflow:hidden 全域擋住的修正） */}
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
