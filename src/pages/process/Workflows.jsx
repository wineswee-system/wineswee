import { useState, useEffect } from 'react'
import { Plus, Play, Pause, Pencil, Trash2, ChevronDown, ChevronRight, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import { getWorkflows, createWorkflow, updateWorkflow } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const CATEGORIES = ['HR', '營運', '採購', '展店', '倉管', '財務', '行銷']

export default function Workflows() {
  const [tab, setTab] = useState('instances') // instances | definitions
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [steps, setSteps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', category: CATEGORIES[0], steps: '', description: '' })

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      supabase.from('workflow_instances').select('*').order('started_at', { ascending: false }),
      supabase.from('workflow_steps').select('*').order('instance_id,step_order'),
    ]).then(([w, inst, st]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
    }).catch(err => {
      console.error('Failed to load:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name) return
    const { data } = await createWorkflow({
      name: form.name, category: form.category,
      steps: Number(form.steps) || 1, description: form.description,
      status: '已啟用', active_instances: 0,
    })
    if (data) {
      setWorkflows(prev => [...prev, data])
      setShowModal(false)
      setForm({ name: '', category: CATEGORIES[0], steps: '', description: '' })
    }
  }

  const handleStepToggle = async (stepId, currentStatus) => {
    const newStatus = currentStatus === '已完成' ? '待處理' : '已完成'
    const completedAt = newStatus === '已完成' ? new Date().toISOString() : null
    const { data } = await supabase.from('workflow_steps').update({ status: newStatus, completed_at: completedAt }).eq('id', stepId).select().single()
    if (data) {
      setSteps(prev => prev.map(s => s.id === stepId ? data : s))
      // Check if all steps completed
      const instId = data.instance_id
      const instSteps = steps.map(s => s.id === stepId ? data : s).filter(s => s.instance_id === instId)
      const allDone = instSteps.every(s => s.status === '已完成')
      if (allDone) {
        const { data: inst } = await supabase.from('workflow_instances').update({ status: '已完成', completed_at: new Date().toISOString() }).eq('id', instId).select().single()
        if (inst) setInstances(prev => prev.map(i => i.id === instId ? inst : i))
      }
    }
  }

  const getInstanceSteps = (instId) => steps.filter(s => s.instance_id === instId).sort((a, b) => a.step_order - b.step_order)
  const getProgress = (instId) => {
    const instSteps = getInstanceSteps(instId)
    if (instSteps.length === 0) return 0
    return Math.round(instSteps.filter(s => s.status === '已完成').length / instSteps.length * 100)
  }

  const runningCount = instances.filter(i => i.status === '進行中').length
  const completedCount = instances.filter(i => i.status === '已完成').length

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 流程</h2>
            <p>標準作業流程設計與管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增流程</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已啟用流程</div>
          <div className="stat-card-value">{workflows.filter(w => w.status === '已啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">執行中實例</div>
          <div className="stat-card-value">{runningCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">草稿</div>
          <div className="stat-card-value">{workflows.filter(w => w.status === '草稿').length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        {[
          { key: 'instances', label: `執行中 (${runningCount})` },
          { key: 'completed', label: `已完成 (${completedCount})` },
          { key: 'definitions', label: `流程定義 (${workflows.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '10px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══ Instances Tab ══ */}
      {(tab === 'instances' || tab === 'completed') && (
        <div>
          {instances.filter(i => tab === 'instances' ? i.status === '進行中' : i.status === '已完成').length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              {tab === 'instances' ? '目前沒有執行中的流程。從 SOP 範本部署即可建立。' : '尚無已完成的流程。'}
            </div>
          ) : instances.filter(i => tab === 'instances' ? i.status === '進行中' : i.status === '已完成').map(inst => {
            const progress = getProgress(inst.id)
            const instSteps = getInstanceSteps(inst.id)
            const isExpanded = expanded === inst.id
            return (
              <div key={inst.id} className="card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => setExpanded(isExpanded ? null : inst.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.template_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        🏪 {inst.store || '未指定'} · 啟動：{inst.started_at?.slice(0, 10)}
                        {inst.completed_at && ` · 完成：${inst.completed_at.slice(0, 10)}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: progress === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)' }}>{progress}%</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{instSteps.filter(s => s.status === '已完成').length}/{instSteps.length} 步</div>
                    </div>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: `conic-gradient(${progress === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)'} ${progress * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                        {progress === 100 ? '✅' : `${progress}%`}
                      </div>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 16, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }} onClick={e => e.stopPropagation()}>
                    {instSteps.map((step, i) => (
                      <div key={step.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 12px', borderRadius: 8, marginBottom: 4,
                        background: step.status === '已完成' ? 'var(--accent-green-dim)' : 'var(--glass-light)',
                        border: `1px solid ${step.status === '已完成' ? 'rgba(52,211,153,0.2)' : 'var(--border-subtle)'}`,
                      }}>
                        <button onClick={() => handleStepToggle(step.id, step.status)} style={{
                          width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
                          background: step.status === '已完成' ? 'var(--accent-green)' : 'var(--border-medium)',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          {step.status === '已完成' ? <CheckCircle size={16} /> : <span style={{ fontSize: 12, fontWeight: 700 }}>{step.step_order}</span>}
                        </button>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, textDecoration: step.status === '已完成' ? 'line-through' : 'none', color: step.status === '已完成' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                            {step.title}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {step.role && <span>👤 {step.role}</span>}
                            {step.assignee && <span style={{ marginLeft: 8 }}>→ {step.assignee}</span>}
                            {step.description && <span style={{ marginLeft: 8 }}>{step.description}</span>}
                          </div>
                        </div>
                        {step.status === '已完成' && step.completed_at && (
                          <span style={{ fontSize: 10, color: 'var(--accent-green)', whiteSpace: 'nowrap' }}>✓ {step.completed_at.slice(0, 10)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ══ Definitions Tab ══ */}
      {tab === 'definitions' && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>流程名稱</th><th>分類</th><th>步驟數</th><th>說明</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>
                {workflows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無流程定義</td></tr>}
                {workflows.map(w => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600 }}>{w.name}</td>
                    <td><span className="badge badge-cyan">{w.category}</span></td>
                    <td>{w.steps}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12, maxWidth: 300 }}>{w.description}</td>
                    <td>
                      <span className={`badge ${w.status === '已啟用' ? 'badge-success' : w.status === '已停用' ? 'badge-danger' : 'badge-warning'}`}>
                        <span className="badge-dot"></span>{w.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" onClick={async () => {
                          const newStatus = w.status === '已啟用' ? '已停用' : '已啟用'
                          const { data } = await updateWorkflow(w.id, { status: newStatus })
                          if (data) setWorkflows(prev => prev.map(x => x.id === w.id ? data : x))
                        }}>{w.status === '已啟用' ? <Pause size={12} /> : <Play size={12} />}</button>
                        <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-red)' }} onClick={async () => {
                          if (!confirm('確定刪除？')) return
                          await supabase.from('workflows').delete().eq('id', w.id)
                          setWorkflows(prev => prev.filter(x => x.id !== w.id))
                        }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <Modal title="新增流程" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="流程名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：請假審批流程" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="步驟數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="1" min="1" value={form.steps} onChange={e => set('steps', e.target.value)} />
            </Field>
          </div>
          <Field label="說明">
            <textarea className="form-input" style={{ width: '100%', resize: 'vertical' }} rows={3} placeholder="流程說明" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
