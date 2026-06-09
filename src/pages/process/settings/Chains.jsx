import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'
import LoadingSpinner from '../../../components/LoadingSpinner'

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

  // profile 還沒載完前不 render modal — 避免 organizationId=undefined 觸發 query 卡死
  if (!profile?.organization_id) return <LoadingSpinner />

  return (
    <ChainConfigModal
      open
      onClose={() => {}}
      formLabel="簽核鏈"
      organizationId={profile.organization_id}
      mode="library"
      embedded
    />
  )
}
