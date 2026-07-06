/**
 * F-D1 中信請款批次（settlement）— 單元測試
 * ST-01 請款批次總額 = 明細卡收合計
 * ST-02 手續費以 finance.settlement.fee 事件發布（鬆耦合 — 拋轉引擎並行開發）
 * ST-03 入帳淨額 = 批次總額 − 手續費
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  fromQueue: [],   // 依呼叫順序回應 supabase.from() 的結果
  fromCalls: [],   // { table, ops: [{method, args}] }
  rpc: vi.fn(),
  publish: vi.fn(),
}))

function makeQuery(result, record) {
  const q = {}
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'update', 'upsert', 'insert']) {
    q[m] = (...args) => { record.ops.push({ method: m, args }); return q }
  }
  q.single = () => Promise.resolve(result)
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: (table) => {
      const record = { table, ops: [] }
      h.fromCalls.push(record)
      const result = h.fromQueue.length > 0 ? h.fromQueue.shift() : { data: null, error: null }
      return makeQuery(result, record)
    },
    rpc: (...args) => h.rpc(...args),
  },
}))

vi.mock('../events/index.js', () => ({
  getEventBus: () => ({ publish: (...args) => h.publish(...args) }),
}))

import {
  createTodayBatch,
  closeSettlementBatch,
  computeSettlementNet,
  sumPaymentAmounts,
  CARD_GATEWAYS,
} from '../db/settlement.js'
import { FINANCE_EVENTS } from '../events/catalog/finance.events.js'

beforeEach(() => {
  h.fromQueue.length = 0
  h.fromCalls.length = 0
  h.rpc.mockReset()
  h.publish.mockReset()
  h.publish.mockResolvedValue(undefined)
})

// ═════════════════════════════════════════════════════════════
describe('ST-01: 請款批次總額 = 明細卡收合計', () => {
  it('sumPaymentAmounts adds up payment amounts (ignores bad rows)', () => {
    expect(sumPaymentAmounts([{ amount: 300 }, { amount: 700 }, { amount: null }])).toBe(1000)
    expect(sumPaymentAmounts([])).toBe(0)
  })

  it('createTodayBatch assigns unassigned card payments and writes gross = sum', async () => {
    const payments = [
      { id: 'p1', amount: 300 },
      { id: 'p2', amount: 700 },
    ]
    const batch = { id: 'batch-1', batch_number: 'CTBC-20260705', status: 'open' }
    h.fromQueue.push(
      { data: payments, error: null },                                   // 1. 未歸批卡收
      { data: batch, error: null },                                      // 2. upsert 批次
      { data: null, error: null },                                       // 3. 指派 settlement_batch_id
      { data: [{ amount: 300 }, { amount: 700 }], error: null },         // 4. 已掛入明細
      { data: { ...batch, gross_amount: 1000 }, error: null },           // 5. 回寫 gross
    )

    const result = await createTodayBatch({ organizationId: 1 })

    expect(result.assigned).toBe(2)
    expect(result.batch.gross_amount).toBe(1000) // = 300 + 700

    // 指派呼叫帶 batch id、對正確明細
    const assignCall = h.fromCalls[2]
    expect(assignCall.table).toBe('pos_payments')
    expect(assignCall.ops.find(o => o.method === 'update').args[0]).toEqual({ settlement_batch_id: 'batch-1' })
    expect(assignCall.ops.find(o => o.method === 'in').args[1]).toEqual(['p1', 'p2'])

    // gross 回寫 = 明細合計
    const grossCall = h.fromCalls[4]
    expect(grossCall.table).toBe('settlement_batches')
    expect(grossCall.ops.find(o => o.method === 'update').args[0]).toEqual({ gross_amount: 1000 })
  })

  it('only ctbc card gateways are pulled into a batch', async () => {
    h.fromQueue.push({ data: [], error: null })
    const result = await createTodayBatch({ organizationId: 1 })
    expect(result.batch).toBeNull()
    expect(result.assigned).toBe(0)

    const query = h.fromCalls[0]
    const inOp = query.ops.find(o => o.method === 'in')
    expect(inOp.args[0]).toBe('gateway')
    expect(inOp.args[1]).toEqual(CARD_GATEWAYS)
    expect(CARD_GATEWAYS).toContain('ctbc_edc')
  })
})

// ═════════════════════════════════════════════════════════════
describe('ST-02: 手續費事件 finance.settlement.fee（鬆耦合給拋轉引擎）', () => {
  const settledRow = {
    id: 'batch-1',
    batch_number: 'CTBC-20260705',
    acquirer: 'CTBC',
    gross_amount: 1000,
    fee_amount: 20,
    net_amount: 980,
    deposit_date: '2026-07-06',
    status: 'settled',
  }

  it('closes via secure RPC then publishes fee event with {fee_amount, batch_id}', async () => {
    h.rpc.mockResolvedValue({ data: settledRow, error: null })

    const batch = await closeSettlementBatch({ batchId: 'batch-1', feeAmount: 20, depositDate: '2026-07-06' })

    // 狀態轉換走 secure RPC（不是前端 update）
    expect(h.rpc).toHaveBeenCalledWith('secure_close_settlement_batch', {
      p_batch_id: 'batch-1',
      p_fee_amount: 20,
      p_deposit_date: '2026-07-06',
    })
    expect(batch.status).toBe('settled')

    // 事件發布：拋轉引擎（並行開發）之後訂閱此事件產手續費傳票
    expect(h.publish).toHaveBeenCalledTimes(1)
    const [type, payload] = h.publish.mock.calls[0]
    expect(type).toBe('finance.settlement.fee')
    expect(payload.batch_id).toBe('batch-1')
    expect(payload.fee_amount).toBe(20)
    expect(payload.gross_amount).toBe(1000)
    expect(payload.net_amount).toBe(980)
    expect(payload.acquirer).toBe('CTBC')
  })

  it('event payload satisfies the catalog contract (required fields)', async () => {
    h.rpc.mockResolvedValue({ data: settledRow, error: null })
    await closeSettlementBatch({ batchId: 'batch-1', feeAmount: 20 })

    const schema = FINANCE_EVENTS['finance.settlement.fee']
    expect(schema).toBeTruthy()
    const [, payload] = h.publish.mock.calls[0]
    for (const [field, def] of Object.entries(schema.payload)) {
      if (def.required) {
        expect(payload[field], `payload 缺必填欄位 ${field}`).not.toBeUndefined()
        expect(payload[field]).not.toBeNull()
      }
    }
  })

  it('RPC failure → throws and publishes nothing', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: '批次已結算，不可重複結算' } })
    await expect(closeSettlementBatch({ batchId: 'batch-1', feeAmount: 20 }))
      .rejects.toThrow('批次已結算')
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('rejects negative fee before hitting the RPC', async () => {
    await expect(closeSettlementBatch({ batchId: 'batch-1', feeAmount: -5 }))
      .rejects.toThrow(/手續費/)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════
describe('ST-03: 入帳淨額 = 批次總額 − 手續費', () => {
  it('computeSettlementNet: net = gross - fee', () => {
    expect(computeSettlementNet(1000, 20)).toBe(980)
    expect(computeSettlementNet(1000, 0)).toBe(1000)
    expect(computeSettlementNet(880.5, 17.61)).toBe(862.89)
  })

  it('rejects fee > gross and negative fee', () => {
    expect(() => computeSettlementNet(100, 101)).toThrow(/手續費/)
    expect(() => computeSettlementNet(100, -1)).toThrow(/手續費/)
  })

  it('closed batch returns net_amount = gross_amount - fee_amount (from RPC)', async () => {
    h.rpc.mockResolvedValue({
      data: {
        id: 'batch-2', batch_number: 'CTBC-20260704', acquirer: 'CTBC',
        gross_amount: 45000, fee_amount: 900, net_amount: 44100,
        deposit_date: '2026-07-07', status: 'settled',
      },
      error: null,
    })
    const batch = await closeSettlementBatch({ batchId: 'batch-2', feeAmount: 900 })
    expect(batch.net_amount).toBe(batch.gross_amount - batch.fee_amount)
    expect(batch.net_amount).toBe(44100)
  })
})
