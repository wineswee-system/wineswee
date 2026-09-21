import { describe, it, expect } from 'vitest'
import { Navigate, Route } from 'react-router-dom'
import { renderModule } from '../modules/renderModule'

// React.createElement doesn't render — elements are plain descriptor objects.
// We can inspect .type and .props without a Router context.

const Comp = () => null
const grant = () => true
const deny  = () => false

describe('renderModule', () => {
  describe('simple module (no flags)', () => {
    it('returns one wildcard route', () => {
      const routes = renderModule(
        { basePath: '/hr', perm: null, component: Comp },
        { canAccess: grant, canAccessWithPerm: grant, isSuperAdmin: false }
      )
      expect(routes).toHaveLength(1)
      expect(routes[0].props.path).toBe('/hr/*')
    })

    it('mounts Comp when canAccess returns true', () => {
      const routes = renderModule(
        { basePath: '/hr', perm: null, component: Comp },
        { canAccess: grant, canAccessWithPerm: grant, isSuperAdmin: false }
      )
      expect(routes[0].props.element.type).toBe(Comp)
    })

    it('redirects to / when canAccess returns false', () => {
      const routes = renderModule(
        { basePath: '/hr', perm: null, component: Comp },
        { canAccess: deny, canAccessWithPerm: deny, isSuperAdmin: false }
      )
      expect(routes[0].props.element.type).toBe(Navigate)
      expect(routes[0].props.element.props.to).toBe('/')
    })
  })

  describe('alsoBase flag', () => {
    it('returns exact basePath route followed by wildcard', () => {
      const routes = renderModule(
        { basePath: '/analytics', perm: 'nav.group.analytics', alsoBase: true, component: Comp },
        { canAccess: grant, canAccessWithPerm: grant, isSuperAdmin: false }
      )
      expect(routes).toHaveLength(2)
      expect(routes[0].props.path).toBe('/analytics')
      expect(routes[1].props.path).toBe('/analytics/*')
    })

    it('blocks exact route when canAccessWithPerm returns false', () => {
      const routes = renderModule(
        { basePath: '/analytics', perm: 'nav.group.analytics', alsoBase: true, component: Comp },
        { canAccess: grant, canAccessWithPerm: deny, isSuperAdmin: false }
      )
      expect(routes[0].props.element.type).toBe(Navigate)
    })
  })

  describe('subRoutes', () => {
    const manifest = {
      basePath: '/process', perm: null,
      subRoutes: [{ path: 'settings/*', perm: 'nav.project.admin' }],
      component: Comp,
    }

    it('returns sub-route before wildcard', () => {
      const routes = renderModule(manifest, { canAccess: grant, canAccessWithPerm: grant, isSuperAdmin: false })
      expect(routes).toHaveLength(2)
      expect(routes[0].props.path).toBe('/process/settings/*')
      expect(routes[1].props.path).toBe('/process/*')
    })

    it('blocks sub-route when canAccessWithPerm returns false, passes wildcard', () => {
      const routes = renderModule(manifest, { canAccess: grant, canAccessWithPerm: deny, isSuperAdmin: false })
      expect(routes[0].props.element.type).toBe(Navigate)
      expect(routes[1].props.element.type).toBe(Comp)
    })
  })

  describe('superAdminOnly flag', () => {
    const manifest = { basePath: '/super-admin', perm: null, superAdminOnly: true, component: Comp }

    it('mounts Comp when isSuperAdmin is true (ignores canAccess)', () => {
      const routes = renderModule(manifest, { canAccess: deny, canAccessWithPerm: deny, isSuperAdmin: true })
      expect(routes[0].props.element.type).toBe(Comp)
    })

    it('blocks when isSuperAdmin is false (ignores canAccess returning true)', () => {
      const routes = renderModule(manifest, { canAccess: grant, canAccessWithPerm: grant, isSuperAdmin: false })
      expect(routes[0].props.element.type).toBe(Navigate)
    })
  })
})
