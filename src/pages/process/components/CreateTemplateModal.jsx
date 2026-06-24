import { Plus, Trash2, CheckSquare, Shield, Settings, FileText } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import BoundFormsField from '../../../components/tasks/BoundFormsField'

export default function CreateTemplateModal({
  newTpl, setNewTpl, onClose, onSubmit,
  checklists = [], approvalChains = [],
  categories = [], onManageCategories,
  employees = [],
  isEdit = false,
}) {
  const addTplStep = () => setNewTpl(t => ({
    ...t,
    steps: [...t.steps, { title: '', role: '', priority: '中', description: '', checklist_id: '', approval_chain_id: '', required_forms: [] }],
  }))
  const updateTplStep = (i, k, v) => setNewTpl(t => ({ ...t, steps: t.steps.map((s, j) => j === i ? { ...s, [k]: v } : s) }))
  const removeTplStep = (i) => setNewTpl(t => ({ ...t, steps: t.steps.filter((_, j) => j !== i) }))

  return (
    <Modal title={isEdit ? '編輯流程範本' : '新增流程範本'} onClose={onClose} onSubmit={onSubmit} submitLabel={isEdit ? '儲存變更' : '建立範本'}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Field label="範本名稱" required>
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：新店開幕 SOP"
            value={newTpl.name} onChange={e => setNewTpl(t => ({ ...t, name: e.target.value }))} />
        </Field>
        <Field label={
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>分類</span>
            {onManageCategories && (
              <button type="button" onClick={onManageCategories} style={{
                background: 'none', border: 'none', color: 'var(--accent-cyan)',
                fontSize: 11, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 2,
              }}>
                <Settings size={11} /> 管理
              </button>
            )}
          </span>
        }>
          <select className="form-input" style={{ width: '100%' }} value={newTpl.category} onChange={e => setNewTpl(t => ({ ...t, category: e.target.value }))}>
            {(categories.length > 0
              ? categories.map(c => c.name)
              : ['HR', '營運', '採購', '展店', '倉管', '財務', '行銷', '客服']
            ).map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label="說明">
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="範本說明"
          value={newTpl.description} onChange={e => setNewTpl(t => ({ ...t, description: e.target.value }))} />
      </Field>

      {/* 簽核鏈（流程結束後的簽核） */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
        <Field label={<><Shield size={12} style={{ marginRight: 4, color: 'var(--accent-purple)' }} />流程完成後的簽核鏈（選填）</>}>
          <select className="form-input" style={{ width: '100%' }}
            value={newTpl.approval_chain_id || ''}
            onChange={e => setNewTpl(t => ({ ...t, approval_chain_id: e.target.value ? Number(e.target.value) : '' }))}>
            <option value="">不需要簽核</option>
            {approvalChains.map(c => (
              <option key={c.id} value={c.id}>{c.name} — {(c.steps || []).length} 關</option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '16px 0 8px' }}>步驟</div>
      {newTpl.steps.map((step, i) => (
        <div key={i} style={{
          marginBottom: 8, padding: '10px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <Field label={`Step ${i + 1} 名稱`}>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="步驟名稱"
                value={step.title} onChange={e => updateTplStep(i, 'title', e.target.value)} />
            </Field>
            <Field label="角色">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="主管"
                value={step.role} onChange={e => updateTplStep(i, 'role', e.target.value)} />
            </Field>
            <Field label="優先度">
              <select className="form-input" style={{ width: '100%' }} value={step.priority} onChange={e => updateTplStep(i, 'priority', e.target.value)}>
                <option>高</option><option>中</option><option>低</option>
              </select>
            </Field>
            <button onClick={() => removeTplStep(i)} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '8px' }}>
              <Trash2 size={14} />
            </button>
          </div>
          {/* 掛查核清單 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <Field label={<><CheckSquare size={11} style={{ marginRight: 4, color: 'var(--accent-green)' }} />掛查核清單</>}>
              <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                value={step.checklist_id || ''}
                onChange={e => updateTplStep(i, 'checklist_id', e.target.value ? Number(e.target.value) : '')}>
                <option value="">無</option>
                {checklists.map(cl => (
                  <option key={cl.id} value={cl.id}>{cl.name} ({cl.items || 0} 項)</option>
                ))}
              </select>
            </Field>
            <Field label={<><Shield size={11} style={{ marginRight: 4, color: 'var(--accent-purple)' }} />需要簽核</>}>
              <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                value={step.approval_chain_id || ''}
                onChange={e => updateTplStep(i, 'approval_chain_id', e.target.value ? Number(e.target.value) : '')}>
                <option value="">不需要</option>
                {approvalChains.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          </div>
          {/* 綁定表單 — 完成 step 前需填完 */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <FileText size={11} style={{ color: 'var(--accent-cyan)' }} />
              綁定表單（完成此 step 前需填完）
            </div>
            <BoundFormsField
              value={step.required_forms || []}
              onChange={(next) => updateTplStep(i, 'required_forms', next)}
              employees={employees}
              templateMode
            />
          </div>
        </div>
      ))}
      <button onClick={addTplStep} style={{
        width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed var(--border-medium)',
        background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
      }}><Plus size={12} /> 新增步驟</button>
    </Modal>
  )
}
