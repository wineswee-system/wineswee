/**
 * 流程整合引擎
 *
 * 讓 HR 模組（請假/加班/出差/報帳）自動建立 workflow_instance，
 * 走簽核鏈，核准後自動推進到下一關。
 */

import { supabase } from './supabase'
import { getSupervisor, getApprovalChain } from './approval'
import { notifyTaskAssignee } from './lineNotify'

// 預設簽核流程模板
const WORKFLOW_TEMPLATES = {
  leave: { name: '請假簽核', steps: ['直屬主管審核', 'HR 確認'] },
  overtime: { name: '加班簽核', steps: ['直屬主管審核'] },
  expense: { name: '費用報帳簽核', steps: ['直屬主管審核', '財務確認'] },
  business_trip: { name: '出差申請簽核', steps: ['直屬主管審核', 'HR 確認'] },
  purchase: { name: '採購簽核', steps: ['部門主管審核', '採購確認'] },
}

/**
 * 建立簽核流程實例
 * @param {'leave'|'overtime'|'expense'|'business_trip'|'purchase'} type
 * @param {object} record - 原始紀錄 { id, employee, ... }
 * @param {string} requesterName - 申請人
 * @returns {{ instance, steps, error? }}
 */
export async function createApprovalWorkflow(type, record, requesterName) {
  const template = WORKFLOW_TEMPLATES[type]
  if (!template) return { error: `未知的流程類型：${type}` }

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
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (instErr) return { error: instErr.message }

  // 建立簽核步驟
  const stepRows = template.steps.map((title, i) => ({
    instance_id: instance.id,
    step_order: i + 1,
    title,
    assignee: i === 0 ? (supervisor?.name || null) : null, // 第一關指派給主管
    role: title.includes('HR') ? 'hr' : title.includes('財務') ? 'finance' : 'manager',
    status: i === 0 ? '待處理' : '待處理',
    due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), // 3 天內
  }))

  const { data: steps, error: stepErr } = await supabase
    .from('workflow_steps')
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

    // LINE 推播
    if (supervisor.line_user_id) {
      try {
        await notifyTaskAssignee(supervisor.name, `${requesterName} 提交${template.name}，請審核`)
      } catch (e) { /* LINE 推播失敗不阻擋流程 */ }
    }
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
  // 更新當前步驟
  const newStatus = action === '核准' ? '已完成' : '已退回'
  const { data: step, error: stepErr } = await supabase
    .from('workflow_steps')
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
    .from('workflow_steps')
    .select('*')
    .eq('instance_id', step.instance_id)
    .order('step_order')

  const { data: instance } = await supabase
    .from('workflow_instances')
    .select('*')
    .eq('id', step.instance_id)
    .single()

  if (action === '退回') {
    // 整個流程退回
    await supabase
      .from('workflow_instances')
      .update({ status: '已退回', completed_at: new Date().toISOString() })
      .eq('id', step.instance_id)

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
      // 根據角色找人
      if (nextStep.role === 'hr') {
        const { data: hr } = await supabase.from('employees').select('name').eq('dept', '人資部').eq('status', '在職').limit(1).single()
        nextAssignee = hr?.name
      } else if (nextStep.role === 'finance') {
        const { data: fin } = await supabase.from('employees').select('name').eq('dept', '管理部').eq('position', '財務').eq('status', '在職').limit(1).single()
        nextAssignee = fin?.name
      }
    }

    if (nextAssignee) {
      await supabase.from('workflow_steps').update({ assignee: nextAssignee }).eq('id', nextStep.id)
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
    .eq('id', step.instance_id)

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

/**
 * 取得某筆紀錄關聯的流程實例
 */
export async function getWorkflowForRecord(templateName, requesterName) {
  const { data } = await supabase
    .from('workflow_instances')
    .select('*, workflow_steps(*)')
    .eq('template_name', templateName)
    .eq('started_by', requesterName)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return data
}
