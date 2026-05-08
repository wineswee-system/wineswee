import { supabase } from './supabase'

/**
 * 動態簽核引擎
 * 根據組織架構自動找到直屬主管進行審核
 */

// 找到員工的直屬主管 (by ID)
export async function getSupervisorById(employeeId) {
  const { data: emp } = await supabase
    .from('employees')
    .select('supervisor_id')
    .eq('id', employeeId)
    .eq('status', '在職')
    .maybeSingle()

  if (!emp?.supervisor_id) return null

  const { data: supervisor } = await supabase
    .from('employees')
    .select('id, name, email, role_id')
    .eq('id', emp.supervisor_id)
    .eq('status', '在職')
    .maybeSingle()

  return supervisor
}

// Legacy: find supervisor by name (falls back to ID-based)
export async function getSupervisor(employeeName) {
  const { data: emp } = await supabase
    .from('employees')
    .select('id, supervisor_id')
    .eq('name', employeeName)
    .eq('status', '在職')
    .maybeSingle()

  if (!emp) return null
  if (emp.supervisor_id) return getSupervisorById(emp.id)
  return null
}

// 找到審核鏈（往上找到有特定權限的人）
export async function getApprovalChain(employeeNameOrId, permissionCode) {
  const chain = []
  const visited = new Set()

  // Resolve to ID if name was passed
  let currentId = typeof employeeNameOrId === 'number' ? employeeNameOrId : null
  if (!currentId) {
    const { data: rows } = await supabase
      .from('employees').select('id').eq('name', employeeNameOrId).eq('status', '在職')
    // Guard: ambiguous name match across org — cannot safely pick one approver
    if (!rows?.length || rows.length > 1) return chain
    currentId = rows[0].id
  }
  if (!currentId) return chain

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const supervisor = await getSupervisorById(currentId)
    if (!supervisor) break

    // Check if supervisor has the required permission
    if (supervisor.role_id) {
      const { data: perms } = await supabase
        .from('role_permissions')
        .select('permissions(code)')
        .eq('role_id', supervisor.role_id)

      const hasPerm = (perms || []).some(p => p.permissions?.code === permissionCode)
      chain.push({ ...supervisor, hasPermission: hasPerm })
      if (hasPerm) break // Found the right approver
    }

    currentId = supervisor.id
  }

  return chain
}

// 提交簽核請求（自動找到審核人）
export async function submitForApproval(type, record, requesterNameOrId) {
  let permissionCode
  switch (type) {
    case 'leave': permissionCode = 'leave.approve'; break
    case 'pr': permissionCode = 'pr.approve'; break
    default: permissionCode = 'leave.approve'
  }

  const chain = await getApprovalChain(requesterNameOrId, permissionCode)

  if (chain.length === 0) {
    return { approver: null, chain, record, error: 'No approval chain found — no supervisors configured' }
  }

  // Resolve requester name for self-approval check
  let requesterName = typeof requesterNameOrId === 'string' ? requesterNameOrId : null
  if (!requesterName) {
    const { data: emp } = await supabase
      .from('employees').select('name').eq('id', requesterNameOrId).maybeSingle()
    requesterName = emp?.name
  }

  // Find a valid approver: must have the permission and must not be the requester
  let approver = chain.find(c => c.hasPermission && c.name !== requesterName)

  // Fallback: if no one with permission found (excluding self), try last in chain
  if (!approver) {
    const fallback = chain[chain.length - 1]
    if (fallback && fallback.name !== requesterName) {
      approver = fallback
    }
  }

  if (!approver) {
    return { approver: null, chain, record, error: 'No valid approver found' }
  }

  return { approver, chain, record }
}
