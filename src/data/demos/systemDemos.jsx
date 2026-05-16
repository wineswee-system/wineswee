import { MockTable, MockBadge } from '../../components/ui/FeatureCarousel'

// ━━━━━━━━━━━━━━━━━━━━ 系統管理 ━━━━━━━━━━━━━━━━━━━━
export const SYSTEM_STEPS = [
  {
    title: 'RBAC 角色權限',
    desc: '依角色設定功能存取權限，確保每位使用者只能看到和操作被授權的範圍。',
    screenTitle: '系統 / 權限管理',
    screen: (
      <div>
        <MockTable headers={['角色', '人數', '權限範圍']} rows={[
          ['系統管理員', '2', '所有功能'],
          ['門市主管', '5', 'HR + POS + 庫存（僅所屬門市）'],
          ['一般員工', '23', '個人出勤 + 請假 + 任務'],
          ['財務人員', '3', '財務全模組 + 報表'],
        ]} />
      </div>
    ),
  },
  {
    title: '操作紀錄追蹤',
    desc: '所有使用者操作留下完整稽核軌跡，欄位級變更紀錄，支援時間範圍查詢。',
    screenTitle: '系統 / 操作紀錄',
    screen: (
      <div>
        <MockTable headers={['時間', '使用者', '操作', '變更']} rows={[
          ['16:32', '王小明', '修改客戶資料', '電話 0912→0933'],
          ['15:10', '李美玲', '新增採購單', 'PO-2026-0415'],
          ['14:45', '張大偉', '核准假單', 'LV-2026-089 → 已核准'],
          ['13:20', '系統', '自動拋帳', 'AR-2026-0857 已建立'],
        ]} />
      </div>
    ),
  },
  {
    title: '自動觸發器',
    desc: '設定事件驅動或排程觸發的自動化規則，如庫存低於安全量時自動通知採購。',
    screenTitle: '系統 / 觸發器',
    screen: (
      <div>
        <MockTable headers={['觸發器', '條件', '動作', '狀態']} rows={[
          ['低庫存通知', '庫存 ≤ 安全量', 'LINE 通知採購人員', <MockBadge color="#059669">啟用</MockBadge>],
          ['逾期帳款提醒', '超過 60 天未收', 'Email 通知業務', <MockBadge color="#059669">啟用</MockBadge>],
          ['排班檢核', '每日 00:00', '檢查次週排班合規', <MockBadge color="#059669">啟用</MockBadge>],
          ['月結報表', '每月 1 日', '產生上月損益表', <MockBadge color="#94a3b8">停用</MockBadge>],
        ]} />
      </div>
    ),
  },
]
