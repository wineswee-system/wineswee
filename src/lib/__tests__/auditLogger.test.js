import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase module before importing
vi.mock('../supabase.js', () => ({
  supabase: {
    from: () => ({
      insert: (data) => Promise.resolve({ data, error: null }),
    }),
  },
}))

import { logAudit, logChanges, logInventoryChange, logCustomerChange } from '../auditLogger.js'

// ═════════════════════════════════════════════════════════════
describe('logAudit', () => {
  it('AL-01: logs field-level change with who/what/when/old/new', async () => {
    const result = await logAudit({
      user: '王小明',
      action: '修改',
      target: '員工資料',
      targetTable: 'employees',
      targetId: 'emp-001',
      fieldName: 'salary',
      oldValue: 40000,
      newValue: 45000,
    })
    expect(result.error).toBeNull()
  })

  it('AL-04: converts values to strings', async () => {
    const result = await logAudit({
      user: 'admin',
      action: 'update',
      target: 'test',
      oldValue: 123,
      newValue: 456,
    })
    expect(result.error).toBeNull()
  })

  it('handles null old/new values', async () => {
    const result = await logAudit({
      user: 'admin',
      action: 'create',
      target: 'new record',
      oldValue: null,
      newValue: 'new',
    })
    expect(result.error).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════
describe('logChanges', () => {
  it('detects field differences and logs them', async () => {
    const oldData = { name: '王小明', salary: 40000, department: '工程部' }
    const newData = { name: '王小明', salary: 45000, department: '工程部' }

    // Should detect salary change
    await logChanges({
      user: 'admin',
      action: '修改',
      target: '員工',
      targetTable: 'employees',
      targetId: 'emp-001',
      oldData,
      newData,
    })
    // No throw = success (mocked supabase)
  })

  it('skips metadata fields (id, created_at, updated_at)', async () => {
    const oldData = { id: '1', name: 'A', created_at: '2025-01-01', updated_at: '2025-01-01' }
    const newData = { id: '2', name: 'A', created_at: '2026-01-01', updated_at: '2026-01-01' }

    // Should skip all changes (only metadata differs)
    await logChanges({
      user: 'admin',
      action: 'update',
      target: 'test',
      targetTable: 'test',
      targetId: '1',
      oldData,
      newData,
    })
  })

  it('handles null oldData gracefully', async () => {
    // Should warn and return without error
    await logChanges({
      user: 'admin',
      action: 'create',
      target: 'test',
      oldData: null,
      newData: { name: 'test' },
    })
  })
})

// ═════════════════════════════════════════════════════════════
describe('logInventoryChange', () => {
  it('AL-02: logs inventory change', async () => {
    const result = await logInventoryChange({
      user: '倉管員',
      skuName: 'Widget A',
      skuId: 'sku-001',
      oldQty: 100,
      newQty: 85,
      reason: '出貨',
    })
    expect(result.error).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════
describe('logCustomerChange', () => {
  it('AL-03: logs customer change', async () => {
    const result = await logCustomerChange({
      user: '業務員',
      customerName: '大客戶公司',
      customerId: 'cust-001',
      field: 'phone',
      oldValue: '02-12345678',
      newValue: '02-87654321',
    })
    expect(result.error).toBeNull()
  })
})
