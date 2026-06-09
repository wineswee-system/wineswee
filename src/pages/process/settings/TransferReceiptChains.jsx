import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'

// 商品調撥「驗收」chain 設定頁
// category='商品調撥-驗收' 的 chain 才會顯示
export default function TransferReceiptChains() {
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
      formLabel="商品調撥-驗收"
      organizationId={profile?.organization_id || null}
      mode="library"
      categoryFilter="商品調撥-驗收"
      embedded
    />
  )
}
