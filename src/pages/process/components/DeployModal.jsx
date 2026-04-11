import { Rocket } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'

export default function DeployModal({
  deployTemplate, deployForm, setDeployForm, deployResult, deploying,
  stores, employees, departments,
  onDeploy, onClose,
}) {
  return (
    <Modal title={`🚀 部署「${deployTemplate.name}」`} onClose={onClose}
      onSubmit={deployResult ? onClose : onDeploy}
      submitLabel={deployResult ? '完成' : deploying ? '部署中...' : '確認部署'}>
      {deployResult ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>部署成功！</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            已為 <strong>{deployResult.location}</strong> 建立 <strong>{deployResult.count}</strong> 個任務
          </div>
        </div>
      ) : (
        <>
          <Field label="部署到哪個分店 *">
            <select className="form-input" style={{ width: '100%' }} value={deployForm.location} onChange={e => setDeployForm(f => ({ ...f, location: e.target.value }))}>
              <option value="">請選擇分店</option>
              {stores.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
          </Field>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '16px 0 10px' }}>指派負責人</div>
          {(deployTemplate.steps || []).map((step, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', marginBottom: 6, border: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Step {i + 1}：{step.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>角色：{step.role || '-'}</div>
              </div>
              <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={deployForm.assignees[i] || ''}
                onChange={e => setDeployForm(f => ({ ...f, assignees: { ...f.assignees, [i]: e.target.value } }))}>
                <option value="">請選擇</option>
                {departments.map(d => (
                  <optgroup key={d.id} label={d.name}>
                    {employees.filter(e => e.dept === d.name).map(e => <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
        </>
      )}
    </Modal>
  )
}
