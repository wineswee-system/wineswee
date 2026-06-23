import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, Map, LogOut, ChevronDown } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useStore } from '../contexts/StoreContext'
import { supabase } from '../lib/supabase'

const NAV = [
  { to: '/overview', icon: LayoutDashboard, label: '今日總覽' },
  { to: '/list',     icon: ClipboardList,   label: '訂位清單' },
  { to: '/seating',  icon: Map,             label: '座位地圖' },
]

export default function Layout({ children }) {
  const { user } = useAuth()
  const { stores, storeId, setStoreId } = useStore()
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, flexShrink: 0,
        background: '#ffffff',
        borderRight: '1px solid #e9ecf1',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Brand */}
        <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid #e9ecf1' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>Floor Panel</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>訂位管理系統</div>
        </div>

        {/* Store selector */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e9ecf1' }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>目前店家</div>
          <div style={{ position: 'relative' }}>
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              style={{
                width: '100%', background: '#ffffff', border: '1px solid #e2e8f0',
                borderRadius: 8, color: '#111827', padding: '8px 28px 8px 10px',
                fontSize: 13, cursor: 'pointer', outline: 'none', appearance: 'none',
              }}
            >
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <ChevronDown size={13} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', pointerEvents: 'none' }} />
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 8, textDecoration: 'none',
              fontSize: 14, fontWeight: isActive ? 600 : 400,
              color: isActive ? '#0369a1' : '#6b7280',
              background: isActive ? '#e0f2fe' : 'transparent',
            })}>
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User / logout */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #e9ecf1' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </div>
          <button onClick={signOut} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'transparent', border: '1px solid #e2e8f0',
            borderRadius: 8, color: '#6b7280', padding: '8px 12px',
            fontSize: 13, cursor: 'pointer', width: '100%',
          }}>
            <LogOut size={14} />
            登出
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', background: '#f1f5f9' }}>
        {children}
      </main>
    </div>
  )
}
