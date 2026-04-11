// Module prefetch registry
// Maps sidebar group keys to their module import functions.
// Calling prefetchGroup('commerce') will start loading CRM, Sales, POS chunks
// in the background before the user navigates there.

const moduleLoaders = {
  hr: () => import('./HRModule'),
  crm: () => import('./CRMModule'),
  finance: () => import('./FinanceModule'),
  analytics: () => import('./AnalyticsModule'),
  purchase: () => import('./PurchaseModule'),
  wms: () => import('./WMSModule'),
  manufacturing: () => import('./ManufacturingModule'),
  sales: () => import('./SalesModule'),
  pos: () => import('./POSModule'),
  org: () => import('./OrgModule'),
  process: () => import('./ProcessModule'),
  system: () => import('./SystemModule'),
  ai: () => import('./AIModule'),
  integration: () => import('./IntegrationModule'),
  superadmin: () => import('./SuperAdminModule'),
}

// Sidebar groups → module keys
const groupModules = {
  commerce: ['crm', 'sales', 'pos'],
  supply: ['purchase', 'wms', 'manufacturing'],
  finance: ['finance'],
  people: ['hr', 'org', 'process'],
  analytics: ['analytics'],
  system: ['system', 'ai', 'integration'],
  'super-admin': ['superadmin'],
}

const prefetched = new Set()

export function prefetchModule(key) {
  if (prefetched.has(key)) return
  prefetched.add(key)
  const loader = moduleLoaders[key]
  if (loader) loader()
}

export function prefetchGroup(groupKey) {
  const modules = groupModules[groupKey] || []
  modules.forEach(prefetchModule)
}
