import { useState } from 'react'
import { Plus, Trash2, Workflow, CheckSquare, GripVertical, GitBranch, ArrowDown } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'

const CATEGORIES = ['展店', 'HR', '營運', '採購', '倉管', '財務', '行銷', '客服']
const PRIORITY_OPTIONS = ['高', '中', '低']

const TASK_TRIGGERS = [
  { value: 'auto',   label: '前一任務完成後自動' },
  { value: 'manual', label: '手動啟動' },
]
const WF_TRIGGERS = [
  { value: 'manual',              label: '手動啟動' },
  { value: 'on_prev_wf_complete', label: '前一流程全部完成後' },
]

const emptyTask = () => ({ title: '', role: '', priority: '中', trigger: 'auto', delay_days: '' })
const emptyWorkflow = () => ({ name: '', trigger: 'manual', delay_days: '', tasks: [emptyTask()] })

/** 深複製一份 template 供編輯用 */
function cloneTpl(tpl) {
  const workflows = Array.isArray(tpl.workflows)
    ? tpl.workflows
    : JSON.parse(tpl.workflows || '[]')
  return {
    name:             tpl.name || '',
    category:         tpl.category || '展店',
    description:      tpl.description || '',
    estimated_days:   tpl.estimated_days ?? '',
    estimated_budget: tpl.estimated_budget ?? '',
    default_priority: tpl.default_priority || '中',
    workflows: workflows.map(w => ({
      name:       w.name       || '',
      trigger:    w.trigger    || 'manual',
      delay_days: w.delay_days ?? '',
      tasks: (w.tasks || []).map(t => ({
        title:      t.title      || '',
        role:       t.role       || '',
        priority:   t.priority   || '中',
        trigger:    t.trigger    || 'auto',
        delay_days: t.delay_days ?? '',
      })),
    })),
  }
}

export default function ProjectTemplateModal({ tpl, onClose, onSubmit, saving = false }) {
  const [form, setForm] = useState(() => cloneTpl(tpl))

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── workflow helpers ──
  const addWorkflow    = ()          => setForm(f => ({ ...f, workflows: [...f.workflows, emptyWorkflow()] }))
  const removeWorkflow = (wi)        => setForm(f => ({ ...f, workflows: f.workflows.filter((_, i) => i !== wi) }))
  const setWf          = (wi, k, v) => setForm(f => ({
    ...f, workflows: f.workflows.map((w, i) => i === wi ? { ...w, [k]: v } : w),
  }))

  // ── task helpers ──
  const addTask    = (wi)           => setForm(f => ({
    ...f, workflows: f.workflows.map((w, i) => i === wi ? { ...w, tasks: [...w.tasks, emptyTask()] } : w),
  }))
  const removeTask = (wi, ti)       => setForm(f => ({
    ...f, workflows: f.workflows.map((w, i) => i === wi
      ? { ...w, tasks: w.tasks.filter((_, j) => j !== ti) } : w),
  }))
  const setTask    = (wi, ti, k, v) => setForm(f => ({
    ...f, workflows: f.workflows.map((w, i) => i === wi
      ? { ...w, tasks: w.tasks.map((t, j) => j === ti ? { ...t, [k]: v } : t) } : w),
  }))

  const handleSubmit = () => {
    if (!form.name?.trim()) return
    onSubmit({
      ...form,
      estimated_days:   form.estimated_days   !== '' ? Number(form.estimated_days)   : null,
      estimated_budget: form.estimated_budget !== '' ? Number(form.estimated_budget) : null,
      workflows: form.workflows
        .filter(w => w.name.trim())
        .map(w => ({
          ...w,
          delay_days: w.delay_days !== '' ? Number(w.delay_days) : null,
          tasks: w.tasks
            .filter(t => t.title.trim())
            .map(t => ({
              ...t,
              delay_days: t.delay_days !== '' ? Number(t.delay_days) : null,
            })),
        })),
    })
  }

  const totalTasks = form.workflows.reduce(
    (s, w) => s + w.tasks.filter(t => t.title.trim()).length, 0
  )

  return (
    <Modal
      title={tpl?.id ? '✏️ 編輯專案模板' : '➕ 新增專案模板'}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={saving ? '儲存中...' : (tpl?.id ? '儲存變更' : '建立模板')}
      submitDisabled={saving || !form.name?.trim()}
    >
      {/* ── 基本資訊 ── */}
      <Field label="模板名稱" required>
        <input className="form-input" style={{ width: '100%' }}
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="例：新店開幕專案" />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="分類">
          <select className="form-input" style={{ width: '100%' }}
            value={form.category} onChange={e => set('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="預設優先度">
          <select className="form-input" style={{ width: '100%' }}
            value={form.default_priority} onChange={e => set('default_priority', e.target.value)}>
            {PRIORITY_OPTIONS.map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
      </div>

      <Field label="說明">
        <textarea className="form-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }}
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="選填..." />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="預估天數">
          <input className="form-input" type="number" min="0" style={{ width: '100%' }}
            value={form.estimated_days}
            onChange={e => set('estimated_days', e.target.value)}
            placeholder="例：30" />
        </Field>
        <Field label="預估預算 (NT$)">
          <input className="form-input" type="number" min="0" style={{ width: '100%' }}
            value={form.estimated_budget}
            onChange={e => set('estimated_budget', e.target.value)}
            placeholder="選填" />
        </Field>
      </div>

      {/* ── 流程與任務 ── */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, marginTop: 6 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Workflow size={14} />
            流程 ({form.workflows.filter(w => w.name.trim()).length}) · 任務 ({totalTasks})
          </span>
          <button type="button" className="btn btn-secondary"
            style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={addWorkflow}>
            <Plus size={11} /> 新增流程
          </button>
        </div>

        {form.workflows.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
            尚無流程 — 點「新增流程」開始建立
          </div>
        )}

        {form.workflows.map((wf, wi) => (
          <div key={wi} style={{ marginBottom: 12 }}>

            {/* ── inter-workflow trigger connector (wi > 0) ── */}
            {wi > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
                color: 'var(--text-muted)', padding: '4px 8px 8px 8px',
              }}>
                <GitBranch size={11} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                <span>此流程觸發：</span>
                <select className="form-input" style={{ fontSize: 11, padding: '2px 6px' }}
                  value={wf.trigger || 'manual'}
                  onChange={e => setWf(wi, 'trigger', e.target.value)}>
                  {WF_TRIGGERS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                {wf.trigger === 'on_prev_wf_complete' && (
                  <>
                    <span>延遲</span>
                    <input type="number" className="form-input" min="0"
                      style={{ width: 54, fontSize: 11, padding: '2px 6px' }}
                      value={wf.delay_days}
                      onChange={e => setWf(wi, 'delay_days', e.target.value)}
                      placeholder="0" />
                    <span>天</span>
                  </>
                )}
              </div>
            )}

            <div style={{
              padding: 12, borderRadius: 10,
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            }}>
              {/* workflow header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <GripVertical size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input className="form-input" style={{ flex: 1, fontSize: 13, fontWeight: 600 }}
                  value={wf.name}
                  onChange={e => setWf(wi, 'name', e.target.value)}
                  placeholder={`流程 ${wi + 1} 名稱 *`} />
                <button type="button" onClick={() => removeWorkflow(wi)} title="刪除此流程"
                  style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
                  <Trash2 size={14} />
                </button>
              </div>

              {/* task rows */}
              <div style={{ paddingLeft: 20 }}>
                {wf.tasks.map((task, ti) => (
                  <div key={ti} style={{ marginBottom: 8 }}>
                    <div style={{
                      padding: '8px 10px', borderRadius: 8,
                      background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                    }}>
                      {/* main task row */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr auto',
                        gap: 6, alignItems: 'center',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <CheckSquare size={11} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                          <input className="form-input" style={{ width: '100%', fontSize: 12 }}
                            value={task.title}
                            onChange={e => setTask(wi, ti, 'title', e.target.value)}
                            placeholder={`任務 ${ti + 1}`} />
                        </div>
                        <input className="form-input" style={{ width: '100%', fontSize: 12 }}
                          value={task.role}
                          onChange={e => setTask(wi, ti, 'role', e.target.value)}
                          placeholder="角色（選填）" />
                        <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                          value={task.priority}
                          onChange={e => setTask(wi, ti, 'priority', e.target.value)}>
                          {PRIORITY_OPTIONS.map(p => <option key={p}>{p}</option>)}
                        </select>
                        <button type="button" onClick={() => removeTask(wi, ti)}
                          disabled={wf.tasks.length === 1}
                          style={{
                            background: 'none', border: 'none', padding: 4,
                            cursor: wf.tasks.length === 1 ? 'not-allowed' : 'pointer',
                            color: wf.tasks.length === 1 ? 'var(--text-muted)' : 'var(--accent-red)',
                          }}>
                          <Trash2 size={12} />
                        </button>
                      </div>

                      {/* trigger row — only for tasks after the first */}
                      {ti > 0 && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
                          fontSize: 11, color: 'var(--text-muted)', paddingLeft: 17,
                        }}>
                          <ArrowDown size={10} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                          <span>觸發：</span>
                          <select className="form-input" style={{ fontSize: 11, padding: '2px 6px' }}
                            value={task.trigger || 'auto'}
                            onChange={e => setTask(wi, ti, 'trigger', e.target.value)}>
                            {TASK_TRIGGERS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          {(task.trigger || 'auto') !== 'manual' && (
                            <>
                              <span>延遲</span>
                              <input type="number" className="form-input" min="0"
                                style={{ width: 54, fontSize: 11, padding: '2px 6px' }}
                                value={task.delay_days}
                                onChange={e => setTask(wi, ti, 'delay_days', e.target.value)}
                                placeholder="0" />
                              <span>天</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <button type="button" onClick={() => addTask(wi)}
                  style={{
                    marginTop: 4, padding: '4px 10px', borderRadius: 6, fontSize: 11,
                    cursor: 'pointer', border: '1px dashed var(--border-medium)',
                    background: 'none', color: 'var(--text-muted)',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                  <Plus size={10} /> 新增任務
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
