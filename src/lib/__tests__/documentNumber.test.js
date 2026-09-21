import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks（在 import 前 hoist）────────────────────────────────
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  orgId: 42,
}))

vi.mock('../supabase', () => ({
  supabase: { rpc: (...args) => h.rpc(...args) },
}))
vi.mock('../events/middleware/tenantContext', () => ({
  getTenantOrgId: () => h.orgId,
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  DOC_TYPES,
  derivePeriodKey,
  deriveDatePart,
  formatDocumentNumber,
  formatPreview,
  allocateDocumentNumber,
} from '../documentNumber.js'

const D = new Date(2026, 6, 5) // 2026-07-05（本地時區）

beforeEach(() => {
  h.rpc.mockReset()
  h.orgId = 42
})

// ═════════════════════════════════════════════════════════════
describe('DN-01: 各單據前綴/日期格式', () => {
  it('涵蓋計畫指定的 10 種單據類型與前綴', () => {
    expect(DOC_TYPES).toEqual({
      quotation: 'QT',
      sales_order: 'SO',
      purchase_request: 'PR',
      purchase_order: 'PO',
      goods_receipt: 'GR',
      sales_return: 'SR',
      sales_allowance: 'SA',
      purchase_allowance: 'PA',
      journal_entry: 'JE',
      stock_count: 'SC',
    })
  })

  it('YYYYMM 格式：prefix-年月-流水號', () => {
    const rule = { prefix: 'QT', date_format: 'YYYYMM', sequence_digits: 4 }
    expect(formatDocumentNumber(rule, 1, D)).toBe('QT-202607-0001')
    expect(formatDocumentNumber(rule, 37, D)).toBe('QT-202607-0037')
  })

  it('YYYYMMDD 格式：prefix-年月日-流水號', () => {
    const rule = { prefix: 'JE', date_format: 'YYYYMMDD', sequence_digits: 4 }
    expect(formatDocumentNumber(rule, 5, D)).toBe('JE-20260705-0005')
  })

  it('無日期段（date_format 空字串）：prefix-流水號', () => {
    const rule = { prefix: 'SO', date_format: '', sequence_digits: 4 }
    expect(formatDocumentNumber(rule, 12, D)).toBe('SO-0012')
  })

  it('月/日補零（一月、個位日）', () => {
    const jan = new Date(2026, 0, 3)
    expect(deriveDatePart({ date_format: 'YYYYMM' }, jan)).toBe('202601')
    expect(deriveDatePart({ date_format: 'YYYYMMDD' }, jan)).toBe('20260103')
  })

  it('流水號超過位數時自動加寬不截斷', () => {
    const rule = { prefix: 'SC', date_format: 'YYYYMMDD', sequence_digits: 3 }
    expect(formatDocumentNumber(rule, 12345, D)).toBe('SC-20260705-12345')
  })

  it('formatPreview 顯示 1 號的長相', () => {
    expect(formatPreview({ prefix: 'PO', date_format: 'YYYYMM', sequence_digits: 4 }, D)).toBe('PO-202607-0001')
  })
})

// ═════════════════════════════════════════════════════════════
describe('DN-02: 取號 RPC 契約（單次呼叫語義 + 錯誤路徑）', () => {
  it('一次取號 = 恰好一次 RPC，參數正確，回傳單號原文', async () => {
    h.rpc.mockResolvedValueOnce({ data: 'QT-202607-0001', error: null })

    const number = await allocateDocumentNumber('quotation')

    expect(number).toBe('QT-202607-0001')
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('allocate_document_number', {
      p_doc_type: 'quotation',
      p_org: 42,
    })
  })

  it('併發取號：每次取號各自打一次 RPC、號碼由 DB 保證不重（client 不快取不重用）', async () => {
    let seq = 0
    h.rpc.mockImplementation(() => Promise.resolve({
      data: `SO-202607-${String(++seq).padStart(4, '0')}`, error: null,
    }))

    const numbers = await Promise.all([
      allocateDocumentNumber('sales_order'),
      allocateDocumentNumber('sales_order'),
      allocateDocumentNumber('sales_order'),
    ])

    expect(h.rpc).toHaveBeenCalledTimes(3)
    expect(new Set(numbers).size).toBe(3) // 三張單三個不同號
  })

  it('RPC 回錯 → 拋出含原因的錯誤', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    await expect(allocateDocumentNumber('purchase_order'))
      .rejects.toThrow(/單據取號失敗（purchase_order）.*permission denied/)
  })

  it('RPC 回空（無 data 無 error）→ 拋出明確錯誤，不回傳 undefined', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(allocateDocumentNumber('goods_receipt'))
      .rejects.toThrow(/RPC 未回傳單號/)
  })

  it('可用 opts.orgId 顯式覆寫 org（事件 handler 場景）', async () => {
    h.rpc.mockResolvedValueOnce({ data: 'PR-202607-0002', error: null })
    await allocateDocumentNumber('purchase_request', { orgId: 99 })
    expect(h.rpc).toHaveBeenCalledWith('allocate_document_number', {
      p_doc_type: 'purchase_request',
      p_org: 99,
    })
  })
})

// ═════════════════════════════════════════════════════════════
describe('DN-03: 年/月重置循環 — derivePeriodKey', () => {
  it("reset_cycle='year' → 'YYYY'", () => {
    expect(derivePeriodKey({ reset_cycle: 'year' }, D)).toBe('2026')
  })

  it("reset_cycle='month' → 'YYYYMM'（含補零）", () => {
    expect(derivePeriodKey({ reset_cycle: 'month' }, D)).toBe('202607')
    expect(derivePeriodKey({ reset_cycle: 'month' }, new Date(2026, 0, 15))).toBe('202601')
  })

  it("reset_cycle='none' → ''（永不重置，共用同一序列）", () => {
    expect(derivePeriodKey({ reset_cycle: 'none' }, D)).toBe('')
  })

  it('未知/缺 reset_cycle 視為不重置', () => {
    expect(derivePeriodKey({}, D)).toBe('')
    expect(derivePeriodKey(null, D)).toBe('')
  })

  it('跨年月界：12 月 vs 隔年 1 月屬不同期別（月重置歸零依據）', () => {
    const dec = derivePeriodKey({ reset_cycle: 'month' }, new Date(2026, 11, 31))
    const jan = derivePeriodKey({ reset_cycle: 'month' }, new Date(2027, 0, 1))
    expect(dec).toBe('202612')
    expect(jan).toBe('202701')
    expect(dec).not.toBe(jan)
  })
})

// ═════════════════════════════════════════════════════════════
describe('DN-04: 規則不存在 / org 缺失 → 明確報錯', () => {
  it('DB 找不到規則 → RPC 錯誤原文透傳', async () => {
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: '找不到單據類型 nonexistent_type 的啟用編號規則' },
    })
    await expect(allocateDocumentNumber('nonexistent_type'))
      .rejects.toThrow(/找不到單據類型 nonexistent_type 的啟用編號規則/)
  })

  it('tenant 未載入（org=null）→ 直接拋錯且不打 RPC', async () => {
    h.orgId = null
    await expect(allocateDocumentNumber('quotation'))
      .rejects.toThrow(/organization_id/)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})
