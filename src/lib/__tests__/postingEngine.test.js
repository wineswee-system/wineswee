import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock supabase（同鄰居測試模式）────────────────────────────
// rpc: 以 (p_source_type, p_source_id) 為冪等鍵的 in-memory secure_auto_post_voucher
// from('posting_rules'): 供 hasActiveRule 查詢
vi.mock('../supabase.js', () => {
  const state = {
    entries: new Map(), // `${source_type}::${source_id}` → entry
    nextId: 1,
    rpcMode: 'ok',      // 'ok' | 'disabled' | 'missing-account'
    rules: [{ id: 'r1' }],
    rpcCalls: [],
    reset() {
      this.entries.clear()
      this.nextId = 1
      this.rpcMode = 'ok'
      this.rules = [{ id: 'r1' }]
      this.rpcCalls = []
    },
  }

  const supabase = {
    __state: state,
    rpc: async (fn, args) => {
      state.rpcCalls.push({ fn, args })
      if (fn !== 'secure_auto_post_voucher') {
        return { data: null, error: { message: `unknown rpc: ${fn}` } }
      }
      if (state.rpcMode === 'disabled') {
        return { data: null, error: null } // 規則停用 → RPC 回 NULL（刻意不拋轉）
      }
      if (state.rpcMode === 'missing-account') {
        return { data: null, error: { message: '科目不存在且規則未提供科目名稱：9999' } }
      }
      const key = `${args.p_source_type}::${args.p_source_id}`
      if (state.entries.has(key)) {
        return { data: state.entries.get(key), error: null } // 冪等命中
      }
      const entry = {
        id: state.nextId++,
        entry_number: `JE-TEST-${String(state.nextId).padStart(4, '0')}`,
        source: args.p_doc_type,
        source_type: args.p_source_type,
        source_ref: args.p_source_id,
        status: '草稿',
      }
      state.entries.set(key, entry)
      return { data: entry, error: null }
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve(
            table === 'posting_rules'
              ? { data: state.rules, error: null }
              : { data: [], error: null }
          ),
        }),
      }),
    }),
  }

  return { supabase }
})

import { supabase } from '../supabase.js'
import {
  POSTING_DOC_TYPES,
  DEFAULT_POSTING_TEMPLATES,
  evaluateAmountExpr,
  resolveActiveRule,
  previewVoucher,
  postFromDocument,
  hasActiveRule,
  clearRuleCache,
} from '../accounting.js'

// 與 PostingRules.jsx 的 SAMPLE_PAYLOADS 對齊的樣本單據資料
const SAMPLES = {
  sales_shipment:       { total: 105000, tax: 5000, store_id: 'S01' },
  sales_return:         { total: 10500, tax: 500, store_id: 'S01' },
  purchase_receipt:     { total: 52500, tax: 2500, warehouse_id: 'WH1' },
  purchase_return:      { total: 10500, tax: 500, warehouse_id: 'WH1' },
  payment_received:     { amount: 105000, store_id: 'S01' },
  payment_made:         { amount: 52500, store_id: 'S01' },
  inventory_count:      { amount: 3200, warehouse_id: 'WH1' },
  payroll_monthly:      { gross: 380000, net: 322000, department: 'OPS' },
  depreciation_monthly: { amount: 12500, cost_center: 'CC-HQ' },
  open_item_settle:     { amount: 20000, store_id: 'S01' },
}

beforeEach(() => {
  supabase.__state.reset()
  clearRuleCache()
})

// ═════════════════════════════════════════════════════════════
//  PE-01：每種單據類型的種子模板都產出借貸平衡的傳票
// ═════════════════════════════════════════════════════════════

describe('PE-01: 種子模板借貸平衡', () => {
  it('涵蓋規劃書全部 10 種單據類型', () => {
    expect(Object.keys(POSTING_DOC_TYPES)).toHaveLength(10)
    expect(Object.keys(DEFAULT_POSTING_TEMPLATES)).toHaveLength(10)
    expect(Object.keys(DEFAULT_POSTING_TEMPLATES).sort()).toEqual(Object.keys(POSTING_DOC_TYPES).sort())
  })

  for (const docType of Object.keys(SAMPLES)) {
    it(`${docType}（${POSTING_DOC_TYPES[docType]}）→ 平衡傳票`, () => {
      const result = previewVoucher(docType, SAMPLES[docType])
      expect(result.errors).toEqual([])
      expect(result.balanced).toBe(true)
      expect(result.totalDebit).toBeGreaterThan(0)
      expect(result.totalDebit).toBe(result.totalCredit)
      expect(result.lines.length).toBeGreaterThanOrEqual(2)
      // 每行不可同時有借貸金額
      for (const line of result.lines) {
        expect(line.debit > 0 && line.credit > 0).toBe(false)
      }
    })
  }
})

// ═════════════════════════════════════════════════════════════
//  PE-02：冪等 — 同來源重複拋轉回傳同一張傳票
// ═════════════════════════════════════════════════════════════

describe('PE-02: 冪等', () => {
  it('同 (source_type, source_id) 呼叫兩次 → 同一張傳票、只入帳一次', async () => {
    const payload = { total: 105000, tax: 5000 }
    const first = await postFromDocument('sales_shipment', 'wms.shipment', 'SHIP-001', payload)
    const second = await postFromDocument('sales_shipment', 'wms.shipment', 'SHIP-001', payload)

    expect(first.id).toBeTruthy()
    expect(second.id).toBe(first.id)
    expect(supabase.__state.entries.size).toBe(1)
    expect(supabase.__state.rpcCalls).toHaveLength(2)
  })

  it('不同來源單據 → 各自一張傳票', async () => {
    await postFromDocument('sales_shipment', 'wms.shipment', 'SHIP-001', { total: 100 })
    await postFromDocument('sales_shipment', 'wms.shipment', 'SHIP-002', { total: 200 })
    expect(supabase.__state.entries.size).toBe(2)
  })

  it('sourceId 為數字時仍以字串傳給 RPC（冪等鍵型別穩定）', async () => {
    await postFromDocument('sales_shipment', 'wms.shipment', 123, { total: 100 })
    expect(supabase.__state.rpcCalls[0].args.p_source_id).toBe('123')
  })
})

// ═════════════════════════════════════════════════════════════
//  PE-03：規則停用 → 不拋轉（不是錯誤、也不能回落全域）
// ═════════════════════════════════════════════════════════════

describe('PE-03: 規則停用', () => {
  it('RPC 回 NULL（規則停用）→ postFromDocument 回 null、不 throw', async () => {
    supabase.__state.rpcMode = 'disabled'
    const result = await postFromDocument('sales_shipment', 'wms.shipment', 'SHIP-009', { total: 100 })
    expect(result).toBeNull()
    expect(supabase.__state.entries.size).toBe(0)
  })

  it('resolveActiveRule：組織停用覆寫不得回落仍啟用的全域預設', () => {
    const rules = [
      { doc_type: 'sales_shipment', template_name: 'default', organization_id: null, is_active: true, lines: [] },
      { doc_type: 'sales_shipment', template_name: 'default', organization_id: 7, is_active: false, lines: [] },
    ]
    expect(resolveActiveRule(rules, 'sales_shipment', { orgId: 7 })).toBeNull()
  })

  it('resolveActiveRule：組織自訂優先於全域預設', () => {
    const rules = [
      { doc_type: 'sales_shipment', template_name: 'default', organization_id: null, is_active: true },
      { doc_type: 'sales_shipment', template_name: 'default', organization_id: 7, is_active: true },
    ]
    expect(resolveActiveRule(rules, 'sales_shipment', { orgId: 7 }).organization_id).toBe(7)
  })

  it('resolveActiveRule：無規則 → null', () => {
    expect(resolveActiveRule([], 'sales_shipment')).toBeNull()
  })

  it('hasActiveRule：有規則列 → true（legacy 讓位）；無規則 → false', async () => {
    expect(await hasActiveRule('sales_shipment')).toBe(true)
    clearRuleCache()
    supabase.__state.rules = []
    expect(await hasActiveRule('sales_shipment')).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════
//  PE-04：稅額拆分金額運算式
// ═════════════════════════════════════════════════════════════

describe('PE-04: 金額運算式（稅額拆分）', () => {
  it('key：直接取 payload 值', () => {
    expect(evaluateAmountExpr('total', { total: 105 })).toBe(105)
    expect(evaluateAmountExpr('missing', { total: 105 })).toBe(0)
  })

  it('key-key：total-tax = 未稅淨額', () => {
    expect(evaluateAmountExpr('total-tax', { total: 105, tax: 5 })).toBe(100)
  })

  it('key*rate：total*0.05 = 稅額', () => {
    expect(evaluateAmountExpr('total*0.05', { total: 1000 })).toBe(50)
  })

  it('key+key：gross = base+allowance', () => {
    expect(evaluateAmountExpr('base+allowance', { base: 30000, allowance: 2000 })).toBe(32000)
  })

  it('不支援的運算式 → throw（不默默算錯）', () => {
    expect(() => evaluateAmountExpr('total/2', { total: 100 })).toThrow('不支援的金額運算式')
    expect(() => evaluateAmountExpr('total-tax-fee', { total: 100 })).toThrow('不支援的金額運算式')
  })

  it('銷貨模板稅額拆分：借 應收 105 / 貸 收入 100 + 銷項稅 5', () => {
    const result = previewVoucher('sales_shipment', { total: 105, tax: 5 })
    const byCode = Object.fromEntries(result.lines.map(l => [l.account_code, l]))
    expect(byCode['1130'].debit).toBe(105)
    expect(byCode['4100'].credit).toBe(100)
    expect(byCode['2170'].credit).toBe(5)
    expect(result.balanced).toBe(true)
  })

  it('稅額 0 → 稅額行整行略過、仍平衡', () => {
    const result = previewVoucher('sales_shipment', { total: 100, tax: 0 })
    expect(result.lines.map(l => l.account_code)).toEqual(['1130', '4100'])
    expect(result.balanced).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════
//  PE-05：cost_center 傳遞
// ═════════════════════════════════════════════════════════════

describe('PE-05: cost_center 傳遞', () => {
  it('cost_center_from 指到的 payload 鍵值帶入每一行', () => {
    const result = previewVoucher('sales_shipment', { total: 105, tax: 5, store_id: 'S01' })
    expect(result.lines.length).toBe(3)
    for (const line of result.lines) expect(line.cost_center).toBe('S01')
  })

  it('折舊模板：cost_center 鍵傳遞（部門損益維度）', () => {
    const result = previewVoucher('depreciation_monthly', { amount: 12500, cost_center: 'CC-3' })
    for (const line of result.lines) expect(line.cost_center).toBe('CC-3')
  })

  it('payload 沒有該鍵 → cost_center 為 null（不會塞 undefined）', () => {
    const result = previewVoucher('sales_shipment', { total: 105, tax: 5 })
    for (const line of result.lines) expect(line.cost_center).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════
//  PE-06：科目缺失 → 錯誤浮出（不默默吞掉，讓 DLQ 接手）
// ═════════════════════════════════════════════════════════════

describe('PE-06: 科目缺失錯誤浮出', () => {
  it('RPC 報科目不存在 → postFromDocument throw（交給 EventBus DLQ，不靜默）', async () => {
    supabase.__state.rpcMode = 'missing-account'
    await expect(
      postFromDocument('sales_shipment', 'wms.shipment', 'SHIP-100', { total: 100 })
    ).rejects.toThrow('科目不存在')
    expect(supabase.__state.entries.size).toBe(0)
  })

  it('previewVoucher 帶科目表校驗：模板科目不在表內且無名稱 → errors 浮出', () => {
    const rule = {
      lines: [
        { account_code: '9999', side: 'debit', amount_expr: 'total' },
        { account_code: '4100', account_name: '營業收入', side: 'credit', amount_expr: 'total' },
      ],
    }
    const accounts = [{ code: '4100', name: '營業收入' }]
    const result = previewVoucher(rule, { total: 100 }, { accounts })
    expect(result.errors.some(e => e.includes('9999'))).toBe(true)
    expect(result.balanced).toBe(false)
  })

  it('明細不足兩行 → errors 浮出、不平衡', () => {
    const result = previewVoucher({ lines: [{ account_code: '1100', side: 'debit', amount_expr: 'total' }] }, { total: 100 })
    expect(result.balanced).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
