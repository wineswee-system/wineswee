import { Plus, Rocket } from 'lucide-react'

export default function TemplatesList({ templates, onDeploy, onCreateNew }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <button className="btn btn-primary" onClick={onCreateNew}><Plus size={13} /> 新增流程範本</button>
      </div>
      {templates.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無流程範本</div>
      ) : templates.map(tpl => {
        const tplSteps = tpl.steps || []
        return (
          <div key={tpl.id} className="card" style={{ padding: 0 }}>
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{tpl.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  <span className="badge badge-cyan" style={{ marginRight: 8 }}>{tpl.category}</span>
                  {tplSteps.length} 個步驟 · {tpl.description || ''}
                </div>
              </div>
              <button className="btn btn-sm btn-primary" style={{ padding: '6px 14px' }} onClick={() => onDeploy(tpl)}>
                <Rocket size={13} /> 部署
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
