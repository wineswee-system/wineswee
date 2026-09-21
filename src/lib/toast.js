// Toast 統一介面：包 sonner 提供有預設訊息 + 中文友善 API
//
// 用法：
//   import { toast } from '@/lib/toast'
//   toast.success('已送出')
//   toast.error('操作失敗', { description: e.message })
//   toast.info('提示文字')
//   toast.warning('注意')
//   toast.promise(savePromise, { loading: '儲存中…', success: '已儲存', error: '儲存失敗' })
//   toast.dismiss(id)
//
// 錯誤處理常用 helper：
//   try { await action() } catch (e) { toast.error('操作失敗', { description: e.message }) }
//
// 不要在 toast 訊息塞 URL（防未來換網址 + 安全考量）；詳情透過 description 顯示

import { toast as sonnerToast } from 'sonner'

const DEFAULTS = {
  duration: 3500,            // success / info 預設 3.5 秒
  errorDuration: 6000,       // error 久一點讓使用者讀
  position: 'top-right',
}

function withDefaults(opts = {}, fallbackDuration = DEFAULTS.duration) {
  return { duration: fallbackDuration, ...opts }
}

export const toast = {
  success: (message, opts) => sonnerToast.success(message, withDefaults(opts)),
  error:   (message, opts) => sonnerToast.error(message, withDefaults(opts, DEFAULTS.errorDuration)),
  info:    (message, opts) => sonnerToast.info(message, withDefaults(opts)),
  warning: (message, opts) => sonnerToast.warning(message, withDefaults(opts)),
  message: (message, opts) => sonnerToast(message, withDefaults(opts)),
  loading: (message, opts) => sonnerToast.loading(message, opts),
  dismiss: (id) => sonnerToast.dismiss(id),

  /**
   * Promise 自動切換 loading → success / error
   * @example
   *   toast.promise(supabase.from('x').insert({...}), {
   *     loading: '儲存中…',
   *     success: '已儲存',
   *     error: (err) => `儲存失敗：${err.message || ''}`,
   *   })
   */
  promise: (promise, opts) => sonnerToast.promise(promise, opts),
}

export const TOAST_POSITION = DEFAULTS.position
