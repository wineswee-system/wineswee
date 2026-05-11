import { useState } from 'react'
import { DollarSign, ArrowLeft } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'
import { useNavigate } from 'react-router-dom'

export default function ExpenseChains() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const [modalOpen, setModalOpen] = useState(true)

  const handleClose = () => {
    setModalOpen(false)
    navigate('/process/overview')
  }

  if (!(isAdmin || isSuperAdmin)) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-red)' }}>無權限</h3>
        <p style={{ color: 'var(--text-secondary)' }}>僅 admin / super_admin 可管理費用簽核設定</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><DollarSign size={18} /></span> 費用簽核設定</h2>
            <p>申請費用依金額自動分流到不同的簽核鏈。可設定多組金額區間，系統會自動套用對應的 chain。</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ fontSize: 13 }}>
            <ArrowLeft size={14} /> 返回
          </button>
        </div>
      </div>

      <ChainConfigModal
        open={modalOpen}
        onClose={handleClose}
        formType="expense_request"
        formLabel="申請費用"
        organizationId={profile?.organization_id}
        mode="amount_grouped"
      />
    </div>
  )
}
