// Org-scoped URL helpers.
//
// 路由結構:主要模組的網址帶入 organization id 於「模組段之後、頁面段之前」,
// 例:/org/5/overview、/crm/5/leads。super_admin 可切換 org(見 TenantContext);
// 一般使用者一律被導回自己的 org。orgId 僅為導覽/深連結用途 —— 真正的租戶隔離由 RLS 保證。
//
// 超級管理員專屬模組(super-admin / comms / dispatch)不帶 orgId。

import { DEFS } from '../modules'

// 需要帶 orgId 的模組前綴(去掉開頭 '/'),排除 superAdminOnly 工具
export const ORG_SCOPED_PREFIXES = new Set(
  DEFS.filter((d) => !d.superAdminOnly).map((d) => d.basePath.replace(/^\//, ''))
)

export function isOrgScopedPrefix(prefix) {
  return ORG_SCOPED_PREFIXES.has(String(prefix).replace(/^\//, ''))
}

const isOrgSeg = (seg) => /^\d+$/.test(seg || '')

// 將 orgId 插入(或替換)模組路徑中的 org 段。
//   withOrg('/crm/overview', 5)   -> '/crm/5/overview'
//   withOrg('/crm/9/leads', 5)    -> '/crm/5/leads'   (替換)
//   withOrg('/', 5)               -> '/'              (儀表板不帶)
//   withOrg('/super-admin/x', 5)  -> '/super-admin/x' (非 org-scoped 模組原樣返回)
export function withOrg(path, orgId) {
  if (orgId == null || !path || typeof path !== 'string') return path
  const [, first, ...rest] = path.split('/')
  if (!isOrgScopedPrefix(first)) return path
  if (rest.length && isOrgSeg(rest[0])) rest[0] = String(orgId)
  else rest.unshift(String(orgId))
  return '/' + [first, ...rest].join('/')
}

// 移除路徑中的 org 段(用於與設定檔的原始路徑比對 active 狀態)。
//   stripOrg('/crm/5/overview') -> '/crm/overview'
//   stripOrg('/crm/overview')   -> '/crm/overview'
//   stripOrg('/')               -> '/'
export function stripOrg(pathname) {
  const { orgScoped, prefix, orgId, rest } = parseOrgPath(pathname)
  if (!orgScoped || orgId == null) return pathname
  return '/' + [prefix, ...rest].join('/')
}

// 解析 pathname → { prefix, orgId(number|null), rest[] };非 org-scoped 模組回傳 orgScoped:false
export function parseOrgPath(pathname) {
  const segs = String(pathname || '').split('/').filter(Boolean)
  const first = segs[0]
  if (!first || !isOrgScopedPrefix(first)) return { orgScoped: false, prefix: first || null, orgId: null, rest: segs.slice(1) }
  if (isOrgSeg(segs[1])) return { orgScoped: true, prefix: first, orgId: Number(segs[1]), rest: segs.slice(2) }
  return { orgScoped: true, prefix: first, orgId: null, rest: segs.slice(1) }
}
