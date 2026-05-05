import { Plus, Edit3, Trash2, Eye, Settings, LogIn, Clock, ArrowRight } from 'lucide-react'

export const SECTIONS = [
  { key: 'all',           label: '全部',       tables: null },
  { key: 'hr',            label: 'HR 人資',    tables: ['employees', 'leave_requests', 'payroll_records', 'shifts', 'departments', 'positions', 'attendance_records', 'contracts', 'salary_structures'] },
  { key: 'crm',           label: 'CRM 客戶',   tables: ['customers', 'contacts', 'leads', 'opportunities', 'customer_notes', 'activities'] },
  { key: 'finance',       label: '財務',        tables: ['invoices', 'payments', 'expenses', 'accounts', 'transactions', 'journal_entries', 'budgets'] },
  { key: 'wms',           label: '倉儲 WMS',   tables: ['stock_levels', 'warehouses', 'sku_items', 'inventory_movements', 'warehouse_locations', 'lots'] },
  { key: 'pos',           label: 'POS',         tables: ['sales_transactions', 'pos_sessions', 'pos_shifts'] },
  { key: 'sales',         label: '銷售',        tables: ['sales_orders', 'quotes', 'order_items', 'shipments', 'promotions'] },
  { key: 'purchase',      label: '採購',        tables: ['purchase_orders', 'suppliers', 'purchase_items', 'goods_receipts'] },
  { key: 'manufacturing', label: '製造',        tables: ['production_orders', 'bom', 'work_orders', 'bom_items', 'work_centers'] },
  { key: 'system',        label: '系統',        tables: ['users', 'roles', 'settings', 'organizations', 'triggers'] },
]

export const ACTION_TYPES = ['新增', '編輯', '更新', '修改', '刪除', '檢視', '登入', '設定']


export const actionConfig = {
  '新增': { icon: Plus,     color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  '編輯': { icon: Edit3,    color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  '更新': { icon: Edit3,    color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  '修改': { icon: Edit3,    color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  '刪除': { icon: Trash2,   color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
  '檢視': { icon: Eye,      color: 'var(--accent-cyan)',   dim: 'var(--accent-cyan-dim)' },
  '登入': { icon: LogIn,    color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  '設定': { icon: Settings, color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
}

const _fallback = { icon: Clock, color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)' }

export function getActionStyle(action) {
  if (!action) return _fallback
  if (actionConfig[action]) return actionConfig[action]
  for (const [key, cfg] of Object.entries(actionConfig)) {
    if (action.includes(key)) return cfg
  }
  return _fallback
}

export function DiffBadge({ oldVal, newVal }) {
  if (!oldVal && !newVal) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
      background: 'var(--bg-secondary)', borderRadius: 6, padding: '2px 8px',
      border: '1px solid var(--border-subtle)',
    }}>
      {oldVal && <span style={{ color: 'var(--accent-red)', textDecoration: 'line-through', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{oldVal}</span>}
      {oldVal && newVal && <ArrowRight size={10} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />}
      {newVal && <span style={{ color: 'var(--accent-green)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{newVal}</span>}
    </span>
  )
}

export function formatTime(ts) {
  return ts ? new Date(ts).toLocaleString('zh-TW') : '-'
}

export function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '剛剛'
  if (mins < 60) return `${mins} 分鐘前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小時前`
  return `${Math.floor(hours / 24)} 天前`
}
