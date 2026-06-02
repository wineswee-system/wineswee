import { supabase } from './supabase'

/**
 * HR 申請類簽核鏈整合 helper
 *
 * 對齊 expense_requests 模式：
 *   - 表預留 approval_chain_id + current_step (0-indexed)
 *   - DB 端 trigger 處理 status='已核准' 後的 cascade（員工狀態 / position_history）
 *
 * 支援表（p_table）：
 *   'resignation' → resignation_requests
 *   'loa'         → leave_of_absence_requests
 *   'transfer'    → personnel_transfer_requests
 */

const TABLE_MAP = {
  resignation: 'resignation_requests',
  loa: 'leave_of_absence_requests',
  transfer: 'personnel_transfer_requests',
  headcount: 'headcount_requests',
}

const CATEGORY_MAP = {
  resignation: '離職',
  loa: '留停',
  transfer: '異動',
  headcount: '人力需求',
}

/**
 * 依 form_chain_configs + 組織圖 找適合申請人的 active chain
 * 先查申請人是否為部門/門市主管（departments.manager_id / stores.manager_id），
 * 再試 specific type，fallback 'all'
 * 回傳 { id, name } 或 null
 */
export async function findFormChainByApplicantType(formType, organizationId, employeeId) {
  // 查組織圖：此員工是否為部門主管或門市店長
  let isManager = false
  if (employeeId) {
    const [deptRes, storeRes] = await Promise.all([
      supabase.from('departments').select('id', { count: 'exact', head: true })
        .eq('manager_id', employeeId).eq('organization_id', organizationId),
      supabase.from('stores').select('id', { count: 'exact', head: true })
        .eq('manager_id', employeeId).eq('organization_id', organizationId),
    ])
    isManager = (deptRes.count || 0) + (storeRes.count || 0) > 0
  }

  const { data: rows } = await supabase
    .from('form_chain_configs')
    .select('chain_id, applicant_type, approval_chains(id, name)')
    .eq('form_type', formType)
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  const byType = (rows || []).reduce((acc, r) => { acc[r.applicant_type] = r; return acc }, {})
  const specificType = isManager ? 'manager' : 'staff'
  const best = byType[specificType] || byType['all'] || null
  if (!best?.chain_id) return null
  return { id: best.chain_id, name: best.approval_chains?.name || null }
}

/**
 * 找 category 對應的 active chain（取第一條）
 * 沒找到回 null（caller 應走後備邏輯）
 */
export async function findActiveChainByCategory(category, organizationId) {
  const { data } = await supabase
    .from('approval_chains')
    .select('id, name, category, steps')
    .eq('category', category)
    .eq('is_active', true)
    .eq('organization_id', organizationId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data || null
}

/**
 * 取一條 chain 的所有 steps
 */
export async function loadChainSteps(chainId) {
  if (!chainId) return []
  const { data } = await supabase
    .from('approval_chain_steps')
    .select('id, step_order, label, role_name, target_type, target_emp_id, target_dept_id, target_role_id')
    .eq('chain_id', chainId)
    .order('step_order', { ascending: true })
  return data || []
}

/**
 * 取一筆單目前等待簽核的人員清單
 */
export async function resolveFirstApprovers(table, requestId) {
  const { data, error } = await supabase.rpc('hr_chain_resolve_first_approvers', {
    p_table: table,
    p_id: requestId,
  })
  if (error) {
    console.error('hr_chain_resolve_first_approvers failed:', error)
    return []
  }
  return data || []
}

/**
 * 核准 / 退回一關
 * @returns { ok, status, event, ...extra } from RPC
 */
export async function approveChainStep({ table, id, approverEmpId, action, reason }) {
  const { data, error } = await supabase.rpc('hr_chain_approve', {
    p_table: table,
    p_id: id,
    p_approver_id: approverEmpId,
    p_action: action,
    p_reason: reason || null,
  })
  if (error) {
    return { ok: false, error: error.message }
  }
  return data
}

/**
 * 寫一筆 notifications 給 emp_id（recipient_emp_id）
 * NotificationCenter UI 已移除（2026-05-20）；此處仍寫 notifications 表保留資料
 * 之後若做別的通知 UI 直接讀此表即可
 */
export async function notifyApprovers({ approvers, title, message, type = 'form_submission', actionUrl, organizationId }) {
  if (!approvers || approvers.length === 0) return
  const rows = approvers.map(a => ({
    recipient_emp_id: a.emp_id,
    organization_id: organizationId || null,
    type,
    title,
    payload: { message, action_url: actionUrl },
    read: false,
  }))
  const { error } = await supabase.from('notifications').insert(rows)
  if (error) console.error('notifyApprovers failed:', error)
}

export { TABLE_MAP, CATEGORY_MAP }
