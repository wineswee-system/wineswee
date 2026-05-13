import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'

// 各表單頁右上「⚙ 簽核設定」按鈕點下去會 navigate 到這裡（取代原本的 modal）
// URL 範例：/process/settings/chains/edit?formType=expense&label=費用報銷&mode=single
export default function ChainEdit() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const formType = params.get('formType') || ''
  const formLabel = params.get('label') || '簽核流程'
  const mode = params.get('mode') || 'single'

  if (!(isAdmin || isSuperAdmin)) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-red)' }}>無權限</h3>
        <p style={{ color: 'var(--text-secondary)' }}>僅 admin / super_admin 可設定簽核鏈</p>
      </div>
    )
  }

  if (!formType) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-orange)' }}>缺少參數</h3>
        <p style={{ color: 'var(--text-secondary)' }}>未指定 formType，請從表單頁的「⚙ 簽核設定」進入</p>
        <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginTop: 16 }}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
      <ChainConfigModal
        open
        onClose={() => navigate(-1)}
        formType={formType}
        formLabel={formLabel}
        organizationId={profile?.organization_id}
        mode={mode}
        embedded
      />
    </div>
  )
}
