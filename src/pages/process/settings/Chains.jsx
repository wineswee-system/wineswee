import { useState } from 'react'
import { Workflow, ArrowLeft } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import ChainConfigModal from '../../../components/ChainConfigModal'
import { useNavigate } from 'react-router-dom'

export default function Chains() {
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
        <p style={{ color: 'var(--text-secondary)' }}>僅 admin / super_admin 可管理簽核鏈</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Workflow size={18} /></span> 簽核鏈設定</h2>
            <p>整個組織的簽核鏈池子 — 流程、任務、HR 表單共用同一個 pool。同一條 chain 可被多處引用。</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ fontSize: 13 }}>
            <ArrowLeft size={14} /> 返回
          </button>
        </div>
      </div>

      <ChainConfigModal
        open={modalOpen}
        onClose={handleClose}
        formLabel="簽核鏈"
        organizationId={profile?.organization_id}
        mode="library"
      />
    </div>
  )
}
