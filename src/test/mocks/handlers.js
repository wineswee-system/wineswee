/**
 * MSW Request Handlers — Mock Supabase REST API
 * Used for integration tests that need cross-module data flow
 */
import { http, HttpResponse } from 'msw'

const SUPABASE_URL = 'https://test.supabase.co'

// ─── In-memory data store ───────────────────────────────────
const store = {
  employees: [
    { id: '1', name: '王小明', department: '工程部', role_id: 'admin', supervisor: '李經理', status: '在職', join_date: '2023-01-15', base_salary: 45000, email: 'wang@test.com' },
    { id: '2', name: '李經理', department: '工程部', role_id: 'manager', supervisor: null, status: '在職', join_date: '2020-06-01', base_salary: 65000, email: 'lee@test.com' },
    { id: '3', name: '張小華', department: '業務部', role_id: 'employee', supervisor: '李經理', status: '在職', join_date: '2024-03-01', base_salary: 38000, email: 'zhang@test.com' },
  ],
  purchase_requests: [],
  purchase_orders: [],
  goods_receipts: [],
  accounts_payable: [],
  accounts_receivable: [],
  journal_entries: [],
  journal_lines: [],
  leave_requests: [],
  salary_records: [],
  stock_levels: [
    { id: '1', sku_name: 'Widget A', quantity: 50, unit_cost: 100, reorder_point: 20, unit: '個' },
    { id: '2', sku_name: 'Widget B', quantity: 5, unit_cost: 200, reorder_point: 10, unit: '個' },
  ],
  opportunities: [],
  audit_logs: [],
  attendance: [],
}

// ─── Helper: Supabase REST query parser ─────────────────────
function parseSupabaseQuery(url, table) {
  const u = new URL(url)
  return store[table] || []
}

// ─── Handlers ───────────────────────────────────────────────
export const handlers = [
  // Generic GET for any table
  http.get(`${SUPABASE_URL}/rest/v1/:table`, ({ params, request }) => {
    const table = params.table
    const data = store[table] || []
    return HttpResponse.json(data)
  }),

  // Generic POST (insert) for any table
  http.post(`${SUPABASE_URL}/rest/v1/:table`, async ({ params, request }) => {
    const table = params.table
    const body = await request.json()
    const records = Array.isArray(body) ? body : [body]

    const inserted = records.map(r => ({
      id: `${table}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString(),
      ...r,
    }))

    if (!store[table]) store[table] = []
    store[table].push(...inserted)

    return HttpResponse.json(inserted, { status: 201 })
  }),

  // Generic PATCH (update) for any table
  http.patch(`${SUPABASE_URL}/rest/v1/:table`, async ({ params, request }) => {
    const table = params.table
    const body = await request.json()
    const url = new URL(request.url)
    const idFilter = url.searchParams.get('id')

    if (store[table] && idFilter) {
      const id = idFilter.replace('eq.', '')
      const idx = store[table].findIndex(r => r.id === id)
      if (idx >= 0) {
        store[table][idx] = { ...store[table][idx], ...body }
        return HttpResponse.json([store[table][idx]])
      }
    }
    return HttpResponse.json([body])
  }),

  // RPC calls
  http.post(`${SUPABASE_URL}/rest/v1/rpc/:fn`, async ({ params }) => {
    return HttpResponse.json({ success: true })
  }),

  // Auth
  http.post(`${SUPABASE_URL}/auth/v1/token`, async () => {
    return HttpResponse.json({
      access_token: 'test-token',
      token_type: 'bearer',
      user: { id: 'user-1', email: 'admin@test.com', role: 'admin' },
    })
  }),

  http.get(`${SUPABASE_URL}/auth/v1/user`, () => {
    return HttpResponse.json({
      id: 'user-1',
      email: 'admin@test.com',
      role: 'admin',
    })
  }),
]

// ─── Store access for assertions in tests ───────────────────
export function getStore() { return store }
export function resetStore() {
  store.purchase_requests = []
  store.purchase_orders = []
  store.goods_receipts = []
  store.accounts_payable = []
  store.accounts_receivable = []
  store.journal_entries = []
  store.journal_lines = []
  store.leave_requests = []
  store.salary_records = []
  store.opportunities = []
  store.audit_logs = []
  store.attendance = []
}
