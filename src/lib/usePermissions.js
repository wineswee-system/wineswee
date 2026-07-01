import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * useModulePermissions — 統整各頁面重複的權限判斷樣板。
 *
 * 取代散落在 ~68 個頁面的：
 *   const { hasPermission } = useAuth()
 *   const canEdit = hasPermission('finance.edit')
 *   const canDelete = hasPermission('finance.delete')
 *   ...
 *
 * 用法（增量採用，既有頁面不強制改寫）：
 *   import { useModulePermissions } from '../../lib/usePermissions'
 *   const { canView, canEdit, canDelete, canApprove } = useModulePermissions('finance')
 *
 * 權限碼格式沿用 AuthContext.hasPermission(code) 的 `<module>.<action>`
 * （例：'finance.edit'、'schedule.edit'）。super_admin 角色在
 * hasPermission 內部一律回傳 true，此處不需特判。
 *
 * 注意：AuthContext 的 hasPermission 是 useCallback，依 permissions/role
 * 變動而變 — 放進 useMemo deps 可在權限載入完成後自動重算。
 *
 * @param {string} moduleName 權限碼的模組前綴（如 'finance'、'hr_form'、'schedule'）
 * @returns {{ canView: boolean, canEdit: boolean, canDelete: boolean, canApprove: boolean }}
 */
export function useModulePermissions(moduleName) {
  const { hasPermission } = useAuth()
  return useMemo(() => ({
    canView: hasPermission(`${moduleName}.view`),
    canEdit: hasPermission(`${moduleName}.edit`),
    canDelete: hasPermission(`${moduleName}.delete`),
    canApprove: hasPermission(`${moduleName}.approve`),
  }), [hasPermission, moduleName])
}
