import { useMemo, useEffect } from 'react'
import { Rocket, Calendar, User, AlertTriangle, CheckCircle2, Bell } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import { empLabel } from '../../../lib/empLabel'

// 步驟角色 → 部門名稱的對應表（支援模糊匹配）
const ROLE_DEPT_MAP = {
  '人資部': ['人力資源部', '人資部'],
  'HR': ['人力資源部', '人資部'],
  '管理部': ['總務部', '管理部'],
  'IT': ['總務部', '管理部'],
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
  onDeploy, onClose,
}) {
  const targetType = detectTargetType(deployTemplate?.name)
  const tplSteps = deployTemplate?.steps || []

  // ── 表單初始化（第一次開啟）──
  useEffect(() => {
    // 帶入預設：開始日今天、預估天數從範本來、優先度中、每步 offset 1 天
    if (!deployForm.planned_start_date) {
      const today = new Date().toISOString().slice(0, 10)
      const estDays = deployTemplate?.estimated_days || tplSteps.length || 7
      const endDate = new Date(Date.now() + estDays * 86400000).toISOString().slice(0, 10)
      // 預設每步 offset = ceil(總天數 / 步數)
      const stepOffset = Math.max(1, Math.ceil(estDays / Math.max(1, tplSteps.length)))
      const offsets = {}
      tplSteps.forEach((_, i) => { offsets[i] = (i + 1) * stepOffset })
      setDeployForm(f => ({
        ...f,
        planned_start_date: today,
        planned_end_date: endDate,
        priority: '中',
        notes: '',
        target_employee_id: '',
        step_offsets: offsets,
      }))
    }
  }, [deployTemplate?.id])

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
    return {
      taskCount,
      assigneeCount: uniqueAssignees.size,
      lineNotifyCount: uniqueAssignees.size,  // 每位收一則 LINE
      targetName: targetEmp?.name || null,
      startDate: deployForm.planned_start_date,
      endDate: deployForm.planned_end_date,
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
            <Field label="部署到哪個分店 *">
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
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 8, alignItems: 'center',
                padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)',
                marginBottom: 6, border: '1px solid var(--border-subtle)',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Step {i + 1}：{step.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    預設角色：{step.role || '-'} · 截止：{dueDate}
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
