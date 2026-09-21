// 職位（職稱）清單 — 單一來源
// 讀 positions 表（list_positions RPC）；DB 掛掉時 fallback 用 DEFAULT_POSITIONS（讀一律 fallback，不擋畫面）。
// 管理（新增/改/刪）走 upsert_position / delete_position RPC（後台 PositionManagerModal）。
import { supabase } from './supabase'

// fallback：與 migration seed 對齊（DB 讀不到時至少下拉可用）
export const DEFAULT_POSITIONS = [
  { category: '管理職', label: '總經理', level: 'admin' }, { category: '管理職', label: '副總經理', level: 'admin' },
  { category: '管理職', label: '執行長', level: 'admin' }, { category: '管理職', label: '總監', level: 'manager' },
  { category: '管理職', label: '經理', level: 'manager' }, { category: '管理職', label: '企劃經理', level: 'manager' },
  { category: '管理職', label: '副理', level: 'manager' }, { category: '管理職', label: '主管', level: 'manager' },
  { category: '管理職', label: '副主管', level: 'manager' }, { category: '管理職', label: '店長', level: 'manager' },
  { category: '管理職', label: '副店長', level: 'manager' }, { category: '管理職', label: '資深店長', level: 'manager' },
  { category: '管理職', label: '督導', level: 'manager' }, { category: '管理職', label: '組長', level: 'manager' },
  { category: '管理職', label: '主任', level: 'manager' },
  { category: '行政職', label: '資深工程師', level: 'office_staff' }, { category: '行政職', label: '工程師', level: 'office_staff' },
  { category: '行政職', label: '專員', level: 'office_staff' }, { category: '行政職', label: '行政助理', level: 'office_staff' },
  { category: '行政職', label: '會計', level: 'office_staff' }, { category: '行政職', label: '儲備幹部', level: 'store_staff' },
  { category: '行政職', label: '業務代表', level: 'store_staff' },
  { category: '門市職', label: '門市人員', level: 'store_staff' }, { category: '門市職', label: '門市正職人員', level: 'store_staff' },
  { category: '門市職', label: '門市兼職人員', level: 'store_staff' }, { category: '門市職', label: '正職人員', level: 'store_staff' },
  { category: '門市職', label: '兼職人員', level: 'store_staff' }, { category: '門市職', label: '收銀員', level: 'store_staff' },
  { category: '門市職', label: '倉管人員', level: 'store_staff' }, { category: '門市職', label: '助理', level: 'store_staff' },
  { category: '門市職', label: '實習生', level: 'store_staff' },
]

export const LEVEL_LABELS = {
  admin: '系統管理（admin）', manager: '主管（manager）',
  office_staff: '一般職員（office_staff）', store_staff: '門市/基層（store_staff）',
}

// 讀職位清單（預設只回啟用中；管理頁傳 includeInactive=true 拿全部）
export async function loadPositions(includeInactive = false) {
  try {
    const { data, error } = await supabase.rpc('list_positions', { p_include_inactive: includeInactive })
    if (error || !Array.isArray(data) || data.length === 0) return DEFAULT_POSITIONS
    return data
  } catch {
    return DEFAULT_POSITIONS
  }
}

// 依 category 分組（保留原順序）→ [{ group, opts: [{label, level, ...}] }]
export function groupPositions(list) {
  const order = []
  const map = {}
  for (const p of list) {
    const g = p.category || '其他'
    if (!map[g]) { map[g] = []; order.push(g) }
    map[g].push(p)
  }
  return order.map(g => ({ group: g, opts: map[g] }))
}
