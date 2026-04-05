/**
 * Audit logging hook for consistent logging across all modules.
 * Wraps auditLogger.js with auth context integration.
 *
 * Usage:
 *   const { logAction, logFieldChange } = useAuditLog()
 *   await logAction('建立', 'purchase_orders', orderId, 'PO-2026-001')
 *   await logFieldChange('purchase_orders', orderId, 'status', '待確認', '已確認')
 */
import { useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { logAudit, logChanges } from './auditLogger'

export function useAuditLog() {
  const { profile } = useAuth()
  const userName = profile?.name || '系統'

  const logAction = useCallback(async (action, targetTable, targetId, description) => {
    try {
      await logAudit({
        user: userName,
        action,
        target: description || `${targetTable}#${targetId}`,
        target_table: targetTable,
        target_id: targetId,
      })
    } catch (err) {
      console.warn('Audit log failed:', err)
    }
  }, [userName])

  const logFieldChange = useCallback(async (targetTable, targetId, fieldName, oldValue, newValue) => {
    try {
      await logChanges({
        user: userName,
        action: '修改',
        target_table: targetTable,
        target_id: targetId,
        field_name: fieldName,
        old_value: String(oldValue ?? ''),
        new_value: String(newValue ?? ''),
      })
    } catch (err) {
      console.warn('Audit log failed:', err)
    }
  }, [userName])

  return { logAction, logFieldChange }
}
