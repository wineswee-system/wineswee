import { useState } from 'react'
import { ClipboardList, Receipt } from 'lucide-react'
import ExpenseRequests from '../workflow/ExpenseRequests'
import MonthlyInvoices from './MonthlyInvoices'

// 叫貨申請單頁:兩個 tab —— 「叫貨申請」(既有 ExpenseRequests docType=order) + 「月結發票」(登記統計)
const TABS = [
  { key: 'requests', label: '叫貨申請', icon: ClipboardList },
  { key: 'invoices', label: '月結發票', icon: Receipt },
]

export default function OrderRequestsPage() {
  const [tab, setTab] = useState('requests')
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, padding: '16px 20px 20px', marginBottom: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                border: `1.5px solid ${active ? 'var(--accent-cyan)' : 'var(--border)'}`,
                background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-secondary)' }}>
              <Icon size={16} /> {t.label}
            </button>
          )
        })}
      </div>
      {/* 叫貨申請維持掛載(保留深連結/狀態),月結發票另掛 */}
      <div style={{ display: tab === 'requests' ? 'block' : 'none' }}>
        <ExpenseRequests docType="order" />
      </div>
      {tab === 'invoices' && <MonthlyInvoices />}
    </div>
  )
}
