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

  // approval_chains.steps 已遷移到 approval_chain_steps 關聯表 → 用 FK join 帶回
  const { data: allChains } = await supabase
    .from('approval_chains')
    .select('*, approval_chain_steps(step_order, role_name, label, target_type, target_role_id, target_dept_id, target_emp_id)')
    .eq('category', category)
    .not('is_active', 'is', false)
    .lte('min_amount', amount)
    .order('min_amount', { ascending: false })
    .limit(10)

  // Filter max_amount in JS (Supabase doesn't support OR NULL easily)
  const chain = (allChains || []).find(c =>
    c.max_amount == null || Number(c.max_amount) >= amount
  )
  const template = chain
    ? {
        name: chain.name,
        steps: [...(chain.approval_chain_steps || [])]
          .sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
          .map(s => s.label || s.role_name || '審核'),
      }
    : defaultTpl

  // 找直屬主管
  const supervisor = await getSupervisor(requesterName)

  // 建立 workflow_instance
  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .insert({
      template_name: template.name,
      status: '進行中',
      started_by: requesterName,
      assignee: supervisor?.name || null,
      store: record?.store || null,
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (instErr) return { error: instErr.message }

  // 建立簽核步驟（以 tasks 執行表承載，workflow_instance_id 連結回實例）
  const { data: orgIdRes } = await supabase.rpc('current_employee_org')
  const stepRows = template.steps.map((title, i) => ({
    workflow_instance_id: instance.id,
    organization_id: orgIdRes ?? instance.organization_id ?? null,
    step_order: i + 1,
    step_type: 'workflow_step',
    title,
    assignee: i === 0 ? (supervisor?.name || null) : null,
    role: title.includes('HR') ? 'hr' : title.includes('財務') ? 'finance' : 'manager',
    status: '待處理',
    due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    store: record?.store || null,
  }))

  const { data: steps, error: stepErr } = await supabase
    .from('tasks')
    .insert(stepRows)
    .select()

  if (stepErr) return { error: stepErr.message }

  // 建立通知給第一關審核人
  if (supervisor) {
    await supabase.from('notifications').insert({
      recipient: supervisor.name,
      type: `${template.name}`,
      title: `${requesterName} 提交${template.name}，請審核`,
      link: `/process/workflows`,
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
  // 更新當前步驟（tasks 承載 workflow 執行）
  const newStatus = action === '核准' ? '已完成' : '已退回'
  const { data: step, error: stepErr } = await supabase
    .from('tasks')
    .update({
      status: newStatus,
      confirmed: action === '核准',
      confirmed_by: approverName,
      confirmed_at: new Date().toISOString(),
      notes: comment || null,
      completed_at: action === '核准' ? new Date().toISOString() : null,
    })
    .eq('id', stepId)
    .select()
    .single()

  if (stepErr) return { error: stepErr.message }

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
    if (instance?.started_by) {
      await supabase.from('notifications').insert({
        recipient: instance.started_by,
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
      await supabase.from('tasks').update({ assignee: nextAssignee }).eq('id', nextStep.id)
      await supabase.from('notifications').insert({
        recipient: nextAssignee,
        type: '簽核待辦',
        title: `${instance?.template_name}：${nextStep.title}，請審核`,
        read: false,
      })
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
  if (instance?.started_by) {
    await supabase.from('notifications').insert({
      recipient: instance.started_by,
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
  '請假簽核': { table: 'leave_requests', statusField: 'status', approved: '已核准', rejected: '已拒絕' },
  '加班簽核': { table: 'overtime_requests', statusField: 'status', approved: '已核准', rejected: '已拒絕' },
  '費用報帳簽核': { table: 'expenses', statusField: 'status', approved: '已核銷', rejected: '已拒絕' },
  '出差申請簽核': { table: 'business_trips', statusField: 'status', approved: '已核准', rejected: '已拒絕' },
  '採購簽核': { table: 'purchase_orders', statusField: 'status', approved: '已確認', rejected: '已取消' },
  '費用申請簽核': { table: 'expense_requests', statusField: 'status', approved: '已核准', rejected: '已駁回' },
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
    .in('status', ['待審核', '待確認'])
    .order('created_at', { ascending: false })
    .limit(1)
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
export async function getWorkflowForRecord(templateName, requesterName) {
  const { data: instance } = await supabase
    .from('workflow_instances')
    .select('*')
    .eq('template_name', templateName)
    .eq('started_by', requesterName)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!instance) return null
  const { data: steps } = await supabase
    .from('tasks')
    .select('*')
    .eq('workflow_instance_id', instance.id)
    .order('step_order')
  return { ...instance, workflow_steps: steps || [] }
}
