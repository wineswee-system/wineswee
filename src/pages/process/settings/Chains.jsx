import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'

// 全 chain library 管理：卡片式列出整 org 所有 chain，可新增 / 編輯 / 刪除
// UI 由 ChainConfigModal mode="library" + embedded 提供（跟 ExpenseChains 同套）
export default function Chains() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()

  if (!(isAdmin || isSuperAdmin)) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-red)' }}>無權限</h3>
        <p style={{ color: 'var(--text-secondary)' }}>僅 admin / super_admin 可管理簽核鏈</p>
      </div>
    )
  }

  return (
    <ChainConfigModal
      open
      onClose={() => {}}
      formLabel="簽核鏈"
      organizationId={profile?.organization_id || null}
      mode="library"
      embedded
    />
  )
}
