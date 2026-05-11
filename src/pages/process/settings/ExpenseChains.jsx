import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'

export default function ExpenseChains() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()

  if (!(isAdmin || isSuperAdmin)) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-red)' }}>無權限</h3>
        <p style={{ color: 'var(--text-secondary)' }}>僅 admin / super_admin 可管理費用簽核設定</p>
      </div>
    )
  }

  return (
    <ChainConfigModal
      open
      onClose={() => {}}
      formType="expense_request"
      formLabel="申請費用"
      organizationId={profile?.organization_id}
      mode="amount_grouped"
      embedded
    />
  )
}
