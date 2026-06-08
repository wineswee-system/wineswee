import { lazy } from 'react'

// Each entry defines the module's routing manifest plus its raw `load` function.
// Adding a new module: one entry here. Zero edits to App.jsx or prefetch.js.
//
// manifest fields:
//   basePath      — route prefix, also the ROLE_ROUTES canAccess key
//   perm          — extra permission code (null = ROLE_ROUTES whitelist only)
//   alsoBase      — also register exact /basePath route (e.g. /analytics)
//   superAdminOnly — guarded by isSuperAdmin instead of canAccess
//   subRoutes     — [{path, perm}] for sub-paths needing a different permission
//   load          — raw dynamic import (Vite requires static strings for code-splitting)

export const DEFS = [
  { basePath: '/hr',            perm: null,                   load: () => import('./HRModule') },
  { basePath: '/crm',           perm: null,                   load: () => import('./CRMModule') },
  { basePath: '/finance',       perm: 'finance.view',         load: () => import('./FinanceModule') },
  { basePath: '/analytics',     perm: 'nav.group.analytics',  alsoBase: true, load: () => import('./AnalyticsModule') },
  { basePath: '/purchase',      perm: null,                   load: () => import('./PurchaseModule') },
  { basePath: '/wms',           perm: null,                   load: () => import('./WMSModule') },
  { basePath: '/manufacturing', perm: null,                   load: () => import('./ManufacturingModule') },
  { basePath: '/sales',         perm: null,    alsoBase: true, load: () => import('./SalesModule') },
  { basePath: '/pos',           perm: null,    alsoBase: true, load: () => import('./POSModule') },
  { basePath: '/org',           perm: null,                   load: () => import('./OrgModule') },
  {
    basePath: '/process', perm: null,
    subRoutes: [{ path: 'settings/*', perm: 'nav.project.admin' }],
    load: () => import('./ProcessModule'),
  },
  { basePath: '/system',        perm: 'system.admin',         load: () => import('./SystemModule') },
  { basePath: '/ai',            perm: null,                   load: () => import('./AIModule') },
  { basePath: '/integration',   perm: null,                   load: () => import('./IntegrationModule') },
  { basePath: '/lms',           perm: null,                   load: () => import('./LMSModule') },
  { basePath: '/super-admin',   perm: null,    superAdminOnly: true, load: () => import('./SuperAdminModule') },
]

export const ALL_MODULES = DEFS.map(({ load, ...rest }) => ({
  ...rest,
  component: lazy(load),
}))
