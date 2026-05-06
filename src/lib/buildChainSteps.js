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
  const applicantStep = {
    label: '申請人',
    name: applicantName || '—',
    status: 'completed',
    completedAt: applicantCreatedAt,
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
      supervisorStep = { label: '直屬主管', name: approverName || '', status: 'completed', completedAt: approvedAt }
    } else if (recordStatus === '已駁回' || recordStatus === '已拒絕' || recordStatus === '已退回') {
      supervisorStep = { label: '直屬主管', name: approverName || '', status: 'rejected', rejectReason }
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
 * @returns {Promise<Array>}
 */
export async function buildChainBasedSteps({
  row, applicantName, applicantCreatedAt, approverMap = {},
}) {
  const applicantStep = {
    label: '申請人',
    name: applicantName || '—',
    status: 'completed',
    completedAt: applicantCreatedAt,
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

  // 抓 chain template 步驟
  const { data: chainSteps } = await supabase
    .from('approval_chain_steps')
    .select('id, step_order, label, role_name, target_emp_id')
    .eq('chain_id', row.approval_chain_id)
    .order('step_order')

  const cur = row.current_step || 0
  const steps = (chainSteps || []).map((s) => {
    const idx = s.step_order
    let status
    if (row.status === '已駁回' || row.status === '已拒絕' || row.status === '已退回') {
      status = idx === cur ? 'rejected' : (idx < cur ? 'completed' : 'pending')
    } else if (row.status === '已核准' || row.status === '已核銷') {
      status = 'completed'
    } else {
      // 進行中：cur 之前 = completed, cur = current, 之後 = pending
      status = idx < cur ? 'completed' : (idx === cur ? 'current' : 'pending')
    }
    const targetName = s.target_emp_id ? (approverMap[s.target_emp_id] || '') : (s.role_name || '')
    return {
      label: s.label || s.role_name || `第${idx}關`,
      name: targetName,
      target_emp_id: s.target_emp_id || null,
      role_name: s.role_name || null,
      status,
      // 最後一關核可的時間用 row.approved_at
      completedAt: status === 'completed' && idx === (chainSteps?.length || 0) ? row.approved_at : undefined,
      completedBy: status === 'completed' ? targetName : null,
      rejectReason: status === 'rejected' ? row.reject_reason : '',
    }
  })

  return [applicantStep, ...steps]
}
