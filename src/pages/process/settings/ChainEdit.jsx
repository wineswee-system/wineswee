import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'

// 各表單頁右上「⚙ 簽核設定」按鈕點下去會 navigate 到這裡（取代原本的 modal）
// URL 範例：/process/settings/chains/edit?formType=expense&label=費用報銷&mode=single
export default function ChainEdit() {
  const { profile, role, hasPermission } = useAuth()
  // 修：AuthContext 沒提供 isAdmin（原本 undefined → admin 被誤擋，只有 super_admin 進得去）
  const canEditChain = role?.name === 'admin' || role?.name === 'super_admin' || hasPermission('approval_chain.edit')
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const formType = params.get('formType') || ''
  const formLabel = params.get('label') || '簽核流程'
  const mode = params.get('mode') || 'single'

  // 只有 single 模式才顯示申請人類型分頁
  const showTypeTabs = mode === 'single'
  const [activeType, setActiveType] = useState('all')

  const TABS = [
    { key: 'all',         label: '全員通用', desc: '未設定其他專屬鏈時的 fallback' },
    { key: 'manager',     label: '部門主管', desc: '申請人為 departments.manager_id 或 stores.manager_id（店長/資深店長也算）時套用' },
    { key: 'store_staff', label: '門市人員', desc: '有門市歸屬（store_id IS NOT NULL）且非店長的員工套用' },
    { key: 'staff',       label: '行政人員', desc: '沒有門市歸屬、也非主管的總部/行政員工套用' },
  ]

  if (!canEditChain) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-red)' }}>無權限</h3>
        <p style={{ color: 'var(--text-secondary)' }}>僅 admin / super_admin 或具「簽核鏈設定」權限者可設定簽核鏈</p>
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

      {showTypeTabs && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
            可依申請人角色設定不同簽核鏈。送出時系統依序套用「部門主管」→「門市人員」→「行政人員」；找不到時 fallback 至「全員通用」。
          </div>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 0 }}>
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveType(t.key)}
                style={{
                  padding: '8px 18px', border: 'none', cursor: 'pointer',
                  background: 'transparent', borderRadius: '6px 6px 0 0',
                  fontSize: 14, fontWeight: activeType === t.key ? 700 : 400,
                  color: activeType === t.key ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  borderBottom: activeType === t.key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                  transition: 'color .15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 4px 0' }}>
            {TABS.find(t => t.key === activeType)?.desc}
          </div>
        </div>
      )}

      <ChainConfigModal
        key={activeType}
        open
        onClose={() => {}}
        formType={formType}
        formLabel={formLabel}
        organizationId={profile?.organization_id}
        mode={mode}
        applicantType={activeType}
        embedded
      />
    </div>
  )
}
