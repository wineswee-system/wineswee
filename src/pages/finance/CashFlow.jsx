import { useState, useEffect } from 'react'
import { ArrowDownRight, ArrowUpRight, RefreshCw, Download } from 'lucide-react'
import { getJournalEntries, getAllJournalLines, getAccounts } from '../../lib/db'
import { getAccountType } from '../../lib/accounting'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useOrgId } from '../../contexts/AuthContext'

import { fmtNT as fmt } from '../../lib/currency'
const fmtSigned = (n) => n >= 0 ? fmt(n) : `(${fmt(Math.abs(n))})`

/**
 * Generate Cash Flow Statement using the indirect method.
 * Operating: Net Income + non-cash adjustments (depreciation) + working capital changes (AR, AP, inventory)
 * Investing: Fixed asset purchases
 * Financing: Borrowings, equity changes
 */
function generateCashFlowStatement(accounts, journalLines, entryMap) {
  // Build account balance changes from journal lines
  const changes = {}
  for (const line of journalLines) {
    const code = line.account_code
    if (!code) continue
    if (!changes[code]) changes[code] = { debit: 0, credit: 0 }
    changes[code].debit += Number(line.debit) || 0
    changes[code].credit += Number(line.credit) || 0
  }

  const netChange = (code) => {
    const c = changes[code]
    if (!c) return 0
    const type = getAccountType(code)
    // Assets & Expenses: debit-normal -> net = debit - credit
    // Liabilities, Equity, Revenue: credit-normal -> net = credit - debit
    if (['資產', '銷貨成本', '營業費用'].includes(type)) return c.debit - c.credit
    return c.credit - c.debit
  }

  // Calculate net income from revenue - expenses
  const revenueAccounts = Object.keys(changes).filter(c => c.startsWith('4'))
  const cogsAccounts = Object.keys(changes).filter(c => c.startsWith('5'))
  const expenseAccounts = Object.keys(changes).filter(c => c.startsWith('6'))
  const otherAccounts = Object.keys(changes).filter(c => c.startsWith('7'))

  const totalRevenue = revenueAccounts.reduce((s, c) => s + netChange(c), 0)
  const totalCOGS = cogsAccounts.reduce((s, c) => s + netChange(c), 0)
  const totalExpenses = expenseAccounts.reduce((s, c) => s + netChange(c), 0)
  const totalOther = otherAccounts.reduce((s, c) => s + netChange(c), 0)
  const netIncome = totalRevenue - totalCOGS - totalExpenses + totalOther

  // ── Operating Activities (Indirect Method) ──
  // Start with net income, adjust for non-cash items, then working capital changes
  const depreciation = changes['6300'] ? (changes['6300'].debit - changes['6300'].credit) : 0
  const arChange = -(netChange('1130') || 0 + netChange('1300') || 0) // decrease in AR = cash inflow
  const inventoryChange = -(netChange('1150') || 0) // decrease in inventory = cash inflow
  const apChange = netChange('2100') || 0 // increase in AP = cash inflow
  const payableChange = netChange('2200') || 0 // increase in payables = cash inflow

  const operatingItems = [
    { label: '本期淨利', amount: netIncome, type: 'header' },
    { label: '加：折舊費用', amount: depreciation },
    { label: '應收帳款變動', amount: arChange },
    { label: '存貨變動', amount: inventoryChange },
    { label: '應付帳款變動', amount: apChange },
    { label: '應付薪資變動', amount: payableChange },
  ]
  const operatingTotal = operatingItems.reduce((s, i) => s + i.amount, 0)

  // ── Investing Activities ──
  const fixedAssetChange = -(netChange('1600') || 0) // purchases = cash outflow
  const accDepChange = netChange('1610') || 0 // already accounted for in depreciation
  const investingItems = [
    { label: '固定資產購置', amount: fixedAssetChange },
  ]
  const investingTotal = investingItems.reduce((s, i) => s + i.amount, 0)

  // ── Financing Activities ──
  const shortTermBorrowing = netChange('2200') || 0
  const longTermBorrowing = netChange('2300') || 0
  const equityChange = netChange('3100') || 0
  const financingItems = [
    { label: '短期借款變動', amount: shortTermBorrowing },
    { label: '長期借款變動', amount: longTermBorrowing },
    { label: '股本變動', amount: equityChange },
  ].filter(i => i.amount !== 0)
  const financingTotal = financingItems.reduce((s, i) => s + i.amount, 0)

  const netCashChange = operatingTotal + investingTotal + financingTotal

  // Beginning cash (from accounts table)
  const cashAccount = accounts.find(a => a.code === '1100')
  const bankAccount = accounts.find(a => a.code === '1200' || a.code === '1102')
  const beginningCash = ((cashAccount?.balance || 0) + (bankAccount?.balance || 0)) - (netChange('1100') || 0) - (netChange('1102') || 0) - (netChange('1200') || 0)
  const endingCash = beginningCash + netCashChange

  return {
    operatingItems, operatingTotal,
    investingItems, investingTotal,
    financingItems, financingTotal,
    netCashChange, beginningCash, endingCash,
  }
}

export default function CashFlow() {
  const orgId = useOrgId()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cashFlow, setCashFlow] = useState(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [entriesRes, linesRes, accountsRes] = await Promise.all([
        getJournalEntries(orgId),
        getAllJournalLines(orgId),
        getAccounts(orgId),
      ])

      const entries = (entriesRes.data || []).filter(e => e.status === '已過帳')
      const filteredEntries = entries.filter(e => {
        if (startDate && e.entry_date < startDate) return false
        if (endDate && e.entry_date > endDate) return false
        return true
      })
      const entryIds = new Set(filteredEntries.map(e => e.id))
      const entryMap = Object.fromEntries(filteredEntries.map(e => [e.id, e]))
      const lines = (linesRes.data || []).filter(l => entryIds.has(l.entry_id))
      const accounts = accountsRes.data || []

      const result = generateCashFlowStatement(accounts, lines, entryMap)
      setCashFlow(result)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [orgId])

  const Section = ({ title, icon, items, total, color }) => (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8, color }}>
        {icon} {title}
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 0', paddingLeft: item.type === 'header' ? 0 : 20, fontWeight: item.type === 'header' ? 600 : 400 }}>{item.label}</td>
              <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'monospace', color: item.amount >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {fmtSigned(item.amount)}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--border)' }}>
            <td style={{ padding: '10px 0', fontWeight: 700 }}>小計</td>
            <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: total >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {fmtSigned(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💰</span> 現金流量表</h2>
            <p>Cash Flow Statement — 間接法</p>
          </div>
        </div>
      </div>

      {/* Date filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>期間：</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)' }} />
        <span>~</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)' }} />
        <button className="btn btn-primary" onClick={loadData} disabled={loading}>
          <RefreshCw size={14} /> 查詢
        </button>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {loading ? <LoadingSpinner /> : cashFlow && (
        <div style={{ maxWidth: 700 }}>
          <Section
            title="營業活動現金流量"
            icon={<RefreshCw size={16} />}
            items={cashFlow.operatingItems}
            total={cashFlow.operatingTotal}
            color="var(--accent-blue)"
          />
          <Section
            title="投資活動現金流量"
            icon={<ArrowDownRight size={16} />}
            items={cashFlow.investingItems}
            total={cashFlow.investingTotal}
            color="var(--accent-purple)"
          />
          {cashFlow.financingItems.length > 0 && (
            <Section
              title="籌資活動現金流量"
              icon={<ArrowUpRight size={16} />}
              items={cashFlow.financingItems}
              total={cashFlow.financingTotal}
              color="var(--accent-orange)"
            />
          )}

          {/* Summary */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '2px solid var(--accent-blue)', padding: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 0', fontWeight: 600 }}>本期現金淨增減</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 16, color: cashFlow.netCashChange >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {fmtSigned(cashFlow.netCashChange)}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 0' }}>期初現金及約當現金</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(cashFlow.beginningCash)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '10px 0', fontWeight: 700, fontSize: 15 }}>期末現金及約當現金</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 16, color: 'var(--accent-blue)' }}>
                    {fmt(cashFlow.endingCash)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
