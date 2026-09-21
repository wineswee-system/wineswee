import { supabase } from './supabase'

/**
 * 系統日誌 + 錯誤日誌工具
 * 所有日誌自動綁定 organization_id，供 Super Admin 跨組織監控
 */

function getOrgId() {
  try {
    const raw = localStorage.getItem('sme_tenant')
    if (raw) {
      const parsed = JSON.parse(raw)
      return parsed.organization_id || parsed.organization?.id || null
    }
  } catch { /* ignore */ }
  return null
}

// ── System Log ──

export async function logSystem({ level = 'info', module, action, message, user, userEmail, ip, userAgent, metadata = {} }) {
  const { error } = await supabase.from('system_logs').insert({
    organization_id: getOrgId(),
    level,
    module,
    action,
    message,
    user,
    user_email: userEmail,
    ip,
    user_agent: userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    metadata,
  })
  if (error) console.error('[systemLogger] logSystem failed:', error.message)
}

// Convenience wrappers
export const logInfo = (params) => logSystem({ ...params, level: 'info' })
export const logWarn = (params) => logSystem({ ...params, level: 'warn' })
export const logDebug = (params) => logSystem({ ...params, level: 'debug' })

// Common actions
export const logLogin = ({ user, userEmail, ip }) =>
  logInfo({ module: 'Auth', action: 'login', message: `${user} 登入系統`, user, userEmail, ip })

export const logLogout = ({ user, userEmail }) =>
  logInfo({ module: 'Auth', action: 'logout', message: `${user} 登出系統`, user, userEmail })

export const logModuleAccess = ({ user, module, path }) =>
  logDebug({ module, action: 'module_access', message: `${user} 存取 ${module}`, user, metadata: { path } })

export const logExport = ({ user, module, target, format = 'csv' }) =>
  logInfo({ module, action: 'export', message: `${user} 匯出 ${target}`, user, metadata: { target, format } })

export const logConfigChange = ({ user, module, field, oldValue, newValue }) =>
  logWarn({ module, action: 'config_change', message: `${user} 變更設定: ${field}`, user, metadata: { field, oldValue, newValue } })

// ── Error Log ──

export async function logError({ level = 'error', module, errorCode, message, stackTrace, component, url, user, userEmail, metadata = {} }) {
  const orgId = getOrgId()

  const { error } = await supabase.from('error_logs').insert({
    organization_id: orgId,
    level,
    module,
    error_code: errorCode,
    message,
    stack_trace: stackTrace,
    component,
    url: url || (typeof window !== 'undefined' ? window.location.href : null),
    user,
    user_email: userEmail,
    metadata,
  })
  if (error) console.error('[systemLogger] logError failed:', error.message)

  if (errorCode && module) {
    ;(async () => {
      try {
        const { data: prior } = await supabase
          .from('error_logs')
          .select('id, recurrence_count')
          .eq('module', module)
          .eq('error_code', errorCode)
          .eq('resolved', true)
          .order('resolved_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (prior?.id) {
          await supabase
            .from('error_logs')
            .update({ recurrence_count: (prior.recurrence_count || 0) + 1 })
            .eq('id', prior.id)
        }
      } catch { /* best effort — never mask the original error */ }
    })()
  }
}

export const logFatal = (params) => logError({ ...params, level: 'fatal' })

// ── User Activity ──

export async function logActivity({ userName, userEmail, action, module, page, target, detail, durationSec, ip, device, metadata = {} }) {
  const { error } = await supabase.from('user_activity').insert({
    organization_id: getOrgId(),
    user_name: userName,
    user_email: userEmail,
    action,
    module,
    page,
    target,
    detail,
    duration_sec: durationSec,
    ip,
    device: device || detectDevice(),
    metadata,
  })
  if (error) console.error('[systemLogger] logActivity failed:', error.message)
}

function detectDevice() {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/Mobi|Android/i.test(ua)) return 'mobile'
  if (/Tablet|iPad/i.test(ua)) return 'tablet'
  return 'desktop'
}

export const logPageView = ({ userName, module, page }) =>
  logActivity({ userName, action: 'page_view', module, page, detail: `瀏覽 ${page}` })

export const logUserAction = ({ userName, action, module, target, detail }) =>
  logActivity({ userName, action, module, target, detail })

// Global error handler — call once at app init
export function installGlobalErrorHandler() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    logError({
      module: 'Runtime',
      errorCode: 'UNCAUGHT_ERROR',
      message: event.message || 'Unknown error',
      stackTrace: event.error?.stack,
      url: event.filename,
      metadata: { lineno: event.lineno, colno: event.colno },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    logError({
      module: 'Runtime',
      errorCode: 'UNHANDLED_REJECTION',
      message: reason?.message || String(reason),
      stackTrace: reason?.stack,
    })
  })
}
