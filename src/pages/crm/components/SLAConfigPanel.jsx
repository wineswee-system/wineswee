import { useState } from 'react'
import { Plus, Shield, Edit3, Trash2 } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import { createSLAPolicy, updateSLAPolicy, deleteSLAPolicy } from '../../../lib/db'
import { SLA_POLICIES } from '../../../lib/crmEngine'
import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'

const PRIORITIES = ['緊急', '高', '一般', '低']

const emptySlaForm = { name: '', priority: '一般', response_hours: 24, resolution_hours: 72, is_default: false }

/**
 * SLAConfigPanel — SLA policy management section (list/add/edit/delete).
 *
 * Props:
 *   policies   array                   current custom SLA policies
 *   onUpdate   (updatedList) => void   called after any create/update/delete
 *   onClose    () => void
 */
export default function SLAConfigPanel({ policies, onUpdate, onClose }) {
  const [showSLAForm, setShowSLAForm] = useState(false)
  const [slaForm, setSlaForm] = useState(emptySlaForm)
  const [editingSLAId, setEditingSLAId] = useState(null)

  const handleSLASave = async () => {
    try {
      if (editingSLAId) {
        const { data, error } = await updateSLAPolicy(editingSLAId, slaForm)
        if (error) throw error
        onUpdate(policies.map(s => s.id === editingSLAId ? data : s))
      } else {
        const { data, error } = await createSLAPolicy(slaForm)
        if (error) throw error
        onUpdate([...policies, data])
      }
      setShowSLAForm(false)
      setEditingSLAId(null)
      setSlaForm(emptySlaForm)
    } catch (err) {
      toast.error('SLA 儲存失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleSLAEdit = (sla) => {
    setSlaForm({ name: sla.name, priority: sla.priority, response_hours: sla.response_hours, resolution_hours: sla.resolution_hours, is_default: sla.is_default })
    setEditingSLAId(sla.id)
    setShowSLAForm(true)
  }

  const handleSLADelete = async (id) => {
    if (!(await confirm({ message: '確定要刪除此 SLA 政策？' }))) return
    await deleteSLAPolicy(id)
    onUpdate(policies.filter(s => s.id !== id))
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Shield size={16} /></span> SLA 服務水準政策</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => { setSlaForm(emptySlaForm); setEditingSLAId(null); setShowSLAForm(true) }}
            >
              <Plus size={12} /> 新增政策
            </button>
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18 }}
              onClick={onClose}
            >✕</button>
          </div>
        </div>

        {/* Custom SLAs */}
        {policies.length > 0 && (
          <>
            <div style={{ padding: '8px 16px 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>自訂政策</div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>名稱</th><th>優先度</th><th>回應時限</th><th>解決時限</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {policies.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>
                        <span className={`badge ${p.priority === '緊急' ? 'badge-danger' : p.priority === '高' ? 'badge-warning' : 'badge-neutral'}`}>
                          <span className="badge-dot"></span>{p.priority}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{p.response_hours} 小時</td>
                      <td style={{ fontWeight: 600 }}>{p.resolution_hours} 小時</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => handleSLAEdit(p)}><Edit3 size={12} /></button>
                          <button className="btn btn-sm" style={{ color: 'var(--accent-red)' }} onClick={() => handleSLADelete(p.id)}><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Default SLAs */}
        <div style={{ padding: '8px 16px 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>預設政策</div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>優先度</th><th>回應時限</th><th>解決時限</th><th>說明</th></tr>
            </thead>
            <tbody>
              {SLA_POLICIES.map(p => (
                <tr key={p.priority}>
                  <td>
                    <span className={`badge ${p.priority === '緊急' ? 'badge-danger' : p.priority === '高' ? 'badge-warning' : 'badge-neutral'}`}>
                      <span className="badge-dot"></span>{p.priority}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.response_hours} 小時</td>
                  <td style={{ fontWeight: 600 }}>{p.resolution_hours} 小時</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{p.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SLA Form Modal */}
      {showSLAForm && (
        <Modal
          title={editingSLAId ? '編輯 SLA 政策' : '新增 SLA 政策'}
          onClose={() => { setShowSLAForm(false); setEditingSLAId(null) }}
          onSubmit={handleSLASave}
        >
          <Field label="政策名稱" required>
            <input
              className="form-input"
              style={{ width: '100%' }}
              value={slaForm.name}
              onChange={e => setSlaForm(f => ({ ...f, name: e.target.value }))}
              placeholder="例：VIP 客戶 SLA"
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="適用優先度">
              <select className="form-input" style={{ width: '100%' }} value={slaForm.priority} onChange={e => setSlaForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="回應時限 (小時)">
              <input className="form-input" type="number" style={{ width: '100%' }} value={slaForm.response_hours} onChange={e => setSlaForm(f => ({ ...f, response_hours: Number(e.target.value) }))} />
            </Field>
            <Field label="解決時限 (小時)">
              <input className="form-input" type="number" style={{ width: '100%' }} value={slaForm.resolution_hours} onChange={e => setSlaForm(f => ({ ...f, resolution_hours: Number(e.target.value) }))} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
