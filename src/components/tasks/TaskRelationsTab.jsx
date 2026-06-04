import { useState } from 'react'
import { X, Rocket, Workflow, Check } from 'lucide-react'
import {
  linkTaskChecklist, unlinkTaskChecklist,
  createTaskDependency, deleteTaskDependency,
  getChecklistItems,
  updateChecklistItem,
  createWorkflowInstance,
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { notifyTaskAssignee } from '../../lib/lineNotify'
import { toast } from '../../lib/toast'
import FormBindingsPicker from '../FormBindingsPicker'

const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
const sectionStyle = {
  padding: '16px 20px', marginBottom: 12, borderRadius: 10,
  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
}

export default function TaskRelationsTab({
  task,
  checklists,
  linkedChecklists, setLinkedChecklists,
  checklistItemsMap, setChecklistItemsMap,
  dependencies, setDependencies,
  allSteps,
  sopTemplates,
  triggeredInstances, setTriggeredInstances,
  // 新增：綁定表單 + 工作流 / 專案
  formBindings = [], setFormBindings = () => {},
  form = {}, setAndDirty = () => {},
  allWorkflowInstances = [], allProjects = [],
}) {
  const [triggerTemplateId, setTriggerTemplateId] = useState('')
  const [triggering, setTriggering] = useState(false)

  const otherSteps = allSteps.filter(s => s.id !== task.id)
  const prerequisites = dependencies.filter(d => d.task_id === task.id && d.dep_type === 'prerequisite')
  const triggers = dependencies.filter(d => d.task_id === task.id && d.dep_type === 'trigger')

  const getStepLabel = (id) => {
    const s = allSteps.find(x => x.id === id)
    return s ? `${s.step_order}. ${s.title}` : `#${id}`
  }

  // ── Checklists ──
  const handleToggleLinkedItem = async (item) => {
    const { data } = await updateChecklistItem(item.id, { checked: !item.checked })
    if (data) {
      const updatedItems = (checklistItemsMap[item.checklist_id] || []).map(i =>
        i.id === item.id ? data : i
      )
      setChecklistItemsMap(prev => ({ ...prev, [item.checklist_id]: updatedItems }))
      const completed = updatedItems.filter(i => i.checked).length
      await supabase.from('checklists').update({ completed }).eq('id', item.checklist_id)
    }
  }

  const handleLinkChecklist = async (checklistId) => {
    if (!checklistId) return
    const { data } = await linkTaskChecklist(task.id, Number(checklistId))
    if (data) {
      const cl = checklists.find(c => c.id === Number(checklistId))
      setLinkedChecklists(prev => [...prev, { ...data, checklists: cl }])
    }
  }

  const handleUnlinkChecklist = async (linkId) => {
    await unlinkTaskChecklist(linkId)
    setLinkedChecklists(prev => prev.filter(l => l.id !== linkId))
  }

  // ── Dependencies ──
  const handleAddDep = async (depTaskId, type) => {
    if (!depTaskId) return
    const { data } = await createTaskDependency({
      task_id: task.id,
      depends_on_task_id: Number(depTaskId),
      dep_type: type,
    })
    if (data) setDependencies(prev => [...prev, data])
  }

  const handleRemoveDep = async (depId) => {
    await deleteTaskDependency(depId)
    setDependencies(prev => prev.filter(d => d.id !== depId))
  }

  // ── Trigger Workflow ──
  const handleTriggerWorkflow = async () => {
    if (!triggerTemplateId) return
    const tpl = sopTemplates.find(t => t.id === Number(triggerTemplateId))
    if (!tpl) return
    setTriggering(true)
    try {
      const { data: inst, error } = await createWorkflowInstance({
        template_name: tpl.name,
        store: task.store || null,
        status: '進行中',
        started_by: task.assignee || '系統',
        triggered_by_task_id: task.id,
        started_at: new Date().toISOString(),
      })
      if (error || !inst) throw new Error(error?.message || '建立流程失敗')

      const steps = Array.isArray(tpl.steps) ? tpl.steps : []
      if (steps.length > 0) {
        const taskRows = steps.map((s, i) => ({
          workflow_instance_id: inst.id,
          step_order: i + 1,
          title: s.title,
          description: s.description || null,
          role: s.role || null,
          assignee: i === 0 ? (task.assignee || null) : null,
          store: task.store || null,
          status: i === 0 ? '進行中' : '待處理',
          started_at: i === 0 ? new Date().toISOString() : null,
          bucket: 'Workflow',
          category: 'Workflow',
          priority: s.priority || '中',
          organization_id: task.organization_id || null,
        }))
        const { data: createdTasks } = await supabase.from('tasks').insert(taskRows).select()
        if (createdTasks?.[0]?.assignee) {
          notifyTaskAssignee(
            createdTasks[0].assignee,
            createdTasks[0].title,
            tpl.name,
            createdTasks[0].id,
            {
              dueDate: createdTasks[0].due_date,
              description: createdTasks[0].description,
              notes: createdTasks[0].notes,
              store: createdTasks[0].store,
              approvalRequired: createdTasks[0].status === '待簽核',
            }
          ).catch(() => {})
        }
      }

      setTriggeredInstances(prev => [inst, ...prev])
      setTriggerTemplateId('')
    } catch (err) {
      toast.error('觸發失敗，請稍後再試')
    }
    setTriggering(false)
  }

  return (
    <>
      {/* ═══ 綁定表單 ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0 }}>
          📋 綁定表單（選填）
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          執行人需填完選定的表單，全部完成才能完成此任務。已填過的綁定（🔒）不能移除。
        </div>
        <FormBindingsPicker
          value={formBindings.map(b => ({ form_type: b.form_type, form_template_id: b.form_template_id, label: b.form_label, _binding_id: b.id, _has_form: !!b.form_id }))}
          onChange={async (next) => {
            const curr = formBindings
            const keyOf = (o) => `${o.form_type}-${o.form_template_id ?? 'null'}`
            const nextKeys = new Set(next.map(keyOf))
            const currKeys = new Set(curr.map(keyOf))
            for (const item of next) {
              if (!currKeys.has(keyOf(item))) {
                await supabase.rpc('create_task_form_binding', {
                  p_task_id: task.id, p_form_type: item.form_type, p_form_template_id: item.form_template_id || null,
                })
              }
            }
            for (const item of curr) {
              if (!nextKeys.has(keyOf(item)) && !item.form_id) {
                await supabase.from('task_form_bindings').delete().eq('id', item.id)
              }
            }
            const { data } = await supabase.from('task_form_bindings').select('*').eq('task_id', task.id).order('id')
            setFormBindings(data || [])
          }}
          lockedKeys={formBindings.filter(b => b.form_id).map(b => `${b.form_type}-${b.form_template_id ?? 'null'}`)}
        />
      </div>

      {/* ═══ 工作流 / 專案 ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0 }}>🔗 所屬流程與專案</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>工作流</div>
            <select className="form-input" style={{ width: '100%' }} value={form.workflow_instance_id || ''}
              onChange={e => setAndDirty('workflow_instance_id', e.target.value ? Number(e.target.value) : '')}>
              <option value="">未指定</option>
              {allWorkflowInstances.map(w => (
                <option key={w.id} value={w.id}>{w.template_name}{w.status ? ` (${w.status})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>專案</div>
            <select className="form-input" style={{ width: '100%' }} value={form.project_id || ''}
              onChange={e => setAndDirty('project_id', e.target.value ? Number(e.target.value) : '')}>
              <option value="">未指定</option>
              {allProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ═══ Checklists ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📋 清單設定 ({linkedChecklists.length})</span>
        </div>

        {linkedChecklists.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>尚無關聯清單，請從下方選擇</div>
        ) : linkedChecklists.map(lc => {
          const clItems = checklistItemsMap[lc.checklist_id] || []
          const clChecked = clItems.filter(i => i.checked).length
          const clTotal = clItems.length
          return (
            <div key={lc.id} style={{
              marginBottom: 10, borderRadius: 8,
              border: '1px solid var(--border-subtle)', overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', background: 'var(--glass-light)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {lc.checklists?.name || `清單 #${lc.checklist_id}`}
                  {clTotal > 0 && (
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                      ({clChecked}/{clTotal})
                    </span>
                  )}
                </span>
                <button onClick={() => handleUnlinkChecklist(lc.id)} style={{
                  background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 11,
                }}>移除</button>
              </div>

              {clTotal > 0 && (
                <div style={{ padding: '4px 12px 0' }}>
                  <div style={{ height: 4, borderRadius: 2, background: 'var(--border-medium)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${Math.round(clChecked / clTotal * 100)}%`,
                      background: clChecked === clTotal ? 'var(--accent-green)' : 'var(--accent-cyan)',
                    }} />
                  </div>
                </div>
              )}

              <div style={{ padding: '8px 12px' }}>
                {clItems.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <button onClick={() => handleToggleLinkedItem(item)} style={{
                      width: 20, height: 20, borderRadius: 4,
                      border: `2px solid ${item.checked ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                      background: item.checked ? 'var(--accent-green)' : 'transparent',
                      color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, padding: 0,
                    }}>
                      {item.checked && <Check size={12} />}
                    </button>
                    <span style={{
                      fontSize: 12,
                      textDecoration: item.checked ? 'line-through' : 'none',
                      color: item.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                    }}>{item.title}</span>
                  </div>
                ))}
                {clItems.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    此清單尚無項目，請到「查核清單」頁面新增
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <select className="form-input" style={{ width: '100%', fontSize: 12 }}
          value="" onChange={e => {
            const id = e.target.value
            if (!id) return
            handleLinkChecklist(id).then(() => {
              getChecklistItems(Number(id)).then(({ data }) => {
                setChecklistItemsMap(prev => ({ ...prev, [Number(id)]: data || [] }))
              })
            })
          }}>
          <option value="">＋ 選擇已建立的清單...</option>
          {(checklists || [])
            .filter(c => !linkedChecklists.some(lc => lc.checklist_id === c.id))
            .map(c => <option key={c.id} value={c.id}>{c.name} ({c.completed}/{c.items})</option>)}
        </select>
      </div>

      {/* ═══ Trigger Workflow ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Rocket size={13} style={{ color: 'var(--accent-purple)' }} />
          <span style={{ color: 'var(--accent-purple)' }}>觸發流程</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          從此任務啟動一個工作流程，第一個步驟自動設為進行中並通知負責人。
        </div>
        {triggeredInstances.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {triggeredInstances.map(inst => {
              const iColor = inst.status === '已完成' ? 'var(--accent-green)' : 'var(--accent-cyan)'
              return (
                <div key={inst.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: 'var(--glass-light)', borderRadius: 8, marginBottom: 4,
                  border: '1px solid var(--border-subtle)', fontSize: 12,
                }}>
                  <Workflow size={11} style={{ color: iColor, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{inst.template_name}</span>
                  {inst.store && <span style={{ color: 'var(--text-muted)' }}>{inst.store}</span>}
                  <span style={{
                    padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                    color: iColor,
                    background: inst.status === '已完成' ? 'var(--accent-green-dim)' : 'var(--accent-cyan-dim)',
                  }}>{inst.status}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{inst.started_at?.slice(0, 10)}</span>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="form-input" style={{ flex: 1, fontSize: 12 }}
            value={triggerTemplateId} onChange={e => setTriggerTemplateId(e.target.value)}>
            <option value="">選擇流程範本…</option>
            {sopTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 5, background: 'var(--accent-purple)', border: 'none' }}
            onClick={handleTriggerWorkflow}
            disabled={!triggerTemplateId || triggering}
          >
            <Rocket size={12} /> {triggering ? '觸發中...' : '觸發'}
          </button>
        </div>
      </div>

      {/* ═══ Prerequisites ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0 }}>🔒 前置條件（全部完成後才開始）</div>
        {prerequisites.map(d => (
          <div key={d.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: 'var(--glass-light)', borderRadius: 8, marginBottom: 4,
            border: '1px solid var(--border-subtle)', fontSize: 13,
          }}>
            <span style={{ flex: 1 }}>→ {getStepLabel(d.depends_on_task_id)}</span>
            <button onClick={() => handleRemoveDep(d.id)} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            }}><X size={14} /></button>
          </div>
        ))}
        <select className="form-input" style={{ width: '100%', fontSize: 12 }}
          value="" onChange={e => handleAddDep(e.target.value, 'prerequisite')}>
          <option value="">＋ 新增前置條件...</option>
          {otherSteps
            .filter(s => !prerequisites.some(p => p.depends_on_task_id === s.id))
            .map(s => <option key={s.id} value={s.id}>{s.step_order}. {s.title}</option>)}
        </select>
      </div>

      {/* ═══ Triggers ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0 }}>⚠️ 觸發動作（完成時執行）</div>
        {triggers.map(d => (
          <div key={d.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: 'var(--glass-light)', borderRadius: 8, marginBottom: 4,
            border: '1px solid var(--border-subtle)', fontSize: 13,
          }}>
            <span style={{ flex: 1 }}>→ {getStepLabel(d.depends_on_task_id)}</span>
            <button onClick={() => handleRemoveDep(d.id)} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            }}><X size={14} /></button>
          </div>
        ))}
        <select className="form-input" style={{ width: '100%', fontSize: 12 }}
          value="" onChange={e => handleAddDep(e.target.value, 'trigger')}>
          <option value="">＋ 新增觸發任務...</option>
          {otherSteps
            .filter(s => !triggers.some(t => t.depends_on_task_id === s.id))
            .map(s => <option key={s.id} value={s.id}>{s.step_order}. {s.title}</option>)}
        </select>
      </div>
    </>
  )
}
