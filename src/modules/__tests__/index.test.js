import { describe, it, expect } from 'vitest'
import { DEFS, ALL_MODULES } from '../index'

describe('module registry (DEFS / ALL_MODULES)', () => {
  it('DEFS and ALL_MODULES have the same length', () => {
    expect(ALL_MODULES).toHaveLength(DEFS.length)
  })

  it('every module has basePath starting with /, perm field, and component', () => {
    for (const m of ALL_MODULES) {
      expect(m.basePath).toMatch(/^\//)
      expect(Object.prototype.hasOwnProperty.call(m, 'perm')).toBe(true)
      expect(m.component).toBeDefined()
    }
  })

  it('every DEFS entry has a load function', () => {
    for (const d of DEFS) {
      expect(typeof d.load).toBe('function')
    }
  })

  it('ALL_MODULES does not expose load (stripped before export)', () => {
    for (const m of ALL_MODULES) {
      expect(m).not.toHaveProperty('load')
    }
  })

  it('DEFS basePaths match ALL_MODULES basePaths in order', () => {
    expect(DEFS.map(d => d.basePath)).toEqual(ALL_MODULES.map(m => m.basePath))
  })

  it('alsoBase modules are /analytics, /sales, /pos', () => {
    const alsoBase = ALL_MODULES.filter(m => m.alsoBase).map(m => m.basePath)
    expect(alsoBase).toContain('/analytics')
    expect(alsoBase).toContain('/sales')
    expect(alsoBase).toContain('/pos')
  })

  it('/super-admin is superAdminOnly', () => {
    const sa = ALL_MODULES.find(m => m.basePath === '/super-admin')
    expect(sa.superAdminOnly).toBe(true)
  })

  it('/process has subRoutes for settings with nav.project.admin perm', () => {
    const proc = ALL_MODULES.find(m => m.basePath === '/process')
    expect(proc.subRoutes).toHaveLength(1)
    expect(proc.subRoutes[0].path).toBe('settings/*')
    expect(proc.subRoutes[0].perm).toBe('nav.project.admin')
  })

  it('/finance has perm finance.view', () => {
    const fin = ALL_MODULES.find(m => m.basePath === '/finance')
    expect(fin.perm).toBe('finance.view')
  })

  it('/system has perm system.admin', () => {
    const sys = ALL_MODULES.find(m => m.basePath === '/system')
    expect(sys.perm).toBe('system.admin')
  })

  it('basePaths are unique', () => {
    const paths = ALL_MODULES.map(m => m.basePath)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
