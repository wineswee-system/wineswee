import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'

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

  // 即使 profile.organization_id 是 null，也讓 modal 渲染（loadOptions 內已有 guard）
  // 避免整頁變空白，讓使用者至少看到「沒資料」訊息
  return (
    <>
      {!profile?.organization_id && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', fontSize: 13, marginBottom: 16 }}>
          ⚠️ 載入中… 若持續未顯示，請確認你的員工資料有設 organization_id（找 super_admin 處理）
        </div>
      )}
      <ChainConfigModal
        open
        onClose={() => {}}
        formLabel="簽核鏈"
        organizationId={profile?.organization_id || null}
        mode="library"
        embedded
      />
    </>
  )
}
