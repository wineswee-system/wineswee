/**
 * Pre-built React Query hooks for the most cross-page Supabase queries.
 *
 * Usage — replace the typical pattern:
 *   const [employees, setEmployees] = useState([])
 *   useEffect(() => { getActiveEmployees(orgId).then(r => setEmployees(r.data ?? [])) }, [orgId])
 *
 * With:
 *   const { data: employees = [] } = useActiveEmployees(orgId)
 *
 * Data is cached for 5 minutes (staleTime in queryClient.js) and shared across
 * all components that call the same hook with the same orgId — no duplicate
 * network requests when multiple components mount on the same page.
 *
 * After a mutation, call the matching invalidate helper so the next render
 * sees fresh data without requiring a full page reload.
 */
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '../queryClient'
import { getActiveEmployees, getEmployees } from '../db/employees'
import { getCompanies } from '../db/org'

// ── Query keys ────────────────────────────────────────────────────────────────
// All org-scoped keys share the ['org', orgId] prefix so invalidateAllOrgQueries
// can use React Query's native prefix matching instead of Array.includes().

export const QUERY_KEYS = {
  activeEmployees: (orgId) => ['org', orgId, 'activeEmployees'],
  employees:       (orgId) => ['org', orgId, 'employees'],
  companies:       (orgId) => ['org', orgId, 'companies'],
}

// ── Pre-built hooks ───────────────────────────────────────────────────────────

/** Active (在職) employees — commonly used in dropdowns and assignee lists. */
export function useActiveEmployees(orgId) {
  return useQuery({
    queryKey: QUERY_KEYS.activeEmployees(orgId),
    queryFn:  () => getActiveEmployees(undefined, orgId).then(r => {
      if (r.error) throw r.error
      return r.data ?? []
    }),
    enabled:  !!orgId,
  })
}

/** Full employee list including all statuses. */
export function useEmployees(orgId) {
  return useQuery({
    queryKey: QUERY_KEYS.employees(orgId),
    queryFn:  () => getEmployees(orgId).then(r => {
      if (r.error) throw r.error
      return r.data ?? []
    }),
    enabled:  !!orgId,
  })
}

/** Companies under this org. */
export function useCompanies(orgId) {
  return useQuery({
    queryKey: QUERY_KEYS.companies(orgId),
    queryFn:  () => getCompanies(orgId).then(r => {
      if (r.error) throw r.error
      return r.data ?? []
    }),
    enabled:  !!orgId,
  })
}

// ── Generic hook ──────────────────────────────────────────────────────────────

/**
 * Generic wrapper for one-off queries that don't have a pre-built hook yet.
 *
 * @param {unknown[]} queryKey  - React Query cache key array, e.g. ['workflows', orgId]
 * @param {() => Promise<any>} queryFn - async function returning the data
 * @param {object} [opts]       - additional useQuery options
 *
 * @example
 *   const { data: workflows = [] } = useDbQuery(
 *     ['workflows', orgId],
 *     () => getWorkflows({ orgId }).then(r => r.data ?? []),
 *     { enabled: !!orgId }
 *   )
 */
export function useDbQuery(queryKey, queryFn, opts = {}) {
  return useQuery({ queryKey, queryFn, ...opts })
}

// ── Invalidation helpers ──────────────────────────────────────────────────────

/** Call after creating / updating / deleting an employee. */
export function invalidateEmployees(orgId) {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activeEmployees(orgId) })
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.employees(orgId) })
}

/** Call after creating / updating / deleting a company. */
export function invalidateCompanies(orgId) {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.companies(orgId) })
}

/** Invalidate every cached query scoped to this org (use after bulk operations). */
export function invalidateAllOrgQueries(orgId) {
  queryClient.invalidateQueries({ queryKey: ['org', orgId] })
}
