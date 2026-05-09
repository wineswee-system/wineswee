// Confirm 對話框：取代瀏覽器原生 confirm()，可從任意地方呼叫
//
// 用法：
//   import { confirm } from '@/lib/confirm'
//   if (await confirm({ message: '確定取消此申請？' })) { ... }
//   if (await confirm({ message: '刪除後不可復原', danger: true, confirmLabel: '刪除' })) { ... }
//
// 在 App 根放 <ConfirmDialog /> 元件監聽全域狀態。

let internalSetState = null
let internalResolver = null

export function confirm(opts) {
  return new Promise((resolve) => {
    internalResolver = resolve
    if (internalSetState) {
      internalSetState({
        open: true,
        title: opts?.title ?? '確認',
        message: opts?.message ?? '',
        description: opts?.description ?? '',
        confirmLabel: opts?.confirmLabel ?? '確定',
        cancelLabel: opts?.cancelLabel ?? '取消',
        danger: !!opts?.danger,
      })
    } else {
      // 還沒 mount ConfirmDialog 退化成 native confirm（不該發生，安全網）
      const ok = window.confirm(opts?.message || '確定？')
      resolve(ok)
    }
  })
}

export function _registerConfirmState(setter) {
  internalSetState = setter
}

export function _resolveConfirm(value) {
  if (internalResolver) {
    const r = internalResolver
    internalResolver = null
    r(value)
  }
  if (internalSetState) internalSetState({ open: false })
}
