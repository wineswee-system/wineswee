import { useNavigate } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const ROLE_LABEL = {
  super_admin: '超級管理員', admin: '管理員', manager: '主管',
  office_staff: '辦公室員工', store_staff: '店員',
}

export default function AccessDenied() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0f1117',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 380, background: '#141720', borderRadius: 16,
        border: '1px solid #1f2336', padding: '48px 40px', textAlign: 'center',
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: '50%',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <ShieldOff size={26} color="#ef4444" />
        </div>

        <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e7eb', marginBottom: 8 }}>
          無存取權限
        </div>
        <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 28 }}>
          Floor Panel 僅限管理員與主管使用。
          {employee ? (
            <div style={{ marginTop: 12, fontSize: 13, color: '#4b5563' }}>
              目前登入：{employee.name}（{ROLE_LABEL[employee.role] ?? employee.role}）
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 13, color: '#4b5563' }}>
              找不到對應的員工帳號，請聯絡管理員。
            </div>
          )}
        </div>

        <button onClick={signOut} style={{
          width: '100%', padding: '12px',
          background: 'transparent', border: '1px solid #2d3148',
          borderRadius: 10, color: '#9ca3af', fontSize: 14, cursor: 'pointer',
        }}>
          登出
        </button>
      </div>
    </div>
  )
}
