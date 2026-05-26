import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  X, ChevronRight, ChevronLeft, Rocket,
  Calendar, Settings, AlertTriangle, User, CheckCircle2, Bell,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { createTask } from '../../../lib/db'
import { useAuth } from '../../../contexts/AuthContext'
import { toast } from '../../../lib/toast'
import { Field } from '../../../components/Modal'

// ── Constants ─────────────────────────────────────────────────────────────────

const REMINDER_PRESETS = [
  { value: '1hr',  label: '到期前 1 小時' },
  { value: '1day', label: '到期前 1 天' },
  { value: '09am', label: '當天 09:00' },
  { value: 'none', label: '不提醒' },
]

const ROLE_DEPT_MAP = {
  '人資部': ['人力資源部', '人資部'],
  'HR': ['人力資源部', '人資部'],
  '管理部': ['工務部', '總務部', '管理部'],
  '財務部': ['財務部'],
  '倉儲物流部': ['倉儲物流部'],
  '採購部': ['採購部'],
  '營運部': ['營運部'],
  '品牌行銷部': ['品牌行銷部'],
  '行銷部': ['品牌行銷部'],
  '展店事業部': ['加盟展店事業部'],
  '加盟展店事業部': ['加盟展店事業部'],
  '總經理室': ['總經理室'],
}

function detectTargetType(templateName = '') {
  if (/新人|到職|onboard|入職|報到|離職|offboard|退職|晉升|轉調|職務異動/.test(templateName))
    return 'employee'
  return null
}

function getMatchingEmployees(role, employees, departments) {
  if (!role) return { matched: [], others: employees }
  const deptNames = ROLE_DEPT_MAP[role] || []
  const matchDeptIds = departments
    .filter(d => deptNames.includes(d.name) || d.name.includes(role) || role.includes(d.name))
    .map(d => d.id)
  const isManagerRole = ['主管', '店長', '督導', '組長'].some(k => role.includes(k))
  const matched = [], others = []
  for (const emp of employees) {
    const deptMatch = matchDeptIds.length > 0 && matchDeptIds.includes(emp.department_id)
    const posMatch = isManagerRole &&
      ['主管', '店長', '督導', '組長', '經理'].some(k => emp.position?.includes(k))
    if (deptMatch || posMatch) matched.push(emp)
    else others.push(emp)
  }
  return { matched, others }
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ current, labels }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 24 }}>
      {labels.map((label, i) => {
        const done = i < current, active = i === current
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: done ? 'var(--accent-green)' : active ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                color: (done || active) ? '#fff' : 'var(--text-muted)',
                border: active ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              }}>
                {done ? <CheckCircle2 size={13} /> : i + 1}
              </div>
              <div style={{
                fontSize: 10, fontWeight: active ? 700 : 400, whiteSpace: 'nowrap',
                color: active ? 'var(--accent-cyan)' : done ? 'var(--accent-green)' : 'var(--text-muted)',
              }}>
                {label}
              </div>
            </div>
            {i < labels.length - 1 && (
              <div style={{
                width: 60, height: 2, margin: '0 4px', marginBottom: 20,
                background: done ? 'var(--accent-green)' : 'var(--border-subtle)',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Sub-steps ─────────────────────────────────────────────────────────────────

function Step1Target({ form, setForm, stores, employees, targetType }) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="部署到哪個分店 *">
          <select className="form-input" style={{ width: '100%' }}
            value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))}>
            <option value="">請選擇分店</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </Field>

        {targetType === 'employee' ? (
          <Field label={<span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><User size={12} />對象員工 *</span>}>
            <select className="form-input" style={{ width: '100%' }}
              value={form.target_employee_id || ''}
              onChange={e => setForm(f => ({ ...f, target_employee_id: e.target.value }))}>
              <option value="">請選擇對象</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.position ? ` — ${e.position}` : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="優先度">
            <select className="form-input" style={{ width: '100%' }}
              value={form.priority || '中'}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              <option>高</option><option>中</option><option>低</option>
            </select>
          </Field>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 14 }}>
        <Field label={<span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={12} />開始日期 *</span>}>
          <input className="form-input" type="date" style={{ width: '100%' }}
            value={form.planned_start_date || today}
            onChange={e => setForm(f => ({ ...f, planned_start_date: e.target.value }))} />
        </Field>
        <Field label="預期完成日">
          <input className="form-input" type="date" style={{ width: '100%' }}
            value={form.planned_end_date || ''}
            onChange={e => setForm(f => ({ ...f, planned_end_date: e.target.value }))} />
        </Field>
        <Field label="備註">
          <input className="form-input" type="text" style={{ width: '100%' }}
            placeholder="（選填）"
            value={form.notes || ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </Field>
      </div>
    </div>
  )
}

function Step2Assign({ form, setForm, steps, employees, departments }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        為每個步驟指派負責人員。帶 * 表示必填。
      </div>
      {steps.map((step, i) => {
        const { matched, others } = getMatchingEmployees(step.role, employees, departments)
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 1.4fr', gap: 10,
            alignItems: 'center', padding: '10px 12px',
            borderRadius: 8, border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--bg-card)', color: 'var(--text-muted)',
              fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {i + 1}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{step.title}</div>
              {step.role && (
                <span style={{
                  display: 'inline-block', marginTop: 2,
                  fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  background: 'var(--bg-card)', color: 'var(--text-muted)',
                }}>
                  {step.role}
                </span>
              )}
            </div>
            <select className="form-input" style={{ width: '100%', fontSize: 12 }}
              value={form.assignees?.[i] || ''}
              onChange={e => setForm(f => ({
                ...f, assignees: { ...f.assignees, [i]: e.target.value },
              }))}>
              <option value="">請指派負責人 *</option>
              {matched.length > 0 && (
                <optgroup label={`建議（${step.role || '角色'}）`}>
                  {matched.map(e => (
                    <option key={e.id} value={e.name}>
                      {e.name}{e.position ? ` — ${e.position}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="其他人員">
                {others.map(e => (
                  <option key={e.id} value={e.name}>
                    {e.name}{e.position ? ` — ${e.position}` : ''}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        )
      })}
    </div>
  )
}

function Step3Schedule({ form, setForm }) {
  const setBatch = (k, v) => setForm(f => ({
    ...f, batch_defaults: { ...(f.batch_defaults || {}), [k]: v },
  }))
  return (
    <div>
      <div style={{
        padding: '14px', borderRadius: 10, marginBottom: 14,
        background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)',
      }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: 'var(--accent-purple)',
          marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Settings size={12} /> 批次預設（套用到所有步驟）
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>截止時間</label>
            <input className="form-input" type="time" style={{ width: '100%', fontSize: 12 }}
              value={form.batch_defaults?.due_time || '17:00'}
              onChange={e => setBatch('due_time', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>提醒</label>
            <select className="form-input" style={{ width: '100%', fontSize: 12 }}
              value={form.batch_defaults?.reminder_preset || '1hr'}
              onChange={e => setBatch('reminder_preset', e.target.value)}>
              {REMINDER_PRESETS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>優先度</label>
            <select className="form-input" style={{ width: '100%', fontSize: 12 }}
              value={form.batch_defaults?.priority || '中'}
              onChange={e => setBatch('priority', e.target.value)}>
              <option>高</option><option>中</option><option>低</option>
            </select>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <Bell size={12} /> 步驟到期提醒將透過 LINE 推送給負責人
      </div>
    </div>
  )
}

// ── Main wizard component ─────────────────────────────────────────────────────

const STEP_LABELS = ['目標', '人員分配', '排程設定']

/**
 * DeployWizard — 3-step deploy modal (portal).
 *
 * Props:
 *   template    — { id, name, category, steps: [] }
 *   stores      — Array<{ id, name }>
 *   employees   — Array<{ id, name, department_id, position, ... }>
 *   departments — Array<{ id, name }>
 *   onClose     — () => void
 *   onSuccess   — (result: { location, taskCount }) => void  (optional)
 */
export default function DeployWizard({ template, stores, employees, departments, onClose, onSuccess }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const currentUser = profile?.name || '管理員'
  const tplSteps = template?.steps || []
  const targetType = detectTargetType(template?.name)

  const today = new Date().toISOString().slice(0, 10)
  const estEnd = new Date(Date.now() + (tplSteps.length || 7) * 86400000).toISOString().slice(0, 10)

  const [currentStep, setCurrentStep] = useState(0)
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(null) // result after success
  const [form, setForm] = useState({
    location: '',
    target_employee_id: '',
    priority: '中',
    planned_start_date: today,
    planned_end_date: estEnd,
    notes: '',
    assignees: {},
    batch_defaults: { due_time: '17:00', reminder_preset: '1hr', priority: '中' },
  })

  // Per-step validation
  const stepValid = useMemo(() => [
    !!form.location && (targetType !== 'employee' || !!form.target_employee_id),
    tplSteps.every((_, i) => !!form.assignees?.[i]),
    true,
  ], [form, tplSteps, targetType])

  const handleDeploy = async () => {
    setDeploying(true)
    try {
      const loc = form.location
      const batchDef = form.batch_defaults || { due_time: '17:00', reminder_preset: '1hr', priority: '中' }
      const stepOffset = Math.max(1, Math.round((tplSteps.length || 7) / Math.max(1, tplSteps.length)))

      // 1. Workflow instance
      const { data: instance, error: instErr } = await supabase
        .from('workflow_instances')
        .insert({
          template_name: template.name,
          store: loc,
          status: '進行中',
          started_by: currentUser,
          started_by_id: profile?.id || null,
          priority: form.priority || '中',
          planned_start_date: form.planned_start_date || null,
          planned_end_date: form.planned_end_date || null,
          notes: form.notes || null,
          target_employee_id: form.target_employee_id ? Number(form.target_employee_id) : null,
          organization_id: profile?.organization_id || null,
        })
        .select().single()
      if (instErr) throw instErr

      // 2. Tasks
      const insertedTasks = []
      for (let i = 0; i < tplSteps.length; i++) {
        const step = tplSteps[i]
        const offsetDays = (i + 1) * stepOffset
        const dueDate = form.planned_start_date
          ? new Date(new Date(form.planned_start_date).getTime() + offsetDays * 86400000).toISOString().slice(0, 10)
          : new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)

        const { data: task, error: taskErr } = await createTask({
          title: step.title,
          description: step.description || null,
          workflow: template.name,
          workflow_instance_id: instance.id,
          step_order: i + 1,
          step_type: 'workflow_step',
          role: step.role || null,
          assignee: form.assignees?.[i] || '',
          priority: batchDef.priority || '中',
          status: i === 0 ? '進行中' : '待處理',
          due_date: dueDate,
          due_time: batchDef.due_time || '17:00',
          reminder_preset: batchDef.reminder_preset || '1hr',
          store: loc,
          bucket: '工作流程',
          category: '工作流程',
          organization_id: profile?.organization_id || null,
          checklist_id: step.checklist_id || null,
          approval_chain_id: step.approval_chain_id || null,
          trigger_template_id_on_complete: step.trigger_template_id || null,
        })
        if (taskErr) throw taskErr
        if (task) {
          insertedTasks.push(task)
          for (const f of (step.required_forms || [])) {
            await supabase.rpc('create_task_form_binding', {
              p_task_id: task.id,
              p_form_type: f.form_type,
              p_form_template_id: f.form_template_id || null,
            }).catch(() => null)
          }
        }
      }

      // 3. Sequential dependencies
      for (let i = 1; i < insertedTasks.length; i++) {
        await supabase.from('task_dependencies').insert({
          task_id: insertedTasks[i].id,
          depends_on_task_id: insertedTasks[i - 1].id,
        }).catch(() => null)
      }

      const result = { location: loc, taskCount: insertedTasks.length, instanceId: instance.id }
      setDeployed(result)
      onSuccess?.(result)
    } catch (err) {
      console.error('DeployWizard error:', err)
      toast.error('部署失敗：' + (err.message || '未知錯誤'))
    }
    setDeploying(false)
  }

  const body = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget && !deploying) onClose() }}
    >
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 16,
        width: '100%', maxWidth: 680, maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
      }}>
        {/* Modal header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
              🚀 部署流程範本
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {template?.name}・{tplSteps.length} 個步驟
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={deploying}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {deployed ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>部署成功！</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                已為 <strong>{deployed.location}</strong> 建立 <strong>{deployed.taskCount}</strong> 個任務
              </div>
              <div style={{
                display: 'inline-block', padding: '8px 14px', borderRadius: 8,
                background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 13,
              }}>
                🔔 第 1 步「{tplSteps[0]?.title}」已自動進入「進行中」，負責人收到 LINE 通知
              </div>
            </div>
          ) : (
            <>
              <StepIndicator current={currentStep} labels={STEP_LABELS} />

              {currentStep === 0 && (
                <Step1Target
                  form={form} setForm={setForm}
                  stores={stores} employees={employees}
                  targetType={targetType}
                />
              )}
              {currentStep === 1 && (
                <Step2Assign
                  form={form} setForm={setForm}
                  steps={tplSteps} employees={employees} departments={departments}
                />
              )}
              {currentStep === 2 && (
                <Step3Schedule form={form} setForm={setForm} />
              )}

              {!stepValid[currentStep] && currentStep < 2 && (
                <div style={{
                  marginTop: 12, display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: 'var(--accent-orange)',
                }}>
                  <AlertTriangle size={13} />
                  {currentStep === 0 && '請選擇分店' + (targetType === 'employee' ? '及對象員工' : '')}
                  {currentStep === 1 && '請為所有步驟指派負責人'}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal footer */}
        <div style={{
          padding: '14px 24px', flexShrink: 0,
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {deployed ? (
            <button className="btn btn-primary"
              onClick={() => { onClose(); navigate(`/process/workflows?instance=${deployed.instanceId}`) }}
              style={{ marginLeft: 'auto' }}>
              查看流程進度 →
            </button>
          ) : (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => currentStep > 0 ? setCurrentStep(s => s - 1) : onClose()}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <ChevronLeft size={14} />
                {currentStep === 0 ? '取消' : '上一步'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {currentStep + 1} / {STEP_LABELS.length}
                </span>
                {currentStep < STEP_LABELS.length - 1 ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => setCurrentStep(s => s + 1)}
                    disabled={!stepValid[currentStep]}
                    style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    下一步 <ChevronRight size={14} />
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={handleDeploy}
                    disabled={deploying}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Rocket size={14} />
                    {deploying ? '部署中...' : '確認部署'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
