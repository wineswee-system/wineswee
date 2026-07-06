import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock supabase（同鄰居測試模式）────────────────────────────
// in-memory secure_create_open_item / secure_settle_open_item：
// 模擬 SQL 端 row-lock 後的餘額檢查與狀態推導，含冪等與超沖拒絕。
vi.mock('../supabase.js', () => {
  const state = {
    items: new Map(),      // id → open_items 列
    settlements: [],
    rpcCalls: [],
    nextId: 1,
    reset() {
      this.items.clear()
      this.settlements = []
      this.rpcCalls = []
      this.nextId = 1
    },
  }

  const statusOf = (amount, settled) =>
    settled <= 0 ? '未沖' : settled >= amount ? '已沖' : '部分沖'

  const supabase = {
    __state: state,
    rpc: async (fn, args) => {
      state.rpcCalls.push({ fn, args })

      if (fn === 'secure_create_open_item') {
        // 冪等：同來源同類型回既有列
        if (args.p_source_type && args.p_source_id) {
          for (const item of state.items.values()) {
            if (item.item_type === args.p_item_type &&
                item.source_type === args.p_source_type &&
                item.source_id === args.p_source_id) {
              return { data: item, error: null }
            }
          }
        }
        const item = {
          id: `oi-${state.nextId++}`,
          item_type: args.p_item_type,
          account_code: args.p_account_code || { '預收': '2260', '預付': '1140', '暫收': '2270', '暫付': '1160' }[args.p_item_type],
          party_type: args.p_party_type,
          party_name: args.p_party_name,
          source_type: args.p_source_type,
          source_id: args.p_source_id,
          amount: args.p_amount,
          settled_amount: 0,
          status: '未沖',
          memo: args.p_memo,
          journal_entry_id: state.nextId * 100, // 立帳傳票
          created_at: '2026-05-01T00:00:00Z',
        }
        state.items.set(item.id, item)
        return { data: item, error: null }
      }

      if (fn === 'secure_settle_open_item') {
        const item = state.items.get(args.p_open_item_id)
        if (!item) return { data: null, error: { message: `找不到立沖單：${args.p_open_item_id}` } }
        if (item.status === '已沖') return { data: null, error: { message: '立沖單已全數沖銷，不可再沖' } }
        const remaining = item.amount - item.settled_amount
        if (args.p_amount > remaining) {
          return { data: null, error: { message: `沖銷金額 ${args.p_amount} 超過未沖餘額 ${remaining}` } }
        }
        state.settlements.push({
          open_item_id: item.id,
          amount: args.p_amount,
          settle_doc_type: args.p_settle_doc_type,
          settle_doc_id: args.p_settle_doc_id,
          journal_entry_id: state.nextId * 1000, // 沖銷傳票
        })
        item.settled_amount += args.p_amount
        item.status = statusOf(item.amount, item.settled_amount)
        return { data: { ...item }, error: null }
      }

      return { data: null, error: { message: `unknown rpc: ${fn}` } }
    },
  }

  return { supabase }
})

import { supabase } from '../supabase.js'
import {
  OPEN_ITEM_TYPES,
  OPEN_ITEM_DEFAULT_ACCOUNTS,
  deriveOpenItemStatus,
  getOpenItemBalance,
  agingDays,
  agingBucket,
  createOpenItem,
  settleOpenItem,
} from '../accounting.js'

beforeEach(() => {
  supabase.__state.reset()
})

// ═════════════════════════════════════════════════════════════
//  OI-01：立帳 — 類型/科目/RPC 參數 + 冪等
// ═════════════════════════════════════════════════════════════

describe('OI-01: 立帳', () => {
  it('四種立沖類型皆有預設科目（預收2260/預付1140/暫收2270/暫付1160）', () => {
    expect(OPEN_ITEM_TYPES).toEqual(['預收', '預付', '暫收', '暫付'])
    expect(OPEN_ITEM_DEFAULT_ACCOUNTS).toEqual({
      '預收': '2260', '預付': '1140', '暫收': '2270', '暫付': '1160',
    })
  })

  it('createOpenItem 呼叫 RPC 並回傳未沖立沖單（帶立帳傳票）', async () => {
    const item = await createOpenItem({ itemType: '預收', amount: 20000, partyType: '客戶', partyName: '王小明' })
    expect(item.status).toBe('未沖')
    expect(item.amount).toBe(20000)
    expect(item.account_code).toBe('2260')
    expect(item.journal_entry_id).toBeTruthy()

    const call = supabase.__state.rpcCalls[0]
    expect(call.fn).toBe('secure_create_open_item')
    expect(call.args.p_item_type).toBe('預收')
    expect(call.args.p_amount).toBe(20000)
  })

  it('不合法類型 / 金額 ≤ 0 → 前端就擋、不打 RPC', async () => {
    await expect(createOpenItem({ itemType: '亂沖', amount: 100 })).rejects.toThrow('不合法的立沖類型')
    await expect(createOpenItem({ itemType: '預收', amount: 0 })).rejects.toThrow('必須大於 0')
    await expect(createOpenItem({ itemType: '預收', amount: -5 })).rejects.toThrow('必須大於 0')
    expect(supabase.__state.rpcCalls).toHaveLength(0)
  })

  it('同來源同類型重放 → 回既有列（冪等，不重複立帳）', async () => {
    const a = await createOpenItem({ itemType: '預收', amount: 500, sourceType: 'sales.order', sourceId: 'SO-1' })
    const b = await createOpenItem({ itemType: '預收', amount: 500, sourceType: 'sales.order', sourceId: 'SO-1' })
    expect(b.id).toBe(a.id)
    expect(supabase.__state.items.size).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════
//  OI-02：部分沖銷 → 部分沖 + 餘額正確
// ═════════════════════════════════════════════════════════════

describe('OI-02: 部分沖銷', () => {
  it('沖 400/1000 → 部分沖、未沖餘額 600、沖銷紀錄帶傳票', async () => {
    const item = await createOpenItem({ itemType: '預付', amount: 1000 })
    const updated = await settleOpenItem(item.id, 400, { settleDocType: 'purchase.receipt', settleDocId: 'GRN-1' })

    expect(updated.status).toBe('部分沖')
    expect(updated.settled_amount).toBe(400)
    expect(getOpenItemBalance(updated)).toBe(600)
    expect(supabase.__state.settlements).toHaveLength(1)
    expect(supabase.__state.settlements[0].journal_entry_id).toBeTruthy()
    expect(supabase.__state.settlements[0].settle_doc_id).toBe('GRN-1')
  })

  it('deriveOpenItemStatus 與 SQL CASE 一致（含小數）', () => {
    expect(deriveOpenItemStatus(1000, 0)).toBe('未沖')
    expect(deriveOpenItemStatus(1000, 0.004)).toBe('未沖')   // round2 → 0
    expect(deriveOpenItemStatus(1000, 400)).toBe('部分沖')
    expect(deriveOpenItemStatus(1000, 999.99)).toBe('部分沖')
    expect(deriveOpenItemStatus(1000, 1000)).toBe('已沖')
  })
})

// ═════════════════════════════════════════════════════════════
//  OI-03：超沖拒絕
// ═════════════════════════════════════════════════════════════

describe('OI-03: 超沖拒絕', () => {
  it('沖銷金額 > 未沖餘額 → throw、不寫沖銷紀錄', async () => {
    const item = await createOpenItem({ itemType: '暫收', amount: 300 })
    await settleOpenItem(item.id, 200)
    await expect(settleOpenItem(item.id, 200)).rejects.toThrow('超過未沖餘額')
    expect(supabase.__state.settlements).toHaveLength(1)
    expect(supabase.__state.items.get(item.id).settled_amount).toBe(200)
  })

  it('金額 ≤ 0 / 缺 id → 前端就擋', async () => {
    await expect(settleOpenItem('oi-x', 0)).rejects.toThrow('必須大於 0')
    await expect(settleOpenItem(null, 100)).rejects.toThrow('缺少立沖單 id')
    expect(supabase.__state.rpcCalls).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════
//  OI-04：沖畢 → 已沖，且不可再沖
// ═════════════════════════════════════════════════════════════

describe('OI-04: 全額沖畢', () => {
  it('分兩次沖到滿 → 已沖、餘額 0；再沖 → 拒絕', async () => {
    const item = await createOpenItem({ itemType: '暫付', amount: 900 })
    await settleOpenItem(item.id, 300)
    const done = await settleOpenItem(item.id, 600)

    expect(done.status).toBe('已沖')
    expect(getOpenItemBalance(done)).toBe(0)
    expect(supabase.__state.settlements).toHaveLength(2)

    await expect(settleOpenItem(item.id, 1)).rejects.toThrow('不可再沖')
  })
})

// ═════════════════════════════════════════════════════════════
//  OI-05：帳齡
// ═════════════════════════════════════════════════════════════

describe('OI-05: 帳齡', () => {
  const asOf = new Date('2026-07-05T12:00:00Z')

  it('agingDays：立帳日至今的整天數；未來/缺日期 → 0', () => {
    expect(agingDays({ created_at: '2026-07-01T00:00:00Z' }, asOf)).toBe(4)
    expect(agingDays({ created_at: '2026-07-05T00:00:00Z' }, asOf)).toBe(0)
    expect(agingDays({ created_at: '2026-08-01T00:00:00Z' }, asOf)).toBe(0)
    expect(agingDays({}, asOf)).toBe(0)
    expect(agingDays({ created_at: 'not-a-date' }, asOf)).toBe(0)
  })

  it('agingBucket：0-30 / 31-60 / 61-90 / 90+ 邊界正確', () => {
    expect(agingBucket(0)).toBe('0-30')
    expect(agingBucket(30)).toBe('0-30')
    expect(agingBucket(31)).toBe('31-60')
    expect(agingBucket(60)).toBe('31-60')
    expect(agingBucket(61)).toBe('61-90')
    expect(agingBucket(90)).toBe('61-90')
    expect(agingBucket(91)).toBe('90+')
    expect(agingBucket(365)).toBe('90+')
  })

  it('getOpenItemBalance：容錯（缺欄位 → 0）與小數修約', () => {
    expect(getOpenItemBalance({ amount: 100.1, settled_amount: 0.05 })).toBe(100.05)
    expect(getOpenItemBalance({})).toBe(0)
    expect(getOpenItemBalance(null)).toBe(0)
  })
})
