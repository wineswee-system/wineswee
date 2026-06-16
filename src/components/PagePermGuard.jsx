import { useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

// ════════════════════════════════════════════════════════════════════════
// 中央頁面權限 guard
//
// 只列「整頁本身就是特權功能、非授權者不該進」的頁面，path → 權限碼。
// 規則（很重要，別踩雷）：
//   1. 碼必須「真實存在於 permissions 表」(見 20260515100000_permissions_redesign_40.sql)。
//      前端 FEATURES 清單有些 *.view 碼從沒種進 DB，拿來 gate 會把所有非 super_admin 鎖死。
//   2. 只列 admin「角色預設一定有」的碼，admin 永遠進得去；manager/staff 才被收緊。
//   3. 雙用途頁面（員工也看自己的：打卡/排班/薪資/假單/費用申請）不要列在這，
//      否則會擋掉員工看自己 → 改在頁內 gate 個別按鈕。
//   4. 缺項 = 放行（安全預設）：map 寫錯頂多沒擋到，不會誤鎖。
// ════════════════════════════════════════════════════════════════════════
export const PAGE_PERM = {
  '/hr/recruitment':      'recruit.manage',
  '/hr/training':         'training.manage',
  '/hr/probation':        'probation.evaluate',
  '/hr/severance':        'severance.execute',
  '/hr/legal-deductions': 'legal_deduction.edit',
  '/hr/bonus':            'bonus.compute',
  '/hr/surveys':          'survey.view_result',
  '/hr/attrition':        'ai_attrition.view',
}

function NoPermission() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 24px', textAlign: 'center', color: 'var(--text-secondary)',
    }}>
      <ShieldAlert size={48} style={{ color: 'var(--accent-orange)', marginBottom: 16 }} />
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>沒有存取權限</h2>
      <p style={{ fontSize: 14, maxWidth: 420 }}>
        你的角色尚未開放此功能。如需使用，請聯繫系統管理員於「系統設定 → 權限」開通。
      </p>
    </div>
  )
}

export default function PagePermGuard({ children }) {
  const { pathname } = useLocation()
  const { hasPermission } = useAuth()
  const code = PAGE_PERM[pathname]
  if (code && !hasPermission(code)) return <NoPermission />
  return children
}
