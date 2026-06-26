// 由綁定表單(task_form_bindings) 推導「去填寫」的應用內路徑。
// TaskFormsTab.navTo（開新分頁）與 FillFormModal（iframe inline）共用，避免兩份邏輯漂移。

export const applyTypeFor = (ft) =>
  ft === 'expense_settle' ? 'expense_apply'
  : ft === 'goods_transfer_receipt' ? 'goods_transfer_apply'
  : ft === 'order_settle' ? 'order_apply'
  : null

// 回傳路徑字串；若是「驗收/核銷段」且尚未綁申請單，且申請段未完成則回 null（鎖定）。
export function bindingFillPath(b, bindings = []) {
  // 已綁單的驗收段：直接導去對應申請單，跳過 sibling 鎖定判斷
  if (b.form_type === 'expense_settle') {
    return b.form_id ? `/process/expense-requests?focus=${b.form_id}&settle=1` : null
  }
  if (b.form_type === 'order_settle') {
    return b.form_id ? `/process/order-requests?focus=${b.form_id}&settle=1` : null
  }
  if (b.form_type === 'goods_transfer_receipt') {
    return b.form_id ? `/process/transfer-requests?focus=${b.form_id}&receipt=1` : null
  }
  return (b.form_type === 'expense_request' || b.form_type === 'expense_apply') ? `/process/expense-requests?new=1&binding_id=${b.id}`
    : (b.form_type === 'order_request' || b.form_type === 'order_apply') ? `/process/order-requests?new=1&binding_id=${b.id}`
    : b.form_type === 'expense'         ? `/process/expenses?new=1&binding_id=${b.id}`
    : b.form_type === 'store_audit'     ? `/process/store-audits?new=1&binding_id=${b.id}`
    : (b.form_type === 'goods_transfer' || b.form_type === 'goods_transfer_apply') ? `/process/transfer-requests?new=1&binding_id=${b.id}`
    : `/process/forms/custom/${b.form_template_id}?binding_id=${b.id}`
}

// 同一路徑加上 embedded 旗標（iframe 用）。
export function embeddedFillPath(b, bindings = []) {
  const p = bindingFillPath(b, bindings)
  if (!p) return null
  return p + (p.includes('?') ? '&' : '?') + 'embedded=1'
}
