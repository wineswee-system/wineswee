import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'

// 全 chain library 管理：卡片式列出整 org 所有 chain，可新增 / 編輯 / 刪除
// UI 由 ChainConfigModal mode="library" + embedded 提供（跟 ExpenseChains 同套）
export default function Chains() {
  const { profile, role, hasPermission } = useAuth()
  // 修：AuthContext 沒提供 isAdmin（原本 undefined → 只有 super_admin 進得去、admin 被誤擋）
  const canEditChain = role?.name === 'admin' || role?.name === 'super_admin' || hasPermission('approval_chain.edit')

  if (!canEditChain) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-red)' }}>無權限</h3>
        <p style={{ color: 'var(--text-secondary)' }}>僅 admin / super_admin 或具「簽核鏈設定」權限者可管理簽核鏈</p>
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
