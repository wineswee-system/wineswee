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
import { logAudit } from './auditLogger'
import { logger } from './logger'

export function useAuditLog() {
  const { profile } = useAuth()
  const userName = profile?.name || '系統'
  const orgId = profile?.organization_id

  const logAction = useCallback(async (action, targetTable, targetId, description) => {
    try {
      await logAudit({
        user: userName,
        action,
        target: description || (targetId != null ? `${targetTable}#${targetId}` : targetTable),
        targetTable,
        targetId,
        orgId,
      })
    } catch (err) {
      logger.warn('Audit log failed', { module: 'useAuditLog', err: err?.message })
    }
  }, [userName, orgId])

  const logFieldChange = useCallback(async (targetTable, targetId, fieldName, oldValue, newValue, description) => {
    try {
      await logAudit({
        user: userName,
        action: '修改',
        target: description || (targetId != null ? `${targetTable}#${targetId}` : targetTable),
        targetTable,
        targetId,
        fieldName,
        oldValue: String(oldValue ?? ''),
        newValue: String(newValue ?? ''),
        orgId,
      })
    } catch (err) {
      logger.warn('Audit log failed', { module: 'useAuditLog', err: err?.message })
    }
  }, [userName, orgId])

  return { logAction, logFieldChange }
}
