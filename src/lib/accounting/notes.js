import { supabase } from '../supabase'
import { logger } from '../logger'

// ─── F-A4 票據管理（應收/應付票據狀態機）────────────────────────
//
// 純函式狀態機 + 薄 RPC wrapper。每次狀態轉換由 SQL 端
// secure_transition_note 經 F-A2 自動拋傳票（doc_type 'note_transition'，
// _template = ar_collect / ar_honor / ... / ap_void）。
// 狀態機與 20260705141000_notes_management.sql 的 CASE 對齊，改一邊要同步。

/** 票據種類 → zh-TW 標籤 */
export const NOTE_KINDS = {
  receivable: '應收票據',
  payable:    '應付票據',
}

/**
 * 合法狀態轉換表：kind → 目前狀態 → { action: 目標狀態 }。
 * 應收：在庫 →(collect) 託收 →(honor) 兌現；託收 →(bounce) 退票；
 *       退票 →(collect) 託收（重新提示）｜退票 →(return) 轉回（轉回應收帳款）
 * 應付：開立 →(honor) 兌現｜開立 →(void) 作廢
 */
export const NOTE_TRANSITIONS = {
  receivable: {
    '在庫': { collect: '託收' },
    '託收': { honor: '兌現', bounce: '退票' },
    '退票': { collect: '託收', return: '轉回' },
    '兌現': {},
    '轉回': {},
  },
  payable: {
    '開立': { honor: '兌現', void: '作廢' },
    '兌現': {},
    '作廢': {},
  },
}

/** 動作 → zh-TW 操作標籤（UI 按鈕文字） */
export const NOTE_ACTION_LABELS = {
  collect: '送託收',
  honor:   '兌現',
  bounce:  '退票',
  return:  '轉回應收帳款',
  void:    '作廢',
}

/** 未了結狀態（到期提示只看這些；兌現/作廢/轉回為終態） */
export const NOTE_OPEN_STATUSES = {
  receivable: ['在庫', '託收', '退票'],
  payable:    ['開立'],
}

/**
 * 目前狀態可執行的動作清單（驅動 UI 操作按鈕）。
 * @param {'receivable'|'payable'} kind
 * @param {string} status — 票據目前狀態
 * @returns {Array<{action: string, to: string, label: string}>}
 */
export function nextStates(kind, status) {
  const moves = NOTE_TRANSITIONS[kind]?.[status]
  if (!moves) return []
  return Object.entries(moves).map(([action, to]) => ({
    action,
    to,
    label: NOTE_ACTION_LABELS[action] || action,
  }))
}

/**
 * 是否允許某動作（純函式，與 SQL 端狀態機一致）。
 * @param {'receivable'|'payable'} kind
 * @param {string} status
 * @param {string} action
 * @returns {boolean}
 */
export function canTransition(kind, status, action) {
  return Boolean(NOTE_TRANSITIONS[kind]?.[status]?.[action])
}

const DAY_MS = 86_400_000
const dateOnly = (d) => { const t = new Date(d); t.setHours(0, 0, 0, 0); return t }

/**
 * 到期提示清單：未了結票據中，到期日在 days 天內（含已逾期）者，依到期日排序。
 * 票據物件需含 due_date（YYYY-MM-DD）與 status；已兌現/作廢/轉回不列入。
 * @param {Array<object>} notes
 * @param {number} [days=30]
 * @param {Date} [today]
 * @returns {Array<object>} 附 _dueInDays（負值 = 已逾期天數）
 */
export function dueSoon(notes, days = 30, today = new Date()) {
  const openSet = new Set([...NOTE_OPEN_STATUSES.receivable, ...NOTE_OPEN_STATUSES.payable])
  const base = dateOnly(today).getTime()
  return (notes || [])
    .filter(n => n?.due_date && openSet.has(n.status))
    .map(n => ({ ...n, _dueInDays: Math.round((dateOnly(n.due_date).getTime() - base) / DAY_MS) }))
    .filter(n => n._dueInDays <= days)
    .sort((a, b) => a._dueInDays - b._dueInDays)
}

/**
 * 票據登錄（AR 收票 / AP 開票）→ RPC secure_register_note。
 * SQL 端同時拋 ar_receive / ap_issue 傳票。
 * @param {'receivable'|'payable'} kind
 * @param {{note_number: string, bank?: string, due_date?: string, amount: number,
 *          party_id?: string, party_name?: string, source_type?: string,
 *          source_id?: string, memo?: string}} note
 * @returns {Promise<object>} 票據列
 */
export async function registerNote(kind, note = {}) {
  if (!NOTE_KINDS[kind]) throw new Error(`不合法的票據種類：${kind}`)
  if (!note.note_number) throw new Error('缺少票據號碼 note_number')
  if (!(Number(note.amount) > 0)) throw new Error(`票據金額必須大於 0：${note.amount}`)

  const { data, error } = await supabase.rpc('secure_register_note', {
    p_note_kind: kind,
    p_note: note,
  })

  if (error) {
    logger.error('[notes] 票據登錄失敗', { kind, noteNumber: note.note_number, error: error.message })
    throw new Error(`票據登錄失敗（${NOTE_KINDS[kind]}）：${error.message}`)
  }
  return data
}

/**
 * 票據狀態轉換 → RPC secure_transition_note（每次轉換自動拋傳票）。
 * 前端先用 canTransition 擋，SQL 端仍是最終守門員（row-lock + 狀態機）。
 * @param {'receivable'|'payable'} kind
 * @param {string} noteId
 * @param {string} action — collect / honor / bounce / return / void
 * @param {Record<string, unknown>} [payload] — memo / description / created_by…
 * @returns {Promise<object>} 更新後票據列
 */
export async function transitionNote(kind, noteId, action, payload = {}) {
  if (!NOTE_KINDS[kind]) throw new Error(`不合法的票據種類：${kind}`)
  if (!noteId) throw new Error('缺少票據 id')
  if (!NOTE_ACTION_LABELS[action]) throw new Error(`不合法的票據動作：${action}`)

  const { data, error } = await supabase.rpc('secure_transition_note', {
    p_note_kind: kind,
    p_note_id: noteId,
    p_action: action,
    p_payload: payload,
  })

  if (error) {
    logger.error('[notes] 票據狀態轉換失敗', { kind, noteId, action, error: error.message })
    throw new Error(`票據狀態轉換失敗（${NOTE_ACTION_LABELS[action] || action}）：${error.message}`)
  }
  return data
}
