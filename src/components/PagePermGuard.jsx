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
// 用「查詢碼」(*.view) gate 頁面進入 → 權限頁的「查詢」toggle 真的會生效。
// 這些 view 碼由 20260515150000_split_view_edit_perms.sql 種入並發給 admin/manager，
// 所以 admin/manager 可看（符合原設計：可看不可改）；office/store 未授予 → 擋下。
// 頁內的「執行/編輯」動作另由動作碼(*.execute/*.edit)gate（見各頁）。
export const PAGE_PERM = {
  '/hr/recruitment':      'recruit.view',
  '/hr/training':         'training.view',
  '/hr/probation':        'probation.view',
  '/hr/severance':        'severance.view',
  '/hr/legal-deductions': 'legal_deduction.view',
  '/hr/bonus':            'bonus.view',
  // 薪資結構設定 / 薪資發放作業 = HR/管理功能（非員工自助頁），堵繞 URL。
  // 用 sidebar 既有的 nav.salary.basic（PATH_REQUIRES 已用同碼隱藏這兩條），admin/HR 進得去。
  '/hr/salary-structures': 'nav.salary.basic',
  '/hr/payroll':           'nav.salary.basic',
  '/hr/surveys':          'survey.view_result',
  '/hr/attrition':        'ai_attrition.view',
  // 任務：admin 以上才可進，堵繞 URL
  '/process/tasks':                            'nav.project.tasks',
  // 簽核鏈設定：只有 approval_chain.edit（admin / super_admin）能進，堵繞 URL
  '/process/settings/chains':                 'approval_chain.edit',
  '/process/settings/chains/edit':            'approval_chain.edit',
  '/process/settings/expense-chains':         'approval_chain.edit',
  '/process/settings/transfer-apply-chains':  'approval_chain.edit',
  '/process/settings/transfer-receipt-chains':'approval_chain.edit',
  '/process/settings/delegation':             'approval.delegate_manage',
  '/org/employees':                           'nav.org.employees',
  '/org/departments':                         'nav.org.departments',
  '/org/locations':                           'nav.org.locations',
  // 出勤管理功能（store_staff 不能進）
  '/hr/clock-rules':                          'nav.schedule.config',
  '/hr/attendance-diff-report':               'nav.schedule.basic',
  '/hr/import':                               'nav.hr_form.builder',
  // 排班管理功能
  '/hr/schedule-xlsx-import':                 'nav.schedule.basic',
  // HR 表單管理（人事異動 / 人力需求 = 人才管理功能，排班權限不對等）
  '/hr/forms/transfer':                       'nav.talent',
  '/hr/forms/headcount':                      'nav.talent',
  '/hr/recently-deleted':                     'nav.org.full',
  // LMS 管理
  '/system/offer-letter-templates':           'nav.lms.admin',
  '/lms/admin':                               'nav.lms.admin',
  '/lms/progress':                            'nav.schedule.basic',
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
