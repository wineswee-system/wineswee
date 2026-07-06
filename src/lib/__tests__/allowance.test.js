import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks（在 import 前 hoist）────────────────────────────────
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  publish: vi.fn(),
  voidInvoice: vi.fn(),
  allocate: vi.fn(),
  insertSales: vi.fn(),
  insertPurchase: vi.fn(),
  orgId: 42,
}))

vi.mock('../supabase', () => ({
  supabase: { rpc: (...a) => h.rpc(...a), from: (...a) => h.from(...a) },
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../events/middleware/tenantContext', () => ({
  getTenantOrgId: () => h.orgId,
}))
vi.mock('../events/index.js', () => ({
  getEventBus: () => ({ publish: (...a) => h.publish(...a) }),
}))
vi.mock('../invoiceService', () => ({
  voidInvoice: (...a) => h.voidInvoice(...a),
}))
vi.mock('../documentNumber', () => ({
  allocateDocumentNumber: (...a) => h.allocate(...a),
}))
vi.mock('../db/allowances', () => ({
  insertSalesAllowance: (...a) => h.insertSales(...a),
  insertPurchaseAllowance: (...a) => h.insertPurchase(...a),
}))
// 刻意【不】mock ../einvoice — computeAllowanceTotals 必須走真實 calculateInvoiceTax（AL-01）

import {
  computeAllowanceTotals,
  remainingAllowable,
  createSalesAllowance,
  confirmSalesAllowance,
  createPurchaseAllowance,
  confirmPurchaseAllowance,
  ALLOWANCE_STATUSES,
  ALLOWANCE_STATUS_LABELS,
} from '../allowances.js'

/** pos_invoices 查詢 chain mock：from('pos_invoices').select().eq().maybeSingle() */
function mockInvoiceLookup(result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  }
  h.from.mockReturnValue(chain)
  return chain
}

beforeEach(() => {
  h.rpc.mockReset()
  h.from.mockReset()
  h.publish.mockReset()
  h.voidInvoice.mockReset()
  h.allocate.mockReset()
  h.insertSales.mockReset()
  h.insertPurchase.mockReset()
  h.orgId = 42
})

// ═════════════════════════════════════════════════════════════
describe('AL-01: 折讓金額/稅額計算（computeAllowanceTotals，5% 拆分）', () => {
  it('多行明細：逐行金額 + 5% 稅額拆分正確', () => {
    const r = computeAllowanceTotals([
      { description: '紅酒折讓', quantity: 2, unit_price: 100 },
      { description: '服務費折讓', quantity: 1, unit_price: 300 },
    ])
    expect(r.lines).toEqual([
      { description: '紅酒折讓', quantity: 2, unit_price: 100, amount: 200, tax: 10 },
      { description: '服務費折讓', quantity: 1, unit_price: 300, amount: 300, tax: 15 },
    ])
    expect(r.amount).toBe(500)      // 未稅
    expect(r.taxAmount).toBe(25)    // 500 * 5%
    expect(r.total).toBe(525)       // 含稅
    expect(r.taxRate).toBe(0.05)
  })

  it('四捨五入：與 calculateInvoiceTax 同規則（整體稅額以未稅小計計算）', () => {
    const r = computeAllowanceTotals([{ description: 'x', quantity: 3, unit_price: 33 }])
    expect(r.amount).toBe(99)
    expect(r.taxAmount).toBe(Math.round(99 * 0.05)) // 5
    expect(r.total).toBe(104)
  })

  it('免稅：稅額 0、總額 = 未稅', () => {
    const r = computeAllowanceTotals([{ description: 'x', quantity: 1, unit_price: 200 }], '免稅')
    expect(r.taxAmount).toBe(0)
    expect(r.total).toBe(200)
  })

  it('空明細 / 非數字輸入 → 全 0，不拋錯', () => {
    expect(computeAllowanceTotals([]).total).toBe(0)
    expect(computeAllowanceTotals(null).total).toBe(0)
    const r = computeAllowanceTotals([{ description: '', quantity: 'abc', unit_price: undefined }])
    expect(r.total).toBe(0)
  })

  it('狀態常數與標籤對齊 CHECK 約束', () => {
    expect(ALLOWANCE_STATUSES).toEqual(['draft', 'confirmed', 'cancelled'])
    expect(ALLOWANCE_STATUS_LABELS.draft).toBe('草稿')
  })
})

// ═════════════════════════════════════════════════════════════
describe('AL-02: 折讓不動庫存（vs 退貨動庫存）— mock 隔離斷言', () => {
  const STOCK_PATTERN = /inventor|stock|sku|warehouse|wms/i

  it('createSalesAllowance 全流程不觸碰任何庫存資料表/RPC', async () => {
    h.allocate.mockResolvedValueOnce('SA-202607-0001')
    h.insertSales.mockResolvedValueOnce({
      data: { id: 'a-1', allowance_number: 'SA-202607-0001', status: 'draft' }, error: null,
    })

    await createSalesAllowance({
      originalDocType: 'sales_order', originalDocId: 7, customerName: '測試客戶',
      lines: [{ description: '折讓', quantity: 1, unit_price: 100 }],
    })

    // 取號 + db 層 insert 之外，完全沒有其他 supabase 存取
    expect(h.from).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
    // insert 的資料列沒有任何庫存欄位
    const inserted = h.insertSales.mock.calls[0][0]
    expect(Object.keys(inserted).join(',')).not.toMatch(STOCK_PATTERN)
    expect(inserted.status).toBe('draft')
  })

  it('confirmSalesAllowance 僅打確認 RPC 與 pos_invoices 查詢 — 無任何 stock 存取', async () => {
    h.rpc.mockResolvedValueOnce({
      data: { id: 'a-1', allowance_number: 'SA-202607-0001', invoice_number: null, amount: 100, tax_amount: 5, status: 'confirmed' },
      error: null,
    })

    await confirmSalesAllowance('a-1')

    const touchedTables = h.from.mock.calls.map((c) => c[0])
    const touchedRpcs = h.rpc.mock.calls.map((c) => c[0])
    expect(touchedTables.join(',')).not.toMatch(STOCK_PATTERN)
    expect(touchedRpcs).toEqual(['secure_confirm_sales_allowance'])
  })

  it('進貨折讓確認同樣不觸碰庫存（存貨科目調整只在傳票層，非 stock 異動）', async () => {
    h.rpc.mockResolvedValueOnce({
      data: { id: 'p-1', allowance_number: 'PA-202607-0001', status: 'confirmed' }, error: null,
    })

    await confirmPurchaseAllowance('p-1')

    expect(h.from).not.toHaveBeenCalled()
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(['secure_confirm_purchase_allowance'])
  })
})

// ═════════════════════════════════════════════════════════════
describe('AL-03: 折讓上限 ≤ 原單餘額（remainingAllowable）', () => {
  it('無已確認折讓 → 剩餘 = 原單總額', () => {
    expect(remainingAllowable(1050, [])).toBe(1050)
    expect(remainingAllowable(1050)).toBe(1050)
  })

  it('已確認折讓（amount + tax_amount）累計扣減', () => {
    expect(remainingAllowable(1050, [{ amount: 500, tax_amount: 25 }])).toBe(525)
    expect(remainingAllowable(1050, [
      { amount: 300, tax_amount: 15 }, { amount: 200, tax_amount: 10 },
    ])).toBe(525)
  })

  it('也接受純數字（含稅折讓額）陣列', () => {
    expect(remainingAllowable(1000, [300, 200])).toBe(500)
  })

  it('剛好折完（exact-remaining）→ 剩餘 0，本次折讓 = 剩餘額仍合法', () => {
    const remaining = remainingAllowable(1050, [{ amount: 500, tax_amount: 25 }]) // 525
    const nextAllowance = 525
    expect(remaining - nextAllowance).toBe(0)              // 不為負 → 合法
    expect(remainingAllowable(1050, [
      { amount: 500, tax_amount: 25 }, { amount: 500, tax_amount: 25 },
    ])).toBe(0)
  })

  it('超限 → 回傳負值（UI/RPC 據此擋下）', () => {
    expect(remainingAllowable(500, [{ amount: 500, tax_amount: 25 }])).toBe(-25)
  })

  it('小數安全：0.1 + 0.2 類浮點誤差被 round2 收斂', () => {
    expect(remainingAllowable(1, [{ amount: 0.1, tax_amount: 0 }, { amount: 0.2, tax_amount: 0 }])).toBe(0.7)
  })
})

// ═════════════════════════════════════════════════════════════
describe('AL-04: 確認觸發 D0401 + 傳票 + 銷項憑證（三路斷言）', () => {
  const confirmedRow = {
    id: 'a-1', allowance_number: 'SA-202607-0001', invoice_number: 'AB12345678',
    amount: 200, tax_amount: 10, status: 'confirmed',
  }

  it('路徑 1（全額連動）：確認 RPC（傳票+憑證檔同交易）+ voidInvoice(paymentId) 開 D0401', async () => {
    h.rpc.mockResolvedValueOnce({ data: confirmedRow, error: null })
    mockInvoiceLookup({
      data: { id: 'inv-1', payment_id: 'pay-1', sales_amount: 200, tax_amount: 10, status: 'issued' },
      error: null,
    })
    h.voidInvoice.mockResolvedValueOnce({ ok: true, voidType: 'credit_note', invoiceNumber: 'AB12345678' })

    const { allowance, einvoice } = await confirmSalesAllowance('a-1')

    // (1) 傳票 + 銷項憑證：由 secure_confirm_sales_allowance 在 SQL 端同一交易觸發
    expect(h.rpc).toHaveBeenCalledWith('secure_confirm_sales_allowance', { p_id: 'a-1' })
    // (2) D0401：連動 payment → voidInvoice（其內部發布 finance.invoice.allowance）
    expect(h.voidInvoice).toHaveBeenCalledTimes(1)
    expect(h.voidInvoice).toHaveBeenCalledWith('pay-1')
    // (3) 事件不重複發（避免 vatHandlers 雙計）— 事件由 voidInvoice 內部發
    expect(h.publish).not.toHaveBeenCalled()
    expect(h.from).toHaveBeenCalledWith('pos_invoices')
    expect(allowance.status).toBe('confirmed')
    expect(einvoice.mode).toBe('d0401')
    expect(einvoice.ok).toBe(true)
  })

  it('路徑 2（payment 連結不可得）：直接發布 finance.invoice.allowance 事件（審計軌跡）', async () => {
    h.rpc.mockResolvedValueOnce({ data: confirmedRow, error: null })
    mockInvoiceLookup({
      data: { id: 'inv-1', payment_id: null, sales_amount: 200, tax_amount: 10, status: 'issued' },
      error: null,
    })

    const { einvoice } = await confirmSalesAllowance('a-1')

    expect(h.voidInvoice).not.toHaveBeenCalled()
    expect(h.publish).toHaveBeenCalledTimes(1)
    expect(h.publish).toHaveBeenCalledWith('finance.invoice.allowance', {
      payment_id: '', invoice_number: 'AB12345678', provider: null,
    })
    expect(einvoice.mode).toBe('event')
  })

  it('路徑 2b（發票主檔不存在）：同樣走事件 fallback', async () => {
    h.rpc.mockResolvedValueOnce({ data: confirmedRow, error: null })
    mockInvoiceLookup({ data: null, error: null })

    const { einvoice } = await confirmSalesAllowance('a-1')

    expect(h.voidInvoice).not.toHaveBeenCalled()
    expect(h.publish).toHaveBeenCalledWith('finance.invoice.allowance',
      expect.objectContaining({ invoice_number: 'AB12345678' }))
    expect(einvoice.mode).toBe('event')
  })

  it('路徑 3（部分折讓）：不打 provider、不發事件（避免全額負檔錯帳）→ mode manual', async () => {
    h.rpc.mockResolvedValueOnce({
      data: { ...confirmedRow, amount: 100, tax_amount: 5 }, error: null, // 折讓 105 < 發票 210
    })
    mockInvoiceLookup({
      data: { id: 'inv-1', payment_id: 'pay-1', sales_amount: 200, tax_amount: 10, status: 'issued' },
      error: null,
    })

    const { einvoice } = await confirmSalesAllowance('a-1')

    expect(h.voidInvoice).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
    expect(einvoice.mode).toBe('manual')
    expect(einvoice.reason).toBe('partial')
  })

  it('未連動發票：只打確認 RPC — 無發票查詢、無 D0401、無事件', async () => {
    h.rpc.mockResolvedValueOnce({
      data: { ...confirmedRow, invoice_number: null }, error: null,
    })

    const { einvoice } = await confirmSalesAllowance('a-1')

    expect(h.from).not.toHaveBeenCalled()
    expect(h.voidInvoice).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
    expect(einvoice.mode).toBe('none')
  })

  it('D0401 失敗不推翻已確認的折讓（傳票/憑證已入帳，發票折讓可重試）', async () => {
    h.rpc.mockResolvedValueOnce({ data: confirmedRow, error: null })
    mockInvoiceLookup({
      data: { id: 'inv-1', payment_id: 'pay-1', sales_amount: 200, tax_amount: 10, status: 'issued' },
      error: null,
    })
    h.voidInvoice.mockResolvedValueOnce({ ok: false, error: '發票服務暫時無法連線' })

    const { allowance, einvoice } = await confirmSalesAllowance('a-1')

    expect(allowance.status).toBe('confirmed')
    expect(einvoice.mode).toBe('d0401')
    expect(einvoice.ok).toBe(false)
  })

  it('確認 RPC 失敗 → 拋出含原因的錯誤，不進行任何 D0401 佈線', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: '折讓超過上限' } })

    await expect(confirmSalesAllowance('a-1')).rejects.toThrow(/銷貨折讓確認失敗.*折讓超過上限/)
    expect(h.voidInvoice).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('進貨折讓鏡像：secure_confirm_purchase_allowance（進項憑證/deduction 在 SQL 端）— 無 D0401', async () => {
    h.rpc.mockResolvedValueOnce({
      data: { id: 'p-1', allowance_number: 'PA-202607-0001', status: 'confirmed', deduction_code: '可扣抵' },
      error: null,
    })

    const row = await confirmPurchaseAllowance('p-1')

    expect(h.rpc).toHaveBeenCalledWith('secure_confirm_purchase_allowance', { p_id: 'p-1' })
    expect(h.voidInvoice).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
    expect(row.status).toBe('confirmed')
  })
})

// ═════════════════════════════════════════════════════════════
describe('建立草稿：取號 + 稅額計算 + insert（SA/PA）', () => {
  it('createSalesAllowance：SA 取號、金額/稅額由明細推導、寫入 draft', async () => {
    h.allocate.mockResolvedValueOnce('SA-202607-0007')
    h.insertSales.mockImplementationOnce((row) => Promise.resolve({ data: { id: 'a-7', ...row }, error: null }))

    const row = await createSalesAllowance({
      originalDocType: 'pos_invoice', originalDocId: 'inv-9', customerName: '好客戶',
      invoiceNumber: 'AB12345678', reason: '瑕疵議價',
      lines: [{ description: '折讓', quantity: 2, unit_price: 100 }],
    })

    expect(h.allocate).toHaveBeenCalledWith('sales_allowance', { orgId: 42 })
    const inserted = h.insertSales.mock.calls[0][0]
    expect(inserted).toMatchObject({
      organization_id: 42,
      allowance_number: 'SA-202607-0007',
      original_doc_type: 'pos_invoice',
      original_doc_id: 'inv-9',
      invoice_number: 'AB12345678',
      amount: 200,
      tax_amount: 10,
      status: 'draft',
    })
    expect(row.id).toBe('a-7')
  })

  it('createPurchaseAllowance：PA 取號、供應商欄位 + 扣抵別透傳', async () => {
    h.allocate.mockResolvedValueOnce('PA-202607-0002')
    h.insertPurchase.mockImplementationOnce((row) => Promise.resolve({ data: { id: 'p-2', ...row }, error: null }))

    await createPurchaseAllowance({
      originalDocType: 'purchase_order', originalDocId: 3, supplierName: '好供應商',
      supplierUbn: '12345675', deductionCode: '不可扣抵',
      lines: [{ description: '短少折讓', quantity: 1, unit_price: 1000 }],
    })

    expect(h.allocate).toHaveBeenCalledWith('purchase_allowance', { orgId: 42 })
    expect(h.insertPurchase.mock.calls[0][0]).toMatchObject({
      allowance_number: 'PA-202607-0002',
      supplier_name: '好供應商',
      supplier_ubn: '12345675',
      deduction_code: '不可扣抵',
      amount: 1000,
      tax_amount: 50,
      status: 'draft',
    })
  })

  it('金額 0 → 直接拋錯，不取號不寫入', async () => {
    await expect(createSalesAllowance({ lines: [] })).rejects.toThrow(/折讓金額必須大於 0/)
    expect(h.allocate).not.toHaveBeenCalled()
    expect(h.insertSales).not.toHaveBeenCalled()
  })

  it('tenant 未載入（org=null）→ 明確拋錯', async () => {
    h.orgId = null
    await expect(createSalesAllowance({
      lines: [{ description: 'x', quantity: 1, unit_price: 100 }],
    })).rejects.toThrow(/organization_id/)
  })

  it('insert 失敗 → 拋出含原因的錯誤', async () => {
    h.allocate.mockResolvedValueOnce('SA-202607-0008')
    h.insertSales.mockResolvedValueOnce({ data: null, error: { message: 'RLS violation' } })
    await expect(createSalesAllowance({
      lines: [{ description: 'x', quantity: 1, unit_price: 100 }],
    })).rejects.toThrow(/建立銷貨折讓單失敗.*RLS violation/)
  })
})
