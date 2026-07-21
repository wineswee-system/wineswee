import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  X, ChevronRight, ChevronLeft, Rocket,
  Calendar, Settings, AlertTriangle, User, CheckCircle2, Bell,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
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
                width: 44, height: 2, margin: '0 4px', marginBottom: 20,
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
              {others.length > 0 && (
                <optgroup label="其他人員">
                  {others.map(e => (
                    <option key={e.id} value={e.name}>
                      {e.name}{e.position ? ` — ${e.position}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
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
        background: 'var(--accent-purple-dim)', border: '1px solid var(--border-subtle)',
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

function ToggleSwitch({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
        background: checked ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        position: 'relative', flexShrink: 0,
        transition: 'background 0.15s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2,
        left: checked ? 20 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', /* inverse text on accent background */
        transition: 'left 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  )
}

function Step4Notify({ form, setForm }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        提醒與通知
      </div>

      {/* LINE 通知 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>LINE 通知</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            LINE 通知將發送給每個步驟的負責人
          </div>
        </div>
        <ToggleSwitch
          checked={form.notify_line ?? true}
          onChange={v => setForm(f => ({ ...f, notify_line: v }))}
        />
      </div>

      {/* Email 通知 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Email 通知</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            發送任務指派通知到負責人信箱
          </div>
        </div>
        <ToggleSwitch
          checked={form.notify_email ?? false}
          onChange={v => setForm(f => ({ ...f, notify_email: v }))}
        />
      </div>

      {/* 提醒時機 */}
      <div style={{
        padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
      }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 8 }}>
          提醒時機
        </label>
        <select className="form-input" style={{ width: '100%', fontSize: 12 }}
          value={form.notify_timing || '1day'}
          onChange={e => setForm(f => ({ ...f, notify_timing: e.target.value }))}>
          {REMINDER_PRESETS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* 抄送直屬主管 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>抄送直屬主管</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            任務指派及完成通知同步發給直屬主管
          </div>
        </div>
        <ToggleSwitch
          checked={form.cc_manager ?? true}
          onChange={v => setForm(f => ({ ...f, cc_manager: v }))}
        />
      </div>
    </div>
  )
}

function Step5Confirm({ form, steps, templateName }) {
  const assigneeCount = useMemo(() => {
    const names = new Set(Object.values(form.assignees || {}).filter(Boolean))
    return names.size
  }, [form.assignees])

  const firstDate = form.planned_start_date || '—'
  const timingLabel = REMINDER_PRESETS.find(r => r.value === (form.notify_timing || '1day'))?.label || '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary banner */}
      <div style={{
        padding: '14px 16px', borderRadius: 10,
        background: 'var(--accent-cyan-dim)', border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 6 }}>
          部署摘要
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          即將建立 <strong>{steps.length}</strong> 個任務，指派給 <strong>{assigneeCount}</strong> 位人員，
          首個任務 <strong>{firstDate}</strong>
        </div>
      </div>

      {/* Basic info */}
      <div style={{
        padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px',
        fontSize: 12,
      }}>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>範本名稱　</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{templateName}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>分店　</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{form.location || '—'}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>開始日期　</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{form.planned_start_date || '—'}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>完成日期　</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{form.planned_end_date || '—'}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>步驟數量　</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{steps.length} 步</span>
        </div>
      </div>

      {/* Assignee table */}
      <div style={{
        borderRadius: 8, border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '8px 12px',
          background: 'var(--bg-secondary)',
          fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
          display: 'grid', gridTemplateColumns: '36px 1fr 1fr',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <span>#</span><span>步驟</span><span>負責人</span>
        </div>
        {steps.map((step, i) => (
          <div key={i} style={{
            padding: '8px 12px',
            background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)',
            fontSize: 12, display: 'grid', gridTemplateColumns: '36px 1fr 1fr',
            alignItems: 'center',
          }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</span>
            <span style={{ color: 'var(--text-primary)' }}>{step.title}</span>
            <span style={{
              color: form.assignees?.[i] ? 'var(--text-primary)' : 'var(--accent-orange)',
              fontWeight: form.assignees?.[i] ? 400 : 600,
            }}>
              {form.assignees?.[i] || '未指派'}
            </span>
          </div>
        ))}
      </div>

      {/* Notification summary */}
      <div style={{
        padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
        fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>通知設定</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ color: 'var(--text-muted)' }}>LINE 通知</span>
          <span style={{ color: (form.notify_line ?? true) ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 600 }}>
            {(form.notify_line ?? true) ? '開啟' : '關閉'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ color: 'var(--text-muted)' }}>Email 通知</span>
          <span style={{ color: (form.notify_email ?? false) ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 600 }}>
            {(form.notify_email ?? false) ? '開啟' : '關閉'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ color: 'var(--text-muted)' }}>提醒時機</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{timingLabel}</span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ color: 'var(--text-muted)' }}>抄送主管</span>
          <span style={{ color: (form.cc_manager ?? true) ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 600 }}>
            {(form.cc_manager ?? true) ? '是' : '否'}
          </span>
        </div>
      </div>

      <div style={{
        fontSize: 12, color: 'var(--text-muted)',
        textAlign: 'center', paddingTop: 4,
      }}>
        確認無誤後，點擊下方「立即部署 →」完成部署
      </div>
    </div>
  )
}

// ── Main wizard component ─────────────────────────────────────────────────────

const STEP_LABELS = ['目標', '人員分配', '時間設定', '提醒通知', '確認部署']

/**
 * DeployWizard — 5-step deploy modal (portal).
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
  const navigate = useNavigate()
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
    notify_line: true,
    notify_email: false,
    notify_timing: '1day',
    cc_manager: true,
  })

  // Per-step validation (steps 3 and 4 are always valid — no required fields)
  const stepValid = useMemo(() => [
    !!form.location && (targetType !== 'employee' || !!form.target_employee_id),
    tplSteps.every((_, i) => !!form.assignees?.[i]),
    true,
    true,
    true,
  ], [form, tplSteps, targetType])

  const handleDeploy = async () => {
    setDeploying(true)
    try {
      // 前端 pre-check（後端 RPC 也會擋，這裡先給即時回饋）
      if (form.planned_start_date && form.planned_end_date &&
          form.planned_end_date < form.planned_start_date) {
        throw new Error('結束日期不能早於開始日期')
      }
      const loc = form.location

      // ── deploy_workflow_template RPC：單一原子交易建 instance + tasks + 表單綁定 + 依賴鏈 ──
      // 取代原本前端多表序列寫入 + 3 段手刻 rollback + RLS-SELECT hack（部分失敗自動回滾，不留孤兒）。
      const { data: res, error } = await supabase.rpc('deploy_workflow_template', {
        p_template_id: template.id,
        p_params: {
          location: loc || null,
          priority: form.priority || '中',
          planned_start_date: form.planned_start_date || null,
          planned_end_date: form.planned_end_date || null,
          notes: form.notes || null,
          target_employee_id: form.target_employee_id ? Number(form.target_employee_id) : null,
          assignees: form.assignees || [],
          batch_defaults: form.batch_defaults || { due_time: '17:00', reminder_preset: '1hr', priority: '中' },
          notify_line: form.notify_line ?? true,
          notify_timing: form.notify_timing || '1day',
        },
      })
      if (error) throw error
      if (!res?.ok) {
        throw new Error({
          CALLER_NOT_FOUND: '找不到帳號對應員工',
          TEMPLATE_NOT_FOUND: '找不到範本',
          TEMPLATE_HAS_NO_STEPS: '範本沒有步驟',
          END_BEFORE_START: '結束日期不能早於開始日期',
        }[res?.error] || (res?.error || '未知錯誤'))
      }

      if ((res.form_binding_warnings || 0) > 0) {
        toast.error(`部署完成，但 ${res.form_binding_warnings} 個表單綁定設定失敗，請手動確認`)
      }

      const result = { location: loc, taskCount: (res.task_ids || []).length, instanceId: res.instance_id }
      setDeployed(result)
      onSuccess?.(result)
    } catch (err) {
      toast.error('部署失敗：' + (err.message || '未知錯誤'))
    } finally {
      setDeploying(false)
    }
  }

  const body = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget && !deploying) onClose() }}
    >
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 16,
        width: '100%', maxWidth: 680, maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-xl)',
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
              {currentStep === 3 && (
                <Step4Notify form={form} setForm={setForm} />
              )}
              {currentStep === 4 && (
                <Step5Confirm
                  form={form} steps={tplSteps}
                  templateName={template?.name}
                />
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
                    {deploying ? '部署中...' : '立即部署 →'}
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
