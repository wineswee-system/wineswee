/**
 * 流程整合引擎
 *
 * 讓 HR 模組（請假/加班/出差/報帳）自動建立 workflow_instance，
 * 走簽核鏈，核准後自動推進到下一關。
 */

import { supabase } from './supabase'
import { getSupervisor, getApprovalChain } from './approval'
import { notifyTaskAssignee } from './lineNotify'

// 預設簽核流程模板（fallback，優先讀 approval_chains）
const DEFAULT_TEMPLATES = {
  leave: { name: '請假簽核', steps: ['直屬主管審核', 'HR 確認'] },
  overtime: { name: '加班簽核', steps: ['直屬主管審核'] },
  expense: { name: '費用報帳簽核', steps: ['直屬主管審核', '財務確認'] },
  business_trip: { name: '出差申請簽核', steps: ['直屬主管審核', 'HR 確認'] },
  purchase: { name: '採購簽核', steps: ['部門主管審核', '採購確認'] },
  expense_request: { name: '費用申請簽核', steps: ['直屬主管審核', '財務確認'] },
}

// approval_chains 的 category → type 對照
const CHAIN_CATEGORY_MAP = {
  leave: 'HR', overtime: 'HR', expense: 'HR',
  business_trip: 'HR', purchase: '採購',
  expense_request: '費用申請',
}

/**
 * 建立簽核流程實例
 * @param {'leave'|'overtime'|'expense'|'business_trip'|'purchase'} type
 * @param {object} record - 原始紀錄 { id, employee, ... }
 * @param {string} requesterName - 申請人
 * @returns {{ instance, steps, error? }}
 */
export async function createApprovalWorkflow(type, record, requesterName) {
  const defaultTpl = DEFAULT_TEMPLATES[type]
  if (!defaultTpl) return { error: `未知的流程類型：${type}` }

  // 優先從 approval_chains 讀取設定（依金額匹配）
  const category = CHAIN_CATEGORY_MAP[type] || 'HR'
  const amount = record?.estimated_amount || record?.amount || 0

  // H-4 / M-2: resolve org and employee ID via direct query
  const { data: empOrgRow } = await supabase.from('employees').select('id, organization_id').eq('name', requesterName).maybeSingle()
  const orgId = empOrgRow?.organization_id ?? null
  const requesterId = empOrgRow?.id ?? null

  // approval_chains.steps 已遷移到 approval_chain_steps 關聯表 → 用 FK join 帶回
  const { data: allChains } = await supabase
    .from('approval_chains')
    .select('*, approval_chain_steps(step_order, role_name, label, target_type, target_role_id, target_dept_id, target_emp_id)')
    .eq('category', category)
    .not('is_active', 'is', false)
    .lte('min_amount', amount)
    .eq('organization_id', orgId)   // H-6: filter by org to avoid cross-tenant chain matches
    .order('min_amount', { ascending: false })
    .limit(10)

  // Filter max_amount in JS (Supabase doesn't support OR NULL easily)
  const chain = (allChains || []).find(c =>
    c.max_amount == null || Number(c.max_amount) >= amount
  )
  const sortedChainSteps = chain
    ? [...(chain.approval_chain_steps || [])].sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
    : null

  const template = chain
    ? {
        name: chain.name,
        steps: (sortedChainSteps || []).map(s => s.label || s.role_name || '審核'),
      }
    : defaultTpl

  // Pre-fetch employee names for target_emp_id values in chain steps
  let empById = {}
  if (sortedChainSteps) {
    const empIds = sortedChainSteps.map(s => s.target_emp_id).filter(Boolean)
    if (empIds.length > 0) {
      const { data: empRows } = await supabase.from('employees').select('id, name').in('id', empIds).eq('status', '在職')
      empById = Object.fromEntries((empRows || []).map(e => [e.id, e.name]))
    }
  }

  // 找直屬主管
  const supervisor = await getSupervisor(requesterName)

  // 建立 workflow_instance
  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .insert({
      template_name: template.name,
      status: '進行中',
      started_by: requesterName,
      started_by_id: requesterId,
      assignee: supervisor?.name || null,
      store: record?.store || null,
      organization_id: orgId ?? null,
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (instErr) return { error: instErr.message }

  // 建立簽核步驟（以 tasks 執行表承載，workflow_instance_id 連結回實例）
  // orgId already resolved above (H-4)
  const stepRows = template.steps.map((title, i) => {
    const cs = sortedChainSteps?.[i]
    // 解析該步的承辦人 name + id（兩者都要寫，否則 LIFF liff_list_my_tasks 用 assignee_id 篩會找不到）
    let assigneeName = null
    let assigneeId = null
    if (cs?.target_type === 'employee' && cs?.target_emp_id) {
      assigneeId = cs.target_emp_id
      assigneeName = empById[cs.target_emp_id] || null
    } else if (i === 0 && supervisor) {
      assigneeId = supervisor.id || null
      assigneeName = supervisor.name || null
    }
    return {
      workflow_instance_id: instance.id,
      organization_id: orgId ?? null,
      step_order: i + 1,
      step_type: 'workflow_step',
      title,
      assignee:    assigneeName,
      assignee_id: assigneeId,  // ★ FK，LIFF 端必須
      role: cs?.role_name?.includes('HR') ? 'hr' : cs?.role_name?.includes('財務') ? 'finance' : (title.includes('HR') ? 'hr' : title.includes('財務') ? 'finance' : 'manager'),
      status: '待處理',
      due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      store: record?.store || null,
    }
  })

  const { data: steps, error: stepErr } = await supabase
    .from('tasks')
    .insert(stepRows)
    .select()

  if (stepErr) return { error: stepErr.message }

  // 建立通知給第一關審核人
  if (supervisor) {
    await supabase.from('notifications').insert({
      recipient_emp_id: supervisor.id,
      organization_id: orgId ?? null,
      type: template.name,
      title: `${requesterName} 提交${template.name}，請審核`,
      read: false,
    })

    // LINE 推播（notifyTaskAssignee 內部會解析 employee_line_accounts）
    try {
      await notifyTaskAssignee(supervisor.name, `${requesterName} 提交${template.name}，請審核`)
    } catch (e) { /* LINE 推播失敗不阻擋流程 */ }
  }

  return { instance, steps }
}

/**
 * 推進簽核流程（核准當前步驟，自動推進到下一關）
 * @param {number} stepId - 當前步驟 ID
 * @param {string} approverName - 審核人
 * @param {'核准'|'退回'} action
 * @param {string} comment - 備註/退回原因
 */
export async function advanceWorkflow(stepId, approverName, action, comment = '') {
  // 更新當前步驟（透過 secure RPC 執行，包含 caller 驗證、自我核准防範、assignee guard 及 optimistic lock）
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('secure_advance_workflow_step', {
    p_step_id: stepId,
    p_action: action,
    p_comment: comment || null,
  })
  if (rpcErr) return { error: rpcErr.message }

  // Re-fetch the updated step for downstream logic
  const { data: step, error: stepErr } = await supabase
    .from('tasks').select('*').eq('id', stepId).single()
  if (stepErr || !step) return { error: stepErr?.message || 'step_not_found' }

  // 取得同 instance 所有步驟
  const { data: allSteps } = await supabase
    .from('tasks')
    .select('*')
    .eq('workflow_instance_id', step.workflow_instance_id)
    .order('step_order')

  const { data: instance } = await supabase
    .from('workflow_instances')
    .select('*')
    .eq('id', step.workflow_instance_id)
    .single()

  if (action === '退回') {
    // 整個流程退回
    await supabase
      .from('workflow_instances')
      .update({ status: '已退回', completed_at: new Date().toISOString() })
      .eq('id', step.workflow_instance_id)

    // 回寫原始紀錄狀態
    await writeBackStatus(instance, '已拒絕')

    // 通知申請人
    if (instance?.started_by_id) {
      await supabase.from('notifications').insert({
        recipient_emp_id: instance.started_by_id,
        organization_id: instance.organization_id ?? null,
        type: '簽核退回',
        title: `您的${instance.template_name}已被${approverName}退回：${comment}`,
        read: false,
      })
    }

    return { action: 'rejected', instance, step }
  }

  // 核准 → 找下一關
  const nextStep = allSteps.find(s => s.step_order > step.step_order && s.status === '待處理')

  if (nextStep) {
    // 還有下一關 → 指派審核人
    let nextAssignee = nextStep.assignee
    if (!nextAssignee && nextStep.role) {
      // 根據角色找人 — resolve via department FK lookup
      const lookupDeptId = async (deptName) => {
        const { data } = await supabase.from('departments').select('id').eq('name', deptName).maybeSingle()
        return data?.id
      }
      if (nextStep.role === 'hr') {
        const deptId = await lookupDeptId('人資部')
        if (deptId) {
          const { data: hr } = await supabase.from('employees').select('name').eq('department_id', deptId).eq('status', '在職').limit(1).maybeSingle()
          nextAssignee = hr?.name
        }
      } else if (nextStep.role === 'finance') {
        const deptId = await lookupDeptId('管理部')
        if (deptId) {
          const { data: fin } = await supabase.from('employees').select('name').eq('department_id', deptId).eq('position', '財務').eq('status', '在職').limit(1).maybeSingle()
          nextAssignee = fin?.name
        }
      }
    }

    if (nextAssignee) {
      const { data: empRow } = await supabase.from('employees').select('id').eq('name', nextAssignee).eq('status', '在職').maybeSingle()
      await supabase.from('tasks').update({ assignee: nextAssignee, assignee_id: empRow?.id ?? null }).eq('id', nextStep.id)
      await supabase.from('notifications').insert({
        recipient_emp_id: empRow?.id ?? null,
        organization_id: instance?.organization_id ?? null,
        type: '簽核待辦',
        title: `${instance?.template_name}：${nextStep.title}，請審核`,
        read: false,
      })
      try {
        await notifyTaskAssignee(nextAssignee, `${instance?.started_by} 的${instance?.template_name}，請審核`)
      } catch (e) { /* LINE 推播失敗不阻擋流程 */ }
    }

    return { action: 'advanced', instance, step, nextStep }
  }

  // 沒有下一關 → 全部核准完成
  await supabase
    .from('workflow_instances')
    .update({ status: '已完成', completed_at: new Date().toISOString() })
    .eq('id', step.workflow_instance_id)

  // 回寫原始紀錄狀態
  await writeBackStatus(instance, '已核准')

  // 通知申請人
  if (instance?.started_by_id) {
    await supabase.from('notifications').insert({
      recipient_emp_id: instance.started_by_id,
      organization_id: instance.organization_id ?? null,
      type: '簽核完成',
      title: `您的${instance.template_name}已全數核准`,
      read: false,
    })
  }

  return { action: 'completed', instance, step }
}

// ══════════════════════════════════════
//  簽核結果回寫原始紀錄
// ══════════════════════════════════════

const TEMPLATE_TABLE_MAP = {
  '請假簽核': { table: 'leave_requests', statusField: 'status', pendingStatuses: ['待審核', '申請中'], approved: '已核准', rejected: '已拒絕' },
  '加班簽核': { table: 'overtime_requests', statusField: 'status', pendingStatuses: ['待審核', '申請中'], approved: '已核准', rejected: '已拒絕' },
  // ★ 統一字串：跟 LIFF approve RPC + 主系統 ExpenseRequests/Expenses UI 對齊
  '費用報帳簽核': { table: 'expenses', statusField: 'status', pendingStatuses: ['待審核', '申請中'], approved: '已核銷', rejected: '已駁回' },
  '出差申請簽核': { table: 'business_trips', statusField: 'status', pendingStatuses: ['待審核', '申請中'], approved: '已核准', rejected: '已駁回' },
  '採購簽核': { table: 'purchase_orders', statusField: 'status', pendingStatuses: ['待審核', '申請中'], approved: '已確認', rejected: '已取消' },
  '費用申請簽核': { table: 'expense_requests', statusField: 'status', pendingStatuses: ['申請中', '待審核'], approved: '已核准', rejected: '已駁回' },  // H-1: expense_requests starts as '申請中'
}

async function writeBackStatus(instance, action) {
  if (!instance?.template_name || !instance?.started_by) return

  const mapping = TEMPLATE_TABLE_MAP[instance.template_name]
  if (!mapping) return

  const status = action === '已核准' ? mapping.approved : mapping.rejected

  // 找到該申請人最近一筆待審核的紀錄 — use FK if available, else resolve name → employee_id
  let query = supabase
    .from(mapping.table)
    .select('id')
    .in('status', mapping.pendingStatuses || ['待審核', '待確認'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (instance.organization_id) {
    query = query.eq('organization_id', instance.organization_id)
  }
  if (instance.started_by_id) {
    query = query.eq('employee_id', instance.started_by_id)
  } else {
    const { data: emp } = await supabase.from('employees').select('id').eq('name', instance.started_by).maybeSingle()
    if (!emp?.id) return
    query = query.eq('employee_id', emp.id)
  }
  const { data: records } = await query

  if (records?.[0]) {
    await supabase
      .from(mapping.table)
      .update({ [mapping.statusField]: status })
      .eq('id', records[0].id)
  }
}

/**
 * 取得某筆紀錄關聯的流程實例
 */
export async function getWorkflowForRecord(templateName, requesterName, requesterId = null) {
  let resolvedId = requesterId
  if (!resolvedId && requesterName) {
    const { data: emp } = await supabase.from('employees').select('id').eq('name', requesterName).maybeSingle()
    resolvedId = emp?.id ?? null
  }
  let wiQuery = supabase
    .from('workflow_instances')
    .select('*')
    .eq('template_name', templateName)
    .order('created_at', { ascending: false })
    .limit(1)
  wiQuery = resolvedId
    ? wiQuery.eq('started_by_id', resolvedId)
    : wiQuery.eq('started_by', requesterName)
  const { data: instance } = await wiQuery.maybeSingle()
  if (!instance) return null
  const { data: steps } = await supabase
    .from('tasks')
    .select('*')
    .eq('workflow_instance_id', instance.id)
    .order('step_order')
  return { ...instance, workflow_steps: steps || [] }
}
