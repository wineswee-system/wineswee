import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock supabase（同鄰居測試模式）────────────────────────────
// in-memory secure_register_note / secure_transition_note：
// 與 SQL 端相同的狀態機 CASE；每次轉換記一張傳票（source_ref = id:seq:action）。
vi.mock('../supabase.js', () => {
  const TRANSITIONS = {
    receivable: {
      '在庫': { collect: '託收' },
      '託收': { honor: '兌現', bounce: '退票' },
      '退票': { collect: '託收', return: '轉回' },
    },
    payable: {
      '開立': { honor: '兌現', void: '作廢' },
    },
  }

  const state = {
    notes: new Map(),   // id → 票據列
    vouchers: [],       // { source_ref, template, amount }
    rpcCalls: [],
    nextId: 1,
    reset() {
      this.notes.clear()
      this.vouchers = []
      this.rpcCalls = []
      this.nextId = 1
    },
  }

  const supabase = {
    __state: state,
    rpc: async (fn, args) => {
      state.rpcCalls.push({ fn, args })

      if (fn === 'secure_register_note') {
        const note = {
          id: `note-${state.nextId++}`,
          kind: args.p_note_kind,
          status: args.p_note_kind === 'receivable' ? '在庫' : '開立',
          transition_seq: 0,
          journal_entry_id: state.vouchers.length + 1,
          ...args.p_note,
        }
        state.notes.set(note.id, note)
        state.vouchers.push({
          source_ref: `${note.id}:0:register`,
          template: args.p_note_kind === 'receivable' ? 'ar_receive' : 'ap_issue',
          amount: note.amount,
        })
        return { data: note, error: null }
      }

      if (fn === 'secure_transition_note') {
        const note = state.notes.get(args.p_note_id)
        if (!note) return { data: null, error: { message: `找不到票據：${args.p_note_id}` } }
        const to = TRANSITIONS[args.p_note_kind]?.[note.status]?.[args.p_action]
        if (!to) {
          return { data: null, error: { message: `不允許的票據狀態轉換：票據 ${note.note_number}（目前狀態「${note.status}」）不能執行動作「${args.p_action}」` } }
        }
        note.transition_seq += 1
        note.status = to
        const prefix = args.p_note_kind === 'receivable' ? 'ar_' : 'ap_'
        state.vouchers.push({
          source_ref: `${note.id}:${note.transition_seq}:${args.p_action}`,
          template: prefix + args.p_action,
          amount: note.amount,
        })
        note.journal_entry_id = state.vouchers.length
        return { data: { ...note }, error: null }
      }

      return { data: null, error: { message: `unknown rpc: ${fn}` } }
    },
  }

  return { supabase }
})

import { supabase } from '../supabase.js'
import {
  NOTE_KINDS,
  NOTE_TRANSITIONS,
  NOTE_OPEN_STATUSES,
  nextStates,
  canTransition,
  dueSoon,
  registerNote,
  transitionNote,
} from '../accounting.js'

beforeEach(() => {
  supabase.__state.reset()
})

// ═════════════════════════════════════════════════════════════
//  NT-01：應收票據合法狀態轉移（在庫→託收→兌現）
// ═════════════════════════════════════════════════════════════

describe('NT-01: 合法狀態轉移', () => {
  it('狀態機表：在庫→託收→兌現 全程合法', () => {
    expect(canTransition('receivable', '在庫', 'collect')).toBe(true)
    expect(NOTE_TRANSITIONS.receivable['在庫'].collect).toBe('託收')
    expect(canTransition('receivable', '託收', 'honor')).toBe(true)
    expect(NOTE_TRANSITIONS.receivable['託收'].honor).toBe('兌現')
    // 終態不可再動
    expect(nextStates('receivable', '兌現')).toEqual([])
  })

  it('RPC 全程：登錄（在庫）→ 託收 → 兌現', async () => {
    const note = await registerNote('receivable', { note_number: 'AB123', amount: 50000, due_date: '2026-08-15' })
    expect(note.status).toBe('在庫')

    const collected = await transitionNote('receivable', note.id, 'collect')
    expect(collected.status).toBe('託收')

    const honored = await transitionNote('receivable', note.id, 'honor')
    expect(honored.status).toBe('兌現')
  })

  it('應付票據：開立→兌現｜開立→作廢', () => {
    expect(canTransition('payable', '開立', 'honor')).toBe(true)
    expect(canTransition('payable', '開立', 'void')).toBe(true)
    expect(nextStates('payable', '兌現')).toEqual([])
    expect(nextStates('payable', '作廢')).toEqual([])
  })

  it('nextStates 驅動 UI：託收可 兌現/退票 兩動作（含 zh-TW 標籤）', () => {
    const moves = nextStates('receivable', '託收')
    expect(moves.map(m => m.action).sort()).toEqual(['bounce', 'honor'])
    expect(moves.find(m => m.action === 'honor')).toMatchObject({ to: '兌現', label: '兌現' })
    expect(moves.find(m => m.action === 'bounce')).toMatchObject({ to: '退票', label: '退票' })
  })
})

// ═════════════════════════════════════════════════════════════
//  NT-02：非法轉移拒絕（在庫→兌現 等）
// ═════════════════════════════════════════════════════════════

describe('NT-02: 非法轉移拒絕', () => {
  it('純函式：在庫不能直接兌現；兌現/轉回/作廢為終態', () => {
    expect(canTransition('receivable', '在庫', 'honor')).toBe(false)
    expect(canTransition('receivable', '在庫', 'bounce')).toBe(false)
    expect(canTransition('receivable', '在庫', 'return')).toBe(false)
    expect(canTransition('receivable', '兌現', 'collect')).toBe(false)
    expect(canTransition('receivable', '轉回', 'collect')).toBe(false)
    expect(canTransition('payable', '兌現', 'void')).toBe(false)
    expect(canTransition('payable', '作廢', 'honor')).toBe(false)
  })

  it('RPC：在庫→honor 被拒、狀態不變、不產傳票', async () => {
    const note = await registerNote('receivable', { note_number: 'AB124', amount: 1000 })
    const vouchersBefore = supabase.__state.vouchers.length

    await expect(transitionNote('receivable', note.id, 'honor')).rejects.toThrow('不允許的票據狀態轉換')
    expect(supabase.__state.notes.get(note.id).status).toBe('在庫')
    expect(supabase.__state.vouchers.length).toBe(vouchersBefore)
  })

  it('wrapper：不合法 kind / action 前端就擋、不打 RPC', async () => {
    await expect(transitionNote('checkbook', 'id', 'honor')).rejects.toThrow('不合法的票據種類')
    await expect(transitionNote('receivable', 'id', 'shred')).rejects.toThrow('不合法的票據動作')
    expect(supabase.__state.rpcCalls).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════
//  NT-03：退票 → 轉回應收帳款（+ 可重新提示託收）
// ═════════════════════════════════════════════════════════════

describe('NT-03: 退票與轉回', () => {
  it('託收→退票→轉回：每步合法、轉回為終態、轉回傳票 = ar_return', async () => {
    const note = await registerNote('receivable', { note_number: 'AB125', amount: 2000 })
    await transitionNote('receivable', note.id, 'collect')
    const bounced = await transitionNote('receivable', note.id, 'bounce')
    expect(bounced.status).toBe('退票')

    // 退票後兩條路：重新提示（collect）或轉回應收帳款（return）
    expect(nextStates('receivable', '退票').map(m => m.action).sort()).toEqual(['collect', 'return'])

    const returned = await transitionNote('receivable', note.id, 'return')
    expect(returned.status).toBe('轉回')
    expect(nextStates('receivable', '轉回')).toEqual([])

    // 轉回傳票 = ar_return（借 應收帳款 / 貸 應收票據）
    const last = supabase.__state.vouchers.at(-1)
    expect(last.template).toBe('ar_return')
    expect(last.amount).toBe(2000)
  })

  it('退票 → 重新提示託收（同 action 不同 seq，傳票冪等鍵不撞）', async () => {
    const note = await registerNote('receivable', { note_number: 'AB126', amount: 3000 })
    await transitionNote('receivable', note.id, 'collect')  // seq 1
    await transitionNote('receivable', note.id, 'bounce')   // seq 2
    const again = await transitionNote('receivable', note.id, 'collect') // seq 3
    expect(again.status).toBe('託收')

    const refs = supabase.__state.vouchers.map(v => v.source_ref)
    expect(new Set(refs).size).toBe(refs.length) // 冪等鍵全不重複
    expect(refs.at(-1)).toBe(`${note.id}:3:collect`)
  })
})

// ═════════════════════════════════════════════════════════════
//  NT-04：每次轉移產對應傳票
// ═════════════════════════════════════════════════════════════

describe('NT-04: 每次轉移產對應傳票', () => {
  it('AR 全鏈：register/collect/honor 各一張、模板對應、金額一致', async () => {
    const note = await registerNote('receivable', { note_number: 'AB127', amount: 88000 })
    await transitionNote('receivable', note.id, 'collect')
    await transitionNote('receivable', note.id, 'honor')

    const templates = supabase.__state.vouchers.map(v => v.template)
    expect(templates).toEqual(['ar_receive', 'ar_collect', 'ar_honor'])
    for (const v of supabase.__state.vouchers) expect(v.amount).toBe(88000)
  })

  it('AP：issue + honor / issue + void 各自對應模板', async () => {
    const a = await registerNote('payable', { note_number: 'PN-1', amount: 10000 })
    await transitionNote('payable', a.id, 'honor')
    const b = await registerNote('payable', { note_number: 'PN-2', amount: 5000 })
    await transitionNote('payable', b.id, 'void')

    const templates = supabase.__state.vouchers.map(v => v.template)
    expect(templates).toEqual(['ap_issue', 'ap_honor', 'ap_issue', 'ap_void'])
  })

  it('registerNote 缺票號/金額不正 → 前端就擋', async () => {
    await expect(registerNote('receivable', { amount: 100 })).rejects.toThrow('缺少票據號碼')
    await expect(registerNote('receivable', { note_number: 'X', amount: 0 })).rejects.toThrow('必須大於 0')
    expect(supabase.__state.rpcCalls).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════
//  NT-05：到期 30 日內清單
// ═════════════════════════════════════════════════════════════

describe('NT-05: 到期提示（dueSoon）', () => {
  const today = new Date('2026-07-05T10:00:00+08:00')
  const notes = [
    { id: 1, due_date: '2026-07-10', status: '在庫' },   // 5 天後
    { id: 2, due_date: '2026-08-04', status: '託收' },   // 30 天（邊界內）
    { id: 3, due_date: '2026-08-05', status: '在庫' },   // 31 天（邊界外）
    { id: 4, due_date: '2026-07-01', status: '退票' },   // 已逾期
    { id: 5, due_date: '2026-07-08', status: '兌現' },   // 終態 → 排除
    { id: 6, due_date: '2026-07-06', status: '開立' },   // AP 未了結
    { id: 7, due_date: '2026-07-07', status: '作廢' },   // 終態 → 排除
    { id: 8, due_date: null,          status: '在庫' },  // 無到期日 → 排除
  ]

  it('僅含未了結且 30 日內（含逾期），依到期日排序', () => {
    const result = dueSoon(notes, 30, today)
    expect(result.map(n => n.id)).toEqual([4, 6, 1, 2])
  })

  it('_dueInDays：正 = 幾天後到期、負 = 已逾期、0 = 今天', () => {
    const result = dueSoon([
      { id: 'a', due_date: '2026-07-05', status: '在庫' },
      { id: 'b', due_date: '2026-07-03', status: '託收' },
      { id: 'c', due_date: '2026-07-20', status: '開立' },
    ], 30, today)
    expect(result.find(n => n.id === 'a')._dueInDays).toBe(0)
    expect(result.find(n => n.id === 'b')._dueInDays).toBe(-2)
    expect(result.find(n => n.id === 'c')._dueInDays).toBe(15)
  })

  it('天數窗可調（縮到 5 天 → 邊界外票據排除）；空清單容錯', () => {
    expect(dueSoon(notes, 5, today).map(n => n.id)).toEqual([4, 6, 1])
    expect(dueSoon(null, 30, today)).toEqual([])
    expect(dueSoon([], 30, today)).toEqual([])
  })

  it('NOTE_OPEN_STATUSES / NOTE_KINDS 對齊 DB CHECK', () => {
    expect(NOTE_KINDS).toEqual({ receivable: '應收票據', payable: '應付票據' })
    expect(NOTE_OPEN_STATUSES.receivable).toEqual(['在庫', '託收', '退票'])
    expect(NOTE_OPEN_STATUSES.payable).toEqual(['開立'])
  })
})
