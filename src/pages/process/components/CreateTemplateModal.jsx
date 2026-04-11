import { Plus, Trash2 } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'

export default function CreateTemplateModal({
  newTpl, setNewTpl, onClose, onSubmit,
}) {
  const addTplStep = () => setNewTpl(t => ({ ...t, steps: [...t.steps, { title: '', role: '', priority: '中', description: '' }] }))
  const updateTplStep = (i, k, v) => setNewTpl(t => ({ ...t, steps: t.steps.map((s, j) => j === i ? { ...s, [k]: v } : s) }))
  const removeTplStep = (i) => setNewTpl(t => ({ ...t, steps: t.steps.filter((_, j) => j !== i) }))

  return (
    <Modal title="新增流程範本" onClose={onClose} onSubmit={onSubmit} submitLabel="建立範本">
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Field label="範本名稱 *">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：新店開幕 SOP"
            value={newTpl.name} onChange={e => setNewTpl(t => ({ ...t, name: e.target.value }))} />
        </Field>
        <Field label="分類">
          <select className="form-input" style={{ width: '100%' }} value={newTpl.category} onChange={e => setNewTpl(t => ({ ...t, category: e.target.value }))}>
            {['HR', '營運', '採購', '展店', '倉管', '財務', '行銷', '客服'].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label="說明">
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="範本說明"
          value={newTpl.description} onChange={e => setNewTpl(t => ({ ...t, description: e.target.value }))} />
      </Field>

      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '12px 0 8px' }}>步驟</div>
      {newTpl.steps.map((step, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'end',
          marginBottom: 8, padding: '10px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
        }}>
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
      ))}
      <button onClick={addTplStep} style={{
        width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed var(--border-medium)',
        background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
      }}><Plus size={12} /> 新增步驟</button>
    </Modal>
  )
}
