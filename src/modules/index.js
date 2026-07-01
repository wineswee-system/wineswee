import { lazy } from 'react'

// Each entry defines the module's routing manifest plus its raw `load` function.
// Adding a new module: one entry here. Zero edits to App.jsx or prefetch.js.
//
// manifest fields:
//   basePath      — route prefix
//   perm          — nav.* permission code that gates this module (null = all users)
//   alsoBase      — also register exact /basePath route (e.g. /analytics)
//   superAdminOnly — gated by isSuperAdmin instead of perm
//   subRoutes     — [{path, perm}] for sub-paths needing a different permission
//   load          — raw dynamic import (Vite requires static strings for code-splitting)

export const DEFS = [
  { basePath: '/hr',            perm: null,                   load: () => import('./HRModule') },
  { basePath: '/crm',           perm: 'nav.group.crm',        load: () => import('./CRMModule') },
  { basePath: '/finance',       perm: 'finance.view',         load: () => import('./FinanceModule') },
  { basePath: '/analytics',     perm: 'nav.group.analytics',  alsoBase: true, load: () => import('./AnalyticsModule') },
  { basePath: '/purchase',      perm: 'nav.group.supply',     load: () => import('./PurchaseModule') },
  { basePath: '/wms',           perm: 'nav.group.supply',     load: () => import('./WMSModule') },
  { basePath: '/manufacturing', perm: 'nav.group.supply',     load: () => import('./ManufacturingModule') },
  { basePath: '/sales',         perm: 'nav.group.crm',        alsoBase: true, load: () => import('./SalesModule') },
  { basePath: '/pos',           perm: null,    alsoBase: true, load: () => import('./POSModule') },
  { basePath: '/org',           perm: null,                   load: () => import('./OrgModule') },
  // 不要用 subRoutes 把 /process/settings/* 切出來 —
  // renderModule 的 subRoute outer 會吃 /process/settings/，剩下 'chains'，
  // 但 ProcessModule inner Route 寫 'settings/chains'，對不齊 → 全部空白。
  // 權限改在頁面內擋（isAdmin / isSuperAdmin）。
  { basePath: '/process',       perm: 'nav.project.work',     load: () => import('./ProcessModule') },
  { basePath: '/system',        perm: 'system.admin',         load: () => import('./SystemModule') },
  { basePath: '/ai',            perm: 'nav.project.admin',    load: () => import('./AIModule') },
  { basePath: '/integration',   perm: 'system.admin',         load: () => import('./IntegrationModule') },
  { basePath: '/lms',           perm: null,                   load: () => import('./LMSModule') },
  { basePath: '/reservations',  perm: null,    alsoBase: true, load: () => import('./ReservationModule') },
  { basePath: '/super-admin',   perm: null,    superAdminOnly: true, load: () => import('./SuperAdminModule') },
  { basePath: '/comms',         perm: null,    alsoBase: true,       load: () => import('./CommsModule') },
  { basePath: '/dispatch',      perm: 'dispatch.view', alsoBase: true, load: () => import('./DispatchModule') },
]

export const ALL_MODULES = DEFS.map(({ load, ...rest }) => ({
  ...rest,
  component: lazy(load),
}))
