import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock supabase：可鏈式 query builder，記錄所有呼叫 ─────────
const h = vi.hoisted(() => ({
  calls: [],
  result: { data: null, error: null },
}))

vi.mock('../supabase', () => {
  const chain = {}
  const record = (m) => (...args) => {
    h.calls.push([m, ...args])
    return m === 'single' ? Promise.resolve(h.result) : chain
  }
  for (const m of ['select', 'eq', 'order', 'limit', 'update', 'single']) chain[m] = record(m)
  return {
    supabase: {
      from: (...args) => { h.calls.push(['from', ...args]); return chain },
    },
  }
})

import {
  mapSafetyStockFields,
  getSkuSafetyStocks,
  updateSkuSafetyStock,
  bulkUpdateSkuSafetyStock,
} from '../db/safetyStock.js'

beforeEach(() => {
  h.calls.length = 0
  h.result = { data: null, error: null }
})

const callsOf = (method) => h.calls.filter(c => c[0] === method)

// ═════════════════════════════════════════════════════════════
describe('mapSafetyStockFields（欄位映射）', () => {
  it('字串數字轉 Number、空字串/undefined/null → null', () => {
    expect(mapSafetyStockFields({ safety_stock: '12.5', reorder_point: '', reorder_qty: 50 }))
      .toEqual({ safety_stock: 12.5, reorder_point: null, reorder_qty: 50 })
    expect(mapSafetyStockFields({ safety_stock: null }))
      .toEqual({ safety_stock: null, reorder_point: null, reorder_qty: null })
    expect(mapSafetyStockFields({}))
      .toEqual({ safety_stock: null, reorder_point: null, reorder_qty: null })
  })

  it('非數字字串不寫入（→ null），不產生 NaN', () => {
    const mapped = mapSafetyStockFields({ safety_stock: 'abc', reorder_point: '3x', reorder_qty: '7' })
    expect(mapped).toEqual({ safety_stock: null, reorder_point: null, reorder_qty: 7 })
  })

  it('只輸出三個安全存量欄位，其餘欄位（name/stock_qty…）一律丟棄', () => {
    const mapped = mapSafetyStockFields({ id: 3, name: '測試品', stock_qty: 99, safety_stock: 10 })
    expect(Object.keys(mapped).sort()).toEqual(['reorder_point', 'reorder_qty', 'safety_stock'])
  })
})

// ═════════════════════════════════════════════════════════════
describe('getSkuSafetyStocks（讀取）', () => {
  it('讀 skus 表、select 含三欄、僅啟用品項、org 過濾、上限 2000', () => {
    getSkuSafetyStocks(7)

    expect(callsOf('from')[0]).toEqual(['from', 'skus'])
    const selectArg = callsOf('select')[0][1]
    expect(selectArg).toContain('safety_stock')
    expect(selectArg).toContain('reorder_point')
    expect(selectArg).toContain('reorder_qty')
    expect(callsOf('eq')).toContainEqual(['eq', 'status', '啟用'])
    expect(callsOf('eq')).toContainEqual(['eq', 'organization_id', 7])
    expect(callsOf('limit')[0]).toEqual(['limit', 2000])
  })

  it('未提供 orgId 時不加 organization_id 過濾（依 RLS）', () => {
    getSkuSafetyStocks()
    expect(callsOf('eq')).not.toContainEqual(expect.arrayContaining(['eq', 'organization_id']))
  })
})

// ═════════════════════════════════════════════════════════════
describe('updateSkuSafetyStock（寫入）', () => {
  it('update payload 只含映射後三欄，並以 id 鎖定單列', async () => {
    h.result = { data: { id: 3, safety_stock: 12, reorder_point: 30, reorder_qty: 50 }, error: null }

    const { data, error } = await updateSkuSafetyStock(3, {
      safety_stock: '12', reorder_point: 30, reorder_qty: '50', name: '不該被寫入',
    })

    expect(error).toBeNull()
    expect(data.id).toBe(3)
    expect(callsOf('update')[0][1]).toEqual({ safety_stock: 12, reorder_point: 30, reorder_qty: 50 })
    expect(callsOf('eq')).toContainEqual(['eq', 'id', 3])
    expect(callsOf('single').length).toBe(1)
  })

  it('清空欄位（空字串）→ 寫入 null', async () => {
    await updateSkuSafetyStock(5, { safety_stock: '', reorder_point: '', reorder_qty: '' })
    expect(callsOf('update')[0][1]).toEqual({ safety_stock: null, reorder_point: null, reorder_qty: null })
  })
})

// ═════════════════════════════════════════════════════════════
describe('bulkUpdateSkuSafetyStock（批次套用）', () => {
  it('逐列 update，全部成功 error=null', async () => {
    h.result = { data: { id: 1 }, error: null }
    const { data, error } = await bulkUpdateSkuSafetyStock([
      { id: 1, safety_stock: 10, reorder_point: 20, reorder_qty: 30 },
      { id: 2, safety_stock: 5, reorder_point: 8, reorder_qty: 12 },
    ])
    expect(error).toBeNull()
    expect(data.length).toBe(2)
    expect(callsOf('update').length).toBe(2)
  })

  it('任一列失敗 → 回傳該 error（不靜默吞掉）', async () => {
    h.result = { data: null, error: { message: 'RLS violation' } }
    const { error } = await bulkUpdateSkuSafetyStock([{ id: 1, safety_stock: 10 }])
    expect(error).toEqual({ message: 'RLS violation' })
  })

  it('空陣列 → 不打 DB、error=null', async () => {
    const { data, error } = await bulkUpdateSkuSafetyStock([])
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(h.calls.length).toBe(0)
  })
})
