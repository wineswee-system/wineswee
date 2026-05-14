import { useMemo, useEffect, useState } from 'react'
import { Rocket, Calendar, User, AlertTriangle, CheckCircle2, Bell, Settings, Copy, ChevronDown, ChevronRight } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import { empLabel } from '../../../lib/empLabel'

import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'
// 提醒預設選項
const REMINDER_PRESETS = [
  { value: '1hr',  label: '到期前 1 小時' },
  { value: '1day', label: '到期前 1 天' },
  { value: '09am', label: '當天 09:00' },
  { value: 'none', label: '不提醒' },
]
const PRIORITY_OPTIONS = [
  { value: '高', label: '高' },
  { value: '中', label: '中' },
  { value: '低', label: '低' },
]

// 步驟角色 → 部門名稱的對應表（支援模糊匹配）
const ROLE_DEPT_MAP = {
  '人資部': ['人力資源部', '人資部'],
  'HR': ['人力資源部', '人資部'],
  '管理部': ['工務部', '總務部', '管理部'],
  'IT': ['工務部', '總務部', '管理部'],
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

// 從範本名稱推測部署類型 + 對象選擇器型態
function detectTargetType(templateName = '') {
  const n = templateName.toLowerCase()
  if (/新人|到職|onboard|入職|報到/.test(templateName)) return 'employee'
  if (/離職|offboard|退職/.test(templateName)) return 'employee'
  if (/晉升|轉調|職務異動/.test(templateName)) return 'employee'
  if (/客訴|customer/i.test(templateName)) return 'customer'
  if (/展店|新店|開店/.test(templateName)) return 'store'
  return null
}

function getMatchingEmployees(role, employees, departments) {
  if (!role) return { matched: [], others: employees }
  const deptNames = ROLE_DEPT_MAP[role] || []
  const matchDeptIds = departments
    .filter(d => deptNames.includes(d.name) || d.name.includes(role) || role.includes(d.name))
    .map(d => d.id)
  const isManagerRole = ['主管', '店長', '督導', '組長'].some(k => role.includes(k))
  const matched = []
  const others = []
  for (const emp of employees) {
    const deptMatch = matchDeptIds.length > 0 && (
      matchDeptIds.includes(emp.department_id) ||
      deptNames.some(n => n === emp.dept)
    )
    const posMatch = isManagerRole && (
      emp.is_manager ||
      emp.position?.includes('主管') ||
      emp.position?.includes('店長') ||
      emp.position?.includes('督導') ||
      emp.position?.includes('組長') ||
      emp.position?.includes('經理')
    )
    if (deptMatch || posMatch) matched.push(emp)
    else others.push(emp)
  }
  return { matched, others }
}

export default function DeployModal({
  deployTemplate, deployForm, setDeployForm, deployResult, deploying,
  stores, employees, departments,
  checklists = [], approvalChains = [], templates = [],
  onDeploy, onClose,
}) {
  const targetType = detectTargetType(deployTemplate?.name)
  const tplSteps = deployTemplate?.steps || []
  // 哪些步驟展開了「進階設定」
  const [expandedSteps, setExpandedSteps] = useState(new Set())
  // 「加審批人員」picker 暫存：{ [stepIndex]: { emp, pri } }
  const [confPick, setConfPick] = useState({})
  const toggleExpand = (i) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // ── 表單初始化（第一次開啟）──
  useEffect(() => {
    if (!deployForm.planned_start_date) {
      const today = new Date().toISOString().slice(0, 10)
      const estDays = deployTemplate?.estimated_days || tplSteps.length || 7
      const endDate = new Date(Date.now() + estDays * 86400000).toISOString().slice(0, 10)
      const stepOffset = Math.max(1, Math.ceil(estDays / Math.max(1, tplSteps.length)))
      const offsets = {}
      const extras = {}
      tplSteps.forEach((s, i) => {
        offsets[i] = (i + 1) * stepOffset
        // 範本本來就有的 checklist_id / approval_chain_id 自動帶入
        const e = {}
        if (s.checklist_id) e.checklist_id = s.checklist_id
        if (s.approval_chain_id) e.approval_chain_id = s.approval_chain_id
        e.confirmations = []  // [{approver, priority}]
        e.confirmation_mode = 'parallel'  // 預設同時
        if (Object.keys(e).length > 0) extras[i] = e
      })
      setDeployForm(f => ({
        ...f,
        planned_start_date: today,
        planned_end_date: endDate,
        priority: '中',
        notes: '',
        target_employee_id: '',
        step_offsets: offsets,
        batch_defaults: { due_time: '17:00', reminder_preset: '1hr', priority: '中' },
        step_overrides: {},
        // ★ 每步「關聯與簽核」設定
        step_extras: extras,
      }))
    }
  }, [deployTemplate?.id])

  // 操作 step_extras
  const setStepExtra = (i, key, value) => setDeployForm(f => {
    const extras = { ...(f.step_extras || {}) }
    extras[i] = { ...(extras[i] || {}), [key]: value }
    if (value === '' || value === null || value === undefined) delete extras[i][key]
    return { ...f, step_extras: extras }
  })
  const addConfirmation = (i, approver, priority) => {
    if (!approver) return
    setDeployForm(f => {
      const extras = { ...(f.step_extras || {}) }
      const cur = extras[i] || {}
      const list = cur.confirmations || []
      if (list.some(c => c.approver === approver)) return f  // 不重複
      extras[i] = { ...cur, confirmations: [...list, { approver, priority: priority || '中' }] }
      return { ...f, step_extras: extras }
    })
  }
  const removeConfirmation = (i, idx) => setDeployForm(f => {
    const extras = { ...(f.step_extras || {}) }
    const cur = extras[i] || {}
    extras[i] = { ...cur, confirmations: (cur.confirmations || []).filter((_, j) => j !== idx) }
    return { ...f, step_extras: extras }
  })

  // 批次預設操作
  const setBatch = (k, v) => setDeployForm(f => ({
    ...f,
    batch_defaults: { ...(f.batch_defaults || {}), [k]: v }
  }))
  // 個別覆寫操作
  const setStepOverride = (i, k, v) => setDeployForm(f => {
    const overrides = { ...(f.step_overrides || {}) }
    overrides[i] = { ...(overrides[i] || {}), [k]: v }
    // 如果清空回 ''，從 override 移除（恢復用 batch default）
    if (v === '' || v === null || v === undefined) {
      delete overrides[i][k]
      if (Object.keys(overrides[i]).length === 0) delete overrides[i]
    }
    return { ...f, step_overrides: overrides }
  })
  // 「套用到所有步驟」: 把指定步驟的 override 複製給所有步驟
  const applyOverrideToAll = async (sourceIdx) => {
    const src = deployForm.step_overrides?.[sourceIdx]
    if (!src || Object.keys(src).length === 0) {
      toast.error('此步驟沒有覆寫設定，無需套用')
      return
    }
    if (!(await confirm({ message: `要把 Step ${sourceIdx + 1} 的進階設定複製到其他 ${tplSteps.length - 1} 個步驟嗎？` }))) return
    setDeployForm(f => {
      const overrides = { ...(f.step_overrides || {}) }
      tplSteps.forEach((_, i) => {
        if (i !== sourceIdx) overrides[i] = { ...src }
      })
      return { ...f, step_overrides: overrides }
    })
  }

  const getDeptName = (emp) =>
    departments.find(d => d.id === emp.department_id)?.name || emp.dept || ''

  const renderOption = (emp) => {
    const dept = getDeptName(emp)
    return (
      <option key={emp.id} value={emp.name}>
        {empLabel(emp)}｜{emp.position}{dept ? `（${dept}）` : ''}
      </option>
    )
  }

  // ── 驗證 ──
  const validation = useMemo(() => {
    if (!deployForm.location) return { valid: false, error: '請選擇分店' }
    if (targetType === 'employee' && !deployForm.target_employee_id) {
      return { valid: false, error: `此範本需要選擇「對象${targetType === 'employee' ? '員工' : ''}」` }
    }
    const missingSteps = tplSteps
      .map((s, i) => ({ i, hasAssignee: !!deployForm.assignees?.[i] }))
      .filter(x => !x.hasAssignee)
      .map(x => `Step ${x.i + 1}`)
    if (missingSteps.length > 0) {
      return { valid: false, error: `以下步驟未指派負責人：${missingSteps.join(', ')}` }
    }
    if (!deployForm.planned_start_date) return { valid: false, error: '請填開始日期' }
    return { valid: true }
  }, [deployForm, tplSteps, targetType])

  // ── 預覽統計 ──
  const preview = useMemo(() => {
    const taskCount = tplSteps.length
    const uniqueAssignees = new Set(
      Object.values(deployForm.assignees || {}).filter(Boolean)
    )
    const targetEmp = employees.find(e => e.id === Number(deployForm.target_employee_id))
    // 算多少步用了覆寫
    const customCount = Object.values(deployForm.step_overrides || {})
      .filter(o => o && Object.keys(o).length > 0).length
    return {
      taskCount,
      assigneeCount: uniqueAssignees.size,
      lineNotifyCount: uniqueAssignees.size,
      targetName: targetEmp?.name || null,
      startDate: deployForm.planned_start_date,
      endDate: deployForm.planned_end_date,
      customizedSteps: customCount,
      defaultSteps: taskCount - customCount,
    }
  }, [deployForm, tplSteps, employees])

  // 對象員工 picker
  const targetEmpOptions = employees
    .filter(e => e.status !== '離職')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <Modal title={`🚀 部署「${deployTemplate?.name}」`} onClose={onClose}
      onSubmit={deployResult ? onClose : (validation.valid ? onDeploy : null)}
      submitLabel={deployResult ? '查看流程進度 →' : deploying ? '部署中...' : '確認部署'}
      submitDisabled={!deployResult && (!validation.valid || deploying)}>
      {deployResult ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>部署成功！</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
            已為 <strong>{deployResult.location}</strong> 建立 <strong>{deployResult.count}</strong> 個任務
            {deployResult.targetName && <>，對象：<strong>{deployResult.targetName}</strong></>}
          </div>
          <div style={{
            display: 'inline-block', padding: '8px 14px', borderRadius: 8,
            background: 'rgba(34,211,238,0.1)', color: 'var(--accent-cyan)', fontSize: 13,
          }}>
            🔔 第 1 步「{tplSteps[0]?.title}」已自動進入「進行中」，負責人收到 LINE 通知
          </div>
        </div>
      ) : (
        <>
          {/* ─── 對象 + 分店（基本資訊）─── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部署到哪個分店" required>
              <select className="form-input" style={{ width: '100%' }}
                value={deployForm.location}
                onChange={e => setDeployForm(f => ({ ...f, location: e.target.value }))}>
                <option value="">請選擇分店</option>
                {stores.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </Field>
            {targetType === 'employee' && (
              <Field label={
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> 對象員工 *
                </span>
              }>
                <select className="form-input" style={{ width: '100%' }}
                  value={deployForm.target_employee_id || ''}
                  onChange={e => setDeployForm(f => ({ ...f, target_employee_id: e.target.value }))}>
                  <option value="">請選擇對象</option>
                  {targetEmpOptions.map(renderOption)}
                </select>
              </Field>
            )}
          </div>

          {/* ─── 時程 + 優先度 ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
            <Field label={
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={12} /> 開始日期 *
              </span>
            }>
              <input className="form-input" type="date" style={{ width: '100%' }}
                value={deployForm.planned_start_date || ''}
                onChange={e => setDeployForm(f => ({ ...f, planned_start_date: e.target.value }))} />
            </Field>
            <Field label="預期完成日">
              <input className="form-input" type="date" style={{ width: '100%' }}
                value={deployForm.planned_end_date || ''}
                onChange={e => setDeployForm(f => ({ ...f, planned_end_date: e.target.value }))} />
            </Field>
            <Field label="優先度">
              <select className="form-input" style={{ width: '100%' }}
                value={deployForm.priority || '中'}
                onChange={e => setDeployForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </Field>
          </div>

          {/* ─── 批次預設（套用到所有步驟，個別可覆寫）─── */}
          <div style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 10,
            background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-purple)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Settings size={12} /> 批次預設（所有步驟自動繼承，個別可在「⚙ 進階」覆寫）
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>截止時間</label>
                <input className="form-input" type="time" style={{ width: '100%', fontSize: 12 }}
                  value={deployForm.batch_defaults?.due_time || '17:00'}
                  onChange={e => setBatch('due_time', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>提醒</label>
                <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                  value={deployForm.batch_defaults?.reminder_preset || '1hr'}
                  onChange={e => setBatch('reminder_preset', e.target.value)}>
                  {REMINDER_PRESETS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>優先度</label>
                <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                  value={deployForm.batch_defaults?.priority || '中'}
                  onChange={e => setBatch('priority', e.target.value)}>
                  {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ─── 指派負責人 + 每步天數 ─── */}
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '16px 0 10px' }}>
            指派負責人 + 每步預估天數
          </div>
          {tplSteps.map((step, i) => {
            const { matched, others } = getMatchingEmployees(step.role, employees, departments)
            const offset = deployForm.step_offsets?.[i] ?? (i + 1)
            const dueDate = deployForm.planned_start_date
              ? new Date(new Date(deployForm.planned_start_date).getTime() + offset * 86400000).toISOString().slice(0, 10)
              : '—'
            const override = deployForm.step_overrides?.[i] || {}
            const isExpanded = expandedSteps.has(i)
            const hasOverride = Object.keys(override).length > 0
            const batch = deployForm.batch_defaults || {}
            return (
              <div key={i} style={{
                padding: '10px 12px', borderRadius: 8,
                background: hasOverride ? 'rgba(34,211,238,0.05)' : 'var(--glass-light)',
                marginBottom: 6, border: `1px solid ${hasOverride ? 'rgba(34,211,238,0.3)' : 'var(--border-subtle)'}`,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 0.7fr auto', gap: 8, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Step {i + 1}：{step.title}
                      {hasOverride && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--accent-cyan)', color: '#fff' }}>已覆寫</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      預設角色：{step.role || '-'} · 截止：{dueDate} {override.due_time || batch.due_time || '17:00'}
                    </div>
                  </div>
                  <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                    value={deployForm.assignees?.[i] || ''}
                    onChange={e => setDeployForm(f => ({ ...f, assignees: { ...f.assignees, [i]: e.target.value } }))}>
                    <option value="">請選擇</option>
                    {matched.length > 0 && (
                      <optgroup label={`✦ 建議（${step.role}）`}>{matched.map(renderOption)}</optgroup>
                    )}
                    {others.length > 0 && (
                      <optgroup label="其他員工">{others.map(renderOption)}</optgroup>
                    )}
                  </select>
                  <input className="form-input" type="number" min="0" max="180"
                    style={{ width: '100%', fontSize: 12 }} title="從開始日起算第幾天到期"
                    value={offset}
                    onChange={e => setDeployForm(f => ({
                      ...f, step_offsets: { ...f.step_offsets, [i]: Number(e.target.value) }
                    }))} />
                  <button type="button" onClick={() => toggleExpand(i)}
                    title="進階設定（截止時間/提醒/優先度/備註）"
                    style={{
                      padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                      background: isExpanded ? 'var(--accent-cyan)' : 'transparent',
                      color: isExpanded ? '#fff' : 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
                    }}>
                    {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} 進階
                  </button>
                </div>

                {/* ─── 展開區塊 ─── */}
                {isExpanded && (
                  <div style={{
                    marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)',
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
                          截止時間 {!override.due_time && <span style={{ fontSize: 9 }}>(預設)</span>}
                        </label>
                        <input className="form-input" type="time" style={{ width: '100%', fontSize: 12 }}
                          value={override.due_time || batch.due_time || '17:00'}
                          onChange={e => setStepOverride(i, 'due_time', e.target.value)} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
                          提醒 {!override.reminder_preset && <span style={{ fontSize: 9 }}>(預設)</span>}
                        </label>
                        <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                          value={override.reminder_preset || batch.reminder_preset || '1hr'}
                          onChange={e => setStepOverride(i, 'reminder_preset', e.target.value)}>
                          {REMINDER_PRESETS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
                          優先度 {!override.priority && <span style={{ fontSize: 9 }}>(預設)</span>}
                        </label>
                        <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                          value={override.priority || batch.priority || '中'}
                          onChange={e => setStepOverride(i, 'priority', e.target.value)}>
                          {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
                        此步備註（給負責人的提示）
                      </label>
                      <textarea className="form-input" style={{ width: '100%', fontSize: 12, minHeight: 50 }}
                        placeholder="例：請先準備好證件影本"
                        value={override.notes || ''}
                        onChange={e => setStepOverride(i, 'notes', e.target.value)} />
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {hasOverride && (
                        <button type="button" onClick={() => setDeployForm(f => {
                          const o = { ...(f.step_overrides || {}) }; delete o[i]
                          return { ...f, step_overrides: o }
                        })} style={{
                          padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                          border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)',
                        }}>清除覆寫（用預設）</button>
                      )}
                      <button type="button" onClick={() => applyOverrideToAll(i)}
                        disabled={!hasOverride}
                        style={{
                          padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: hasOverride ? 'pointer' : 'not-allowed',
                          border: '1px solid var(--accent-cyan)', background: 'rgba(34,211,238,0.1)',
                          color: 'var(--accent-cyan)', opacity: hasOverride ? 1 : 0.4,
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                        <Copy size={10} /> 套用到所有步驟
                      </button>
                    </div>

                    {/* ─── 🔗 關聯與簽核（每步可獨立設定） ─── */}
                    <div style={{
                      marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border-subtle)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-purple)', marginBottom: 8 }}>
                        🔗 關聯與簽核
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>📋 清單</label>
                          <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                            value={deployForm.step_extras?.[i]?.checklist_id || ''}
                            onChange={e => setStepExtra(i, 'checklist_id', e.target.value ? Number(e.target.value) : '')}>
                            <option value="">— 不掛 —</option>
                            {checklists.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>🚀 完成時觸發 SOP</label>
                          <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                            value={deployForm.step_extras?.[i]?.trigger_template_id || ''}
                            onChange={e => setStepExtra(i, 'trigger_template_id', e.target.value ? Number(e.target.value) : '')}>
                            <option value="">— 不觸發 —</option>
                            {templates.filter(t => t.id !== deployTemplate?.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>🛡 簽核鏈</label>
                        <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                          value={deployForm.step_extras?.[i]?.approval_chain_id || ''}
                          onChange={e => setStepExtra(i, 'approval_chain_id', e.target.value ? Number(e.target.value) : '')}>
                          <option value="">— 不掛簽核鏈 —</option>
                          {approvalChains.map(c => <option key={c.id} value={c.id}>{c.name}{c.category ? `（${c.category}）` : ''}</option>)}
                        </select>
                      </div>
                      {/* 確認審批：多人 + 模式 */}
                      <div style={{
                        padding: 8, borderRadius: 6, background: 'rgba(34,211,238,0.04)',
                        border: '1px dashed rgba(34,211,238,0.2)',
                      }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🔐 確認審批</span>
                          <select className="form-input" style={{ fontSize: 11, padding: '2px 6px', width: 100 }}
                            value={deployForm.step_extras?.[i]?.confirmation_mode || 'parallel'}
                            onChange={e => setStepExtra(i, 'confirmation_mode', e.target.value)}>
                            <option value="parallel">同時審批</option>
                            <option value="sequential">依序審批</option>
                          </select>
                        </div>
                        {/* 已加入的審批人 */}
                        {(deployForm.step_extras?.[i]?.confirmations || []).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                            {(deployForm.step_extras[i].confirmations || []).map((c, idx) => (
                              <span key={idx} style={{
                                padding: '2px 8px', borderRadius: 999, fontSize: 11,
                                background: 'var(--accent-cyan)', color: '#fff',
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                              }}>
                                {c.approver}（{c.priority}）
                                <button type="button" onClick={() => removeConfirmation(i, idx)} style={{
                                  background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1,
                                }}>×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* 新增審批人 */}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <div style={{ flex: 2 }}>
                            <SearchableSelect
                              value={confPick[i]?.emp || null}
                              onChange={(v) => setConfPick(p => ({ ...p, [i]: { ...(p[i] || {}), emp: v || '' } }))}
                              options={empOptions(
                                employees.filter(e => !(deployForm.step_extras?.[i]?.confirmations || []).some(c => c.approver === e.name)),
                                { keyBy: 'name' }
                              )}
                              placeholder="+ 搜尋員工..."
                            />
                          </div>
                          <select className="form-input" style={{ flex: 1, fontSize: 11 }}
                            value={confPick[i]?.pri || '中'}
                            onChange={e => setConfPick(p => ({ ...p, [i]: { ...(p[i] || {}), pri: e.target.value } }))}>
                            <option value="高">高</option><option value="中">中</option><option value="低">低</option>
                          </select>
                          <button type="button" style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                            border: '1px solid var(--accent-cyan)', background: 'var(--accent-cyan)', color: '#fff',
                          }} onClick={() => {
                            const picked = confPick[i]
                            if (picked?.emp) {
                              addConfirmation(i, picked.emp, picked.pri || '中')
                              setConfPick(p => ({ ...p, [i]: { emp: '', pri: '中' } }))
                            }
                          }}>加入</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* ─── 備註 ─── */}
          <Field label="備註（選填）">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60 }}
              placeholder="這次部署的特殊說明、客戶要求..."
              value={deployForm.notes || ''}
              onChange={e => setDeployForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>

          {/* ─── 預覽 + 驗證提示 ─── */}
          <div style={{
            marginTop: 16, padding: 14, borderRadius: 10,
            background: validation.valid ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${validation.valid ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
          }}>
            {validation.valid ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-green)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={14} /> 準備就緒
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  即將建立 <strong>{preview.taskCount}</strong> 個任務，指派給 <strong>{preview.assigneeCount}</strong> 位員工
                  {preview.targetName && <>，對象：<strong>{preview.targetName}</strong></>}
                  <br />
                  <Settings size={11} style={{ display: 'inline', marginRight: 4 }} />
                  <strong>{preview.defaultSteps}</strong> 步用批次預設、<strong style={{ color: 'var(--accent-cyan)' }}>{preview.customizedSteps}</strong> 步有個別覆寫
                  <br />
                  <Bell size={11} style={{ display: 'inline', marginRight: 4 }} />
                  將推 <strong>{preview.lineNotifyCount}</strong> 則 LINE 通知（每位指派人 1 則）
                  <br />
                  <Calendar size={11} style={{ display: 'inline', marginRight: 4 }} />
                  時程：{preview.startDate} ~ {preview.endDate || '無設定'}
                  <br />
                  🚀 第 1 步「{tplSteps[0]?.title}」會自動進入「進行中」狀態
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} /> {validation.error}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
