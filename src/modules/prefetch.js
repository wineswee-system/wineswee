// Module prefetch registry.
// Hover over a sidebar group → start loading its chunks in the background.
import { DEFS } from './index'

// Build loader map from the canonical DEFS list (single source of truth).
const loaderMap = Object.fromEntries(DEFS.map(d => [d.basePath, d.load]))

// Sidebar group keys → module basePaths
const groupModules = {
  people:        ['/hr', '/org', '/process'],
  analytics:     ['/analytics'],
  system:        ['/system'],
  'super-admin': ['/super-admin'],
  lms:           ['/lms'],
}

const prefetched = new Set()

export function prefetchModule(basePath) {
  if (prefetched.has(basePath)) return
  prefetched.add(basePath)
  loaderMap[basePath]?.()
}

export function prefetchGroup(groupKey) {
  ;(groupModules[groupKey] || []).forEach(prefetchModule)
}
