import { supabase } from './supabase'

/**
 * 敏感資料遮蔽 (Data Masking)
 * 根據使用者角色決定是否顯示完整資料
 */

// 遮蔽手機號碼: 0912-345-678 → 0912-***-678
export function maskPhone(phone) {
  if (!phone) return '-'
  // Handle format: 0912-345-678
  if (phone.includes('-')) {
    const parts = phone.split('-')
    if (parts.length === 3) return `${parts[0]}-***-${parts[2]}`
    return phone.replace(/(\d{4}).*(\d{3})$/, '$1-***-$2')
  }
  // Handle format: 0912345678
  if (phone.length >= 8) return phone.slice(0, 4) + '****' + phone.slice(-3)
  return '****'
}

// 遮蔽 Email: john@company.com → j***@company.com
export function maskEmail(email) {
  if (!email) return '-'
  const [name, domain] = email.split('@')
  if (!domain) return '***'
  return `${name[0]}***@${domain}`
}

// 遮蔽身分證: A123456789 → A1234*****
export function maskIdNumber(id) {
  if (!id) return '-'
  if (id.length >= 6) return id.slice(0, 5) + '*'.repeat(id.length - 5)
  return '***'
}

// 遮蔽地址: 台北市信義區信義路五段7號 → 台北市信義區***
export function maskAddress(addr) {
  if (!addr) return '-'
  // Keep city + district, mask the rest
  const match = addr.match(/^(.{2,3}[市縣])(.{2,3}[區鎮鄉市])/)
  if (match) return `${match[1]}${match[2]}***`
  if (addr.length > 6) return addr.slice(0, 6) + '***'
  return '***'
}

// 檢查使用者是否有查看完整資料的權限
export async function canViewFullData(userId, permissionCode = 'employee.view_full') {
  if (!userId) return false

  // Get user's role
  const { data: emp } = await supabase
    .from('employees')
    .select('role_id')
    .eq('id', userId)
    .maybeSingle()

  if (!emp?.role_id) return false

  // Check permission
  const { data: perms } = await supabase
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', emp.role_id)

  return (perms || []).some(p => p.permissions?.code === permissionCode)
}

// 根據權限決定是否遮蔽
export function applyMasking(value, type, hasPermission) {
  if (hasPermission) return value
  switch (type) {
    case 'phone': return maskPhone(value)
    case 'email': return maskEmail(value)
    case 'id': return maskIdNumber(value)
    case 'address': return maskAddress(value)
    default: return value
  }
}
