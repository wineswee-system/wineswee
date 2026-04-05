import { supabase } from './supabase'

/**
 * 強化型稽核日誌
 * 記錄：誰 / 什麼時候 / 改了什麼表 / 哪一筆 / 哪個欄位 / 原值 / 新值
 */

// 記錄單一操作
export async function logAudit({ user, action, target, targetTable, targetId, fieldName, oldValue, newValue, ip }) {
  const { data, error } = await supabase.from('audit_logs').insert({
    user,
    action,
    target,
    target_table: targetTable,
    target_id: targetId,
    field_name: fieldName,
    old_value: oldValue != null ? String(oldValue) : null,
    new_value: newValue != null ? String(newValue) : null,
    ip: ip || null,
  })
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

// 比較兩個物件差異並批次記錄
export async function logChanges({ user, action, target, targetTable, targetId, oldData, newData, ip }) {
  if (!oldData || !newData) {
    console.warn(`logChanges: skipping — missing ${!oldData ? 'oldData' : ''}${!oldData && !newData ? ' and ' : ''}${!newData ? 'newData' : ''} for ${targetTable || 'unknown table'} (target: ${target || 'unknown'})`)
    return
  }

  const changes = []
  for (const key of Object.keys(newData)) {
    const oldVal = oldData[key]
    const newVal = newData[key]
    // Skip metadata fields
    if (['id', 'created_at', 'updated_at'].includes(key)) continue
    // Compare
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      changes.push({
        user,
        action,
        target: `${target} - ${key}`,
        target_table: targetTable,
        target_id: targetId,
        field_name: key,
        old_value: oldVal != null ? String(oldVal) : null,
        new_value: newVal != null ? String(newVal) : null,
        ip,
      })
    }
  }

  if (changes.length > 0) {
    return supabase.from('audit_logs').insert(changes)
  }
}

// 記錄庫存變更（WMS 專用）
export async function logInventoryChange({ user, skuName, skuId, oldQty, newQty, reason, ip }) {
  return logAudit({
    user,
    action: '庫存調整',
    target: `${skuName}: ${oldQty} → ${newQty}`,
    targetTable: 'stock_levels',
    targetId: skuId,
    fieldName: 'quantity',
    oldValue: oldQty,
    newValue: newQty,
    ip,
  })
}

// 記錄客戶資料變更（CRM 專用）
export async function logCustomerChange({ user, customerName, customerId, field, oldValue, newValue, ip }) {
  return logAudit({
    user,
    action: '客戶資料修改',
    target: `${customerName} - ${field}`,
    targetTable: 'customers',
    targetId: customerId,
    fieldName: field,
    oldValue,
    newValue,
    ip,
  })
}
