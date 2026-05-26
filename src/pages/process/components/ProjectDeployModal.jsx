import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckSquare, Workflow } from 'lucide-react'
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
  const [expandedWfs, setExpandedWfs] = useState(new Set([0]))

  if (!deployTpl) return null

  const toggleWf = (i) => setExpandedWfs(prev => {
    const next = new Set(prev)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })

  const setWf = (wi, k, v) => setDeployForm(f => ({
    ...f,
    workflows: (f.workflows || []).map((w, i) => i === wi ? { ...w, [k]: v } : w),
  }))

  const setTask = (wi, ti, k, v) => setDeployForm(f => ({
    ...f,
    workflows: (f.workflows || []).map((w, i) =>
      i === wi
        ? { ...w, tasks: w.tasks.map((t, j) => j === ti ? { ...t, [k]: v } : t) }
        : w
    ),
  }))

  const workflows = deployForm.workflows || []

  return (
    <Modal
      title={`🚀 部署專案 — ${deployTpl.name}`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={deploying ? '部署中...' : '🚀 部署'}
      submitDisabled={deploying || !deployForm.name?.trim()}
    >
      {/* ── 專案基本資訊 ── */}
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
            onChange={v => setDeployForm(f => ({ ...f, owner: v || '' }))}
            options={empOptions(employees, { keyBy: 'name' })}
            placeholder="搜尋負責人..."
          />
        </Field>
        <Field label="門市">
          <select className="form-input" style={{ width: '100%' }}
            value={deployForm.store}
            onChange={e => setDeployForm(f => ({ ...f, store: e.target.value }))}>
            <option value="">不指定</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="開始日期">
          <input type="date" className="form-input" style={{ width: '100%' }}
            value={deployForm.start_date || ''}
            onChange={e => setDeployForm(f => ({ ...f, start_date: e.target.value }))} />
        </Field>
        <Field label="結束日期">
          <input type="date" className="form-input" style={{ width: '100%' }}
            value={deployForm.end_date || ''}
            onChange={e => setDeployForm(f => ({ ...f, end_date: e.target.value }))} />
        </Field>
      </div>

      {/* ── 流程 & 任務自訂 ── */}
      {workflows.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, marginTop: 4 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
            marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Workflow size={14} /> 流程 &amp; 任務自訂
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
              （覆寫各流程 / 任務的負責人、門市、日期）
            </span>
          </div>

          {workflows.map((wf, wi) => (
            <div key={wi} style={{
              marginBottom: 10, borderRadius: 10,
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              overflow: 'hidden',
            }}>
              {/* ── workflow header (click to expand) ── */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 12px', cursor: 'pointer',
                  background: 'var(--glass-light)',
                }}
                onClick={() => toggleWf(wi)}
              >
                {expandedWfs.has(wi)
                  ? <ChevronDown size={13} style={{ flexShrink: 0 }} />
                  : <ChevronRight size={13} style={{ flexShrink: 0 }} />}
                <input
                  className="form-input"
                  style={{ flex: 1, fontWeight: 600, fontSize: 13 }}
                  value={wf.name}
                  onClick={e => e.stopPropagation()}
                  onChange={e => setWf(wi, 'name', e.target.value)}
                  placeholder={`流程 ${wi + 1}`}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {wf.tasks?.length || 0} 任務
                </span>
              </div>

              {/* ── expanded: workflow-level overrides + task list ── */}
              {expandedWfs.has(wi) && (
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <Field label="負責人（此流程）">
                      <SearchableSelect
                        value={wf.owner || ''}
                        onChange={v => setWf(wi, 'owner', v || '')}
                        options={empOptions(employees, { keyBy: 'name' })}
                        placeholder="繼承專案負責人..."
                      />
                    </Field>
                    <Field label="門市（此流程）">
                      <select className="form-input" style={{ width: '100%' }}
                        value={wf.store || ''}
                        onChange={e => setWf(wi, 'store', e.target.value)}>
                        <option value="">繼承專案門市</option>
                        {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                    </Field>
                    <Field label="截止日期">
                      <input type="date" className="form-input" style={{ width: '100%' }}
                        value={wf.due_date || ''}
                        onChange={e => setWf(wi, 'due_date', e.target.value)} />
                    </Field>
                  </div>

                  {/* task rows */}
                  {(wf.tasks || []).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                        gap: 6, fontSize: 11, color: 'var(--text-muted)',
                        padding: '0 8px', marginBottom: 2,
                      }}>
                        <span>任務</span>
                        <span>負責人</span>
                        <span>截止日期</span>
                      </div>
                      {wf.tasks.map((task, ti) => (
                        <div key={ti} style={{
                          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                          gap: 6, alignItems: 'center',
                          padding: '6px 8px', borderRadius: 6,
                          background: 'var(--bg-secondary)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                            <CheckSquare size={11} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                            <span style={{
                              fontSize: 12, fontWeight: 500,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {task.title}
                            </span>
                          </div>
                          <SearchableSelect
                            value={task.assignee || ''}
                            onChange={v => setTask(wi, ti, 'assignee', v || '')}
                            options={empOptions(employees, { keyBy: 'name' })}
                            placeholder="繼承流程負責人..."
                          />
                          <input type="date" className="form-input" style={{ fontSize: 11 }}
                            value={task.due_date || ''}
                            onChange={e => setTask(wi, ti, 'due_date', e.target.value)} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
