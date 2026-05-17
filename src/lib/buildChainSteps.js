/**
 * 把 workflow_instance + tasks → ChainTimeline 用的 steps 陣列
 *
 * 給 ApprovalDetailModal 的 chainSteps prop 用。
 * 兩種 pattern 都吃：
 *   A) workflow_instances + tasks（Leave/Overtime/Trip/Expense/FormSubmissions）
 *   B) row.approval_chain_id + row.current_step（Resignation/Transfer）
 */

import { supabase } from './supabase'
import { getWorkflowForRecord } from './workflowIntegration'

/**
 * Pattern A：用 template_name + applicant 找 workflow，再轉 chain steps
 *
 * @param {Object} opts
 * @param {string} opts.templateName       例：'加班簽核' / '請假簽核'
 * @param {string} opts.applicantName      申請人姓名
 * @param {number} [opts.applicantId]
 * @param {string} opts.applicantCreatedAt 申請時間 (ISO)
 * @param {string} opts.recordStatus       表單目前 status（'待審核' / '已核准' / '已拒絕' …）
 * @param {string} [opts.approverName]     fallback 用：實際核可者姓名（row.approver）
 * @param {string} [opts.approvedAt]       fallback 用：核可時間
 * @param {string} [opts.rejectReason]     fallback 用：駁回原因
 * @param {Array<string>} [opts.fallbackTail]  fallback 額外尾巴關卡（如 ['人資核章']），對齊 PDF simpleSign
 * @returns {Promise<Array>}
 */
export async function buildWorkflowChainSteps({
  templateName, applicantName, applicantId, applicantCreatedAt, recordStatus,
  approverName, approvedAt, rejectReason,
  fallbackTail = ['人資核章'],
}) {
  // 過濾「-」這種 placeholder 字串
  const cleanApprover = (approverName && approverName !== '-' && approverName !== '—') ? approverName : ''

  const applicantStep = {
    label: '申請人',
    name: applicantName || '—',
    status: 'completed',
    completedAt: applicantCreatedAt,
    isApplicant: true,  // 給 PDF / Modal 識別這是申請人 cell（不蓋章）
  }

  // 試拿 workflow_instance
  let workflow = null
  try {
    workflow = await getWorkflowForRecord(templateName, applicantName, applicantId || null)
  } catch (e) {
    console.error('[buildWorkflowChainSteps] getWorkflowForRecord failed:', e)
  }

  if (!workflow || !workflow.workflow_steps?.length) {
    // 沒走 workflow → 用 3 關 fallback：申請人 + 直屬主管 + 尾巴（與 PDF 對齊）
    let supervisorStep
    if (recordStatus === '已核准' || recordStatus === '已核銷') {
      supervisorStep = { label: '直屬主管', name: cleanApprover, status: 'completed', completedAt: approvedAt }
    } else if (recordStatus === '已駁回' || recordStatus === '已拒絕' || recordStatus === '已退回') {
      supervisorStep = { label: '直屬主管', name: cleanApprover, status: 'rejected', rejectReason }
    } else {
      supervisorStep = { label: '直屬主管', name: '', status: 'current' }
    }
    // 尾巴關卡（人資核章 等）— 純形式存檔用，標 archival 讓 timeline 終點不卡住
    const tailSteps = (fallbackTail || []).map(label => ({
      label, name: '', status: 'pending', archival: true,
    }))
    return [applicantStep, supervisorStep, ...tailSteps]
  }

  let foundCurrent = false
  const steps = workflow.workflow_steps.map(t => {
    let status
    if (t.status === '已完成') status = 'completed'
    else if (t.status === '已退回') status = 'rejected'
    else if (!foundCurrent) {
      status = 'current'
      foundCurrent = true
    } else {
      status = 'pending'
    }
    return {
      label: t.role || t.title?.replace(/^.+? - /, '') || `第${t.step_order}關`,
      name: t.assignee || '',
      target_emp_id: t.assignee_id || null,
      role_name: t.role || null,
      status,
      completedAt: t.completed_at,
      completedBy: t.completed_by || (status === 'completed' ? t.assignee : null),
      rejectReason: t.status === '已退回' ? (t.description || '') : '',
    }
  })

  return [applicantStep, ...steps]
}

/**
 * Pattern B：給 Resignation/Transfer 用，從 row.approval_chain_id 找 chain template + row.current_step 算進度
 *
 * @param {Object} opts
 * @param {Object} opts.row                  整筆 row（含 approval_chain_id, current_step, status, reject_reason, approver, approved_at）
 * @param {string} opts.applicantName
 * @param {string} opts.applicantCreatedAt
 * @param {Object} [opts.approverMap]        { emp_id: emp_name }，用於把 chain step 的 target_emp_id 翻成名字
 * @param {string} [opts.sourceTable]        提供此參數時會 merge 加簽（approval_extra_steps）— 'expense_requests' / 'leave_requests' / ...
 * @returns {Promise<Array>}
 */
export async function buildChainBasedSteps({
  row, applicantName, applicantCreatedAt, approverMap = {}, sourceTable = null,
}) {
  const applicantStep = {
    label: '申請人',
    name: applicantName || '—',
    status: 'completed',
    completedAt: applicantCreatedAt,
    isApplicant: true,
  }

  if (!row?.approval_chain_id) {
    if (row?.status === '已核准') {
      return [applicantStep, { label: '主管核示', name: row.approver?.name || '', status: 'completed', completedAt: row.approved_at }]
    }
    if (row?.status === '已駁回' || row?.status === '已拒絕' || row?.status === '已退回') {
      return [applicantStep, { label: '主管核示', name: row.approver?.name || '', status: 'rejected', rejectReason: row.reject_reason }]
    }
    return [applicantStep, { label: '主管核示', name: '', status: 'current' }]
  }

  // 用 RPC 拿 chain step 清單 + 動態解出來的 approver 名字（fixed_emp / applicant_dept_manager / specific_store_manager 等 9 種都解）
  const applicantEmpId = row.employee_id || row.employee_emp_id || null
  let chainSteps = []
  try {
    const { data } = await supabase.rpc('get_chain_step_display_names', {
      p_chain_id: row.approval_chain_id,
      p_applicant_emp_id: applicantEmpId,
    })
    chainSteps = Array.isArray(data) ? data : []
  } catch (e) {
    console.warn('[buildChainBasedSteps] get_chain_step_display_names failed, fallback:', e)
    // fallback：只抓 chain step template，不解動態名字
    const { data } = await supabase
      .from('approval_chain_steps')
      .select('id, step_order, label, role_name, target_emp_id, target_type')
      .eq('chain_id', row.approval_chain_id)
      .order('step_order')
    chainSteps = (data || []).map(s => ({
      step_order: s.step_order, label: s.label, role_name: s.role_name,
      target_type: s.target_type, target_emp_id: s.target_emp_id,
      names: s.target_emp_id ? (approverMap[s.target_emp_id] || '') : (s.role_name || ''),
    }))
  }

  // current_step 慣例：0 = 還沒進任何關，1 = 在第一關，N+1 = 全部完成
  const totalSteps = chainSteps?.length || 0
  let cur = row.current_step || 0
  if (cur < 0 || cur > totalSteps + 1) {
    console.warn('[buildChainBasedSteps] current_step out of range:', cur, 'total:', totalSteps)
    cur = Math.max(0, Math.min(cur, totalSteps + 1))
  }
  const steps = chainSteps.map((s) => {
    const idx = s.step_order
    let status
    if (row.status === '已駁回' || row.status === '已拒絕' || row.status === '已退回') {
      status = idx === cur ? 'rejected' : (idx < cur ? 'completed' : 'pending')
    } else if (row.status === '已核准' || row.status === '已核銷') {
      status = 'completed'
    } else {
      status = idx < cur ? 'completed' : (idx === cur ? 'current' : 'pending')
    }
    const targetName = s.names || (s.target_emp_id ? (approverMap[s.target_emp_id] || '') : (s.role_name || ''))
    return {
      label: s.label || s.role_name || `第${idx}關`,
      name: targetName,
      target_emp_id: s.target_emp_id || null,
      role_name: s.role_name || null,
      status,
      completedAt: status === 'completed' && idx === totalSteps ? row.approved_at : undefined,
      completedBy: status === 'completed' ? targetName : null,
      rejectReason: status === 'rejected' ? row.reject_reason : '',
    }
  })

  const allSteps = [applicantStep, ...steps]

  // 加簽 merge — sourceTable 提供時撈 approval_extra_steps 插入對應位置
  if (sourceTable && row?.id) {
    const merged = await mergeExtraSteps(allSteps, sourceTable, row.id, approverMap)
    return merged
  }
  return allSteps
}

/**
 * 把 approval_extra_steps 插入既有 chain steps（共用 helper）
 *
 * 規則：
 *   - 跳過 'cancelled' 狀態（不顯示）
 *   - extra.status → step.status 對映：
 *       pending  → 'current'  （等加簽人簽）
 *       approved → 'completed'
 *       rejected → 'rejected'
 *   - 插在原 chain 第 insert_before_step 之前（用 fractional step_order 排序：N - 0.5）
 *
 * @param {Array} baseSteps      含申請人 cell 的完整 chain steps
 * @param {string} sourceTable
 * @param {number} sourceId
 * @param {Object} approverMap   { emp_id: emp_name } — 解加簽人 / 發起人姓名
 * @returns {Promise<Array>}
 */
async function mergeExtraSteps(baseSteps, sourceTable, sourceId, approverMap = {}) {
  const { data: extras } = await supabase
    .from('approval_extra_steps')
    .select('id, source_id, insert_before_step, assignee_id, requested_by_id, reason, reject_reason, status, approved_at, created_at')
    .eq('source_table', sourceTable)
    .eq('source_id', sourceId)
    .neq('status', 'cancelled')
    .order('created_at')

  if (!extras || extras.length === 0) return baseSteps

  // 把員工 id → 姓名拉齊（如果 approverMap 沒有就 query）
  const needIds = new Set()
  for (const e of extras) {
    if (!approverMap[e.assignee_id]) needIds.add(e.assignee_id)
    if (!approverMap[e.requested_by_id]) needIds.add(e.requested_by_id)
  }
  let nameMap = { ...approverMap }
  if (needIds.size > 0) {
    const { data: emps } = await supabase
      .from('employees')
      .select('id, name')
      .in('id', Array.from(needIds))
    for (const e of (emps || [])) nameMap[e.id] = e.name
  }

  // 組加簽 step
  const extraSteps = extras.map(e => {
    let status = 'pending'
    if (e.status === 'pending') status = 'current'
    else if (e.status === 'approved') status = 'completed'
    else if (e.status === 'rejected') status = 'rejected'
    return {
      kind: 'extra',
      label: '加簽',
      name: nameMap[e.assignee_id] || '',
      status,
      completedAt: e.approved_at,
      completedBy: nameMap[e.assignee_id] || '',
      rejectReason: e.reject_reason || '',
      // 加簽專屬 meta（給 PDF / Modal 顯示「由 X 發起 / 原因」）
      extraReason: e.reason || '',
      extraRequesterName: nameMap[e.requested_by_id] || '',
      // 用 -0.5 表達「在第 N 關之前」— 給排序用
      _insertBefore: e.insert_before_step,
      _insertOrder: e.insert_before_step - 0.5,
    }
  })

  // base 是 [applicantStep, step1, step2, ...] — applicantStep idx 0，chain step.step_order 從 0 開始
  // 加簽要插到對應 chain step「之前」(同 idx 的 chain step 之前)
  // 用 _insertOrder = N-0.5 跟 chain step 的 step_order = N 一起排
  const indexed = []
  let chainIdx = 0
  for (let i = 0; i < baseSteps.length; i++) {
    const s = baseSteps[i]
    if (s.isApplicant) {
      indexed.push({ _order: -1, step: s })
    } else {
      indexed.push({ _order: chainIdx, step: s })
      chainIdx += 1
    }
  }
  for (const ex of extraSteps) {
    indexed.push({ _order: ex._insertOrder, step: ex })
  }
  indexed.sort((a, b) => a._order - b._order)
  return indexed.map(x => x.step)
}


/**
 * Pattern C：給 HR 表單用 — 讀 form_chain_configs(form_type, org) 動態組 chainSteps
 *
 * 與 Pattern A/B 不同：每張表自己有獨立配置（form_chain_configs），
 * chain 步驟支援動態目標（依 applicant 解析）。
 *
 * 給 modal + PDF 共用，確保兩邊顯示一致。
 *
 * @param {Object} opts
 * @param {string} opts.formType        'leave' | 'overtime' | 'trip' | ...
 * @param {number} opts.organizationId
 * @param {string} opts.applicantName
 * @param {number} [opts.applicantId]   給 resolver 解動態目標
 * @param {string} opts.applicantCreatedAt
 * @param {string} opts.recordStatus    '申請中' / '已核准' / '已駁回' ...
 * @param {string} [opts.approverName]  fallback 給沒設 chain 時用
 * @param {string} [opts.approvedAt]
 * @param {string} [opts.rejectReason]
 * @param {Array<string>} [opts.fallbackTail]  沒設 chain 時的 fallback 尾巴關卡
 * @returns {Promise<Array>}
 */
export async function buildFormChainSteps({
  formType, organizationId, applicantName, applicantId, applicantCreatedAt, recordStatus,
  approverName, approvedAt, rejectReason,
  fallbackTail = ['人資核章'],
}) {
  const cleanApprover = (approverName && approverName !== '-' && approverName !== '—') ? approverName : ''
  const applicantStep = {
    label: '申請人', name: applicantName || '—',
    status: 'completed', completedAt: applicantCreatedAt, isApplicant: true,
  }

  // 找 form_chain_configs
  const { data: cfg } = await supabase
    .from('form_chain_configs')
    .select('chain_id, is_active')
    .eq('form_type', formType)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!cfg?.chain_id || !cfg?.is_active) {
    // 沒設定 → 退回到舊 fallback：申請人 + 直屬主管 + 人資核章
    let supervisorStep
    if (recordStatus === '已核准' || recordStatus === '已核銷') {
      supervisorStep = { label: '直屬主管', name: cleanApprover, status: 'completed', completedAt: approvedAt }
    } else if (recordStatus === '已駁回' || recordStatus === '已拒絕' || recordStatus === '已退回') {
      supervisorStep = { label: '直屬主管', name: cleanApprover, status: 'rejected', rejectReason }
    } else {
      supervisorStep = { label: '直屬主管', name: '', status: 'current' }
    }
    const tailSteps = (fallbackTail || []).map(label => ({
      label, name: '', status: 'pending', archival: true,
    }))
    return [applicantStep, supervisorStep, ...tailSteps]
  }

  // 抓 chain steps
  const { data: chainSteps } = await supabase
    .from('approval_chain_steps')
    .select('id, step_order, label, role_name, target_type, target_emp_id, target_role_id, target_dept_id, target_store_id, target_section_id')
    .eq('chain_id', cfg.chain_id)
    .order('step_order')

  // 解每關的實際簽核者（call resolver RPC）— 動態目標靠 applicantId 決定
  const resolved = await Promise.all((chainSteps || []).map(async (s) => {
    let names = ''
    if (applicantId) {
      try {
        const { data: approvers } = await supabase.rpc('resolve_chain_step_approvers', {
          p_chain_step_id: s.id,
          p_applicant_emp_id: applicantId,
        })
        names = (approvers || []).map(a => a.emp_name).join('、')
      } catch (e) {
        console.warn('[buildFormChainSteps] resolve failed for step', s.id, e)
      }
    }
    return { step: s, names: names || (s.target_type?.startsWith('applicant_') ? '⚠️ 動態解不出（檢查組織圖）' : '') }
  }))

  // Status 推算（單關 status 模式）：
  //   申請中  → 第 1 關 current，其他 pending
  //   已核准  → 全部 completed
  //   已駁回  → 第 1 關 rejected，其他 pending（暫時假設駁回在第 1 關，未來 form 加 current_step 才能精準）
  const isApproved = recordStatus === '已核准' || recordStatus === '已核銷'
  const isRejected = recordStatus === '已駁回' || recordStatus === '已拒絕' || recordStatus === '已退回'

  const finalSteps = resolved.map(({ step, names }, i) => {
    let status
    if (isApproved) status = 'completed'
    else if (isRejected) status = i === 0 ? 'rejected' : 'pending'
    else status = i === 0 ? 'current' : 'pending'
    return {
      label: step.label || step.role_name || `第${i + 1}關`,
      name: names,
      target_emp_id: step.target_emp_id || null,
      role_name: step.role_name || null,
      status,
      completedAt: status === 'completed' && i === resolved.length - 1 ? approvedAt : undefined,
      rejectReason: status === 'rejected' ? rejectReason : '',
    }
  })

  return [applicantStep, ...finalSteps]
}
