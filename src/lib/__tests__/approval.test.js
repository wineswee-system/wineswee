import { describe, it, expect, vi } from 'vitest'

// Mock supabase module
// 註：schema 已從 employees.supervisor (text name) 改成 supervisor_id (FK)
//     mock 同步用 supervisor_id 數字，跟 src/lib/approval.js 的實際 query 對齊
vi.mock('../supabase.js', () => {
  const employees = [
    { id: 1, name: '張小華', supervisor_id: 2, status: '在職', role_id: 'employee', email: 'a@x.com' },
    { id: 2, name: '李經理', supervisor_id: 3, status: '在職', role_id: 'manager',  email: 'b@x.com' },
    { id: 3, name: '王總監', supervisor_id: null, status: '在職', role_id: 'director', email: 'c@x.com' },
  ]

  const permissions = {
    manager:  [{ permissions: { code: 'leave.approve' } }],
    director: [{ permissions: { code: 'leave.approve' } }, { permissions: { code: 'pr.approve' } }],
    employee: [],
  }

  const mockFrom = (table) => ({
    select: () => {
      if (table === 'role_permissions') {
        return {
          eq: (_field, value) => Promise.resolve({ data: permissions[value] || [] }),
        }
      }
      return {
        eq: (field, value) => {
          const lv1 = employees.filter(e => e[field] === value)
          return Object.assign(Promise.resolve({ data: lv1 }), {
            maybeSingle: () => Promise.resolve({ data: lv1[0] ?? null }),
            eq: (f2, v2) => {
              const lv2 = lv1.filter(e => e[f2] === v2)
              return Object.assign(Promise.resolve({ data: lv2 }), {
                maybeSingle: () => Promise.resolve({ data: lv2[0] ?? null }),
              })
            },
          })
        },
      }
    },
  })

  return {
    supabase: {
      from: (table) => mockFrom(table),
    },
  }
})

import { getSupervisor, getApprovalChain, submitForApproval } from '../approval.js'

// ═════════════════════════════════════════════════════════════
describe('getSupervisor', () => {
  it('AP-01: returns supervisor for employee', async () => {
    const supervisor = await getSupervisor('張小華')
    expect(supervisor).toBeDefined()
    expect(supervisor.name).toBe('李經理')
  })

  it('returns null for top-level (no supervisor)', async () => {
    const supervisor = await getSupervisor('王總監')
    expect(supervisor).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════
describe('getApprovalChain', () => {
  it('AP-02: builds chain up to permission holder', async () => {
    const chain = await getApprovalChain('張小華', 'leave.approve')
    expect(chain.length).toBeGreaterThanOrEqual(1)
    // Manager should have leave.approve
    const approver = chain.find(c => c.hasPermission)
    expect(approver).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════
describe('submitForApproval', () => {
  it('AP-03: submits and finds approver', async () => {
    const result = await submitForApproval('leave', { days: 3 }, '張小華')
    expect(result.approver).toBeDefined()
    expect(result.approver.name).not.toBe('張小華') // No self-approval
  })

  it('AP-04: routes to correct permission for PR', async () => {
    const result = await submitForApproval('pr', { amount: 50000 }, '張小華')
    // PR approval should route to someone with pr.approve
    expect(result.chain.length).toBeGreaterThan(0)
  })
})
