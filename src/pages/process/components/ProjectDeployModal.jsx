import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'

export default function ProjectDeployModal({
  deployTpl,
  deployForm,
  setDeployForm,
  deploying,
  employees,
  stores,
  onClose,
  onSubmit,
}) {
  if (!deployTpl) return null

  const tplWorkflows = Array.isArray(deployTpl.workflows)
    ? deployTpl.workflows
    : JSON.parse(deployTpl.workflows || '[]')

  return (
    <Modal
      title={`部署專案 — ${deployTpl.name}`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={deploying ? '部署中...' : '🚀 部署'}
    >
      <Field label="專案名稱" required>
        <input
          className="form-input" style={{ width: '100%' }}
          value={deployForm.name}
          onChange={e => setDeployForm(f => ({ ...f, name: e.target.value }))}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="負責人">
          <SearchableSelect
            value={deployForm.owner}
            onChange={(v) => setDeployForm(f => ({ ...f, owner: v || '' }))}
            options={empOptions(employees, { keyBy: 'name' })}
            placeholder="搜尋負責人..."
          />
        </Field>
        <Field label="門市">
          <select className="form-input" style={{ width: '100%' }} value={deployForm.store} onChange={e => setDeployForm(f => ({ ...f, store: e.target.value }))}>
            <option value="">不指定</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ background: 'var(--glass-light)', borderRadius: 8, padding: 12, fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>將自動建立：</div>
        {tplWorkflows.map((w, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <span style={{ color: 'var(--accent-cyan)' }}>📂 {w.name}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({w.tasks?.length || 0} 任務)</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
