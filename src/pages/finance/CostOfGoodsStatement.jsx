import { useState, useEffect, useCallback } from 'react'
import { Package, Filter, Download, FileText, CalendarOff } from 'lucide-react'
import { getJournalEntries, getAllJournalLines } from '../../lib/db'
import { getLatestValuationDate, getValuationTotalByDate } from '../../lib/db/valuationSnapshots'
import { generateCostOfGoodsSold, filterPostableEntries } from '../../lib/accounting'
import { exportToCsv } from '../../lib/exportCsv'
import { openReportPrintWindow, esc } from './components/reportPrint'
import LoadingSpinner from '../../components/LoadingSpinner'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { useOrgId } from '../../contexts/AuthContext'
import { logger } from '../../lib/logger'

import { fmtNT as fmt } from '../../lib/currency'
const fmtSigned = (n) => n >= 0 ? fmt(n) : `(${fmt(Math.abs(n))})`

// 期間（YYYY-MM）→ 期初快照日（上月末）/ 期末快照日（本月末）/ 期間起訖
function periodDates(period) {
  const [y, m] = period.split('-').map(Number)
  const pad = (n) => String(n).padStart(2, '0')
  const lastDay = new Date(y, m, 0).getDate()
  const prevLast = new Date(y, m - 1, 0) // 上月最後一天
  return {
    openingDate: `${prevLast.getFullYear()}-${pad(prevLast.getMonth() + 1)}-${pad(prevLast.getDate())}`,
    closingDate: `${y}-${pad(m)}-${pad(lastDay)}`,
    from: `${y}-${pad(m)}-01`,
    to: `${y}-${pad(m)}-${pad(lastDay)}`,
  }
}

// 本期進貨 / 進貨退出及折讓 — 從分錄以「科目性質」歸類：
// 科目表（constants.js）目前無「進貨/進貨退出及折讓」獨立科目，採名稱判斷 fallback；
// 無進貨科目時退回永續盤存制：存貨（1150）借方 = 本期進貨
function derivePurchases(entries, lines, { from, to, includeDraft }) {
  const usable = filterPostableEntries(entries, { includeDraft })
    .filter(e => (!from || e.entry_date >= from) && (!to || e.entry_date <= to))
  const ids = new Set(usable.map(e => e.id))
  const inPeriod = (lines || []).filter(l => ids.has(l.entry_id))

  let purchases = 0
  let returns = 0
  let purchaseAccountSeen = false
  for (const l of inPeriod) {
    const name = l.account_name || ''
    const debit = Number(l.debit) || 0
    const credit = Number(l.credit) || 0
    if (/進貨退出|進貨折讓/.test(name)) {
      returns += credit - debit
    } else if (/進貨/.test(name)) {
      purchaseAccountSeen = true
      purchases += debit - credit
    }
  }
  if (!purchaseAccountSeen) {
    // 永續盤存制 fallback：存貨科目借方增加視為本期進貨
    for (const l of inPeriod) {
      if (l.account_code === '1150' || l.account_name === '存貨') {
        purchases += Number(l.debit) || 0
      }
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100
  return { purchases: r2(purchases), returns: r2(returns), usedInventoryFallback: !purchaseAccountSeen }
}

export default function CostOfGoodsStatement() {
  const orgId = useOrgId()
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7))
  const [includeDraft, setIncludeDraft] = useState(false)
  const [state, setState] = useState({ statement: null, missing: [], fallback: false, snapshotDates: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadData = useCallback(async (p, draft) => {
    setLoading(true)
    setError(null)
    try {
      const { openingDate, closingDate, from, to } = periodDates(p)

      // 快照日容忍：取 <= 目標日的最近評價日（月結可能落在月末前後）
      const [openSnapDateRes, closeSnapDateRes] = await Promise.all([
        getLatestValuationDate(openingDate, orgId),
        getLatestValuationDate(closingDate, orgId),
      ])
      // 期末快照必須落在本期間內，才代表本期月結已執行
      const closeDate = closeSnapDateRes.data && closeSnapDateRes.data >= from ? closeSnapDateRes.data : null
      const openDate = openSnapDateRes.data

      const missing = []
      if (!openDate) missing.push(`期初（${openingDate}）`)
      if (!closeDate) missing.push(`期末（${closingDate}）`)

      if (missing.length > 0) {
        setState({ statement: null, missing, fallback: false, snapshotDates: null })
        setLoading(false)
        return
      }

      const [openTotalRes, closeTotalRes, entriesRes, linesRes] = await Promise.all([
        getValuationTotalByDate(openDate, undefined, orgId),
        getValuationTotalByDate(closeDate, undefined, orgId),
        getJournalEntries(orgId),
        getAllJournalLines(orgId),
      ])
      if (openTotalRes.data == null || closeTotalRes.data == null) {
        setState({ statement: null, missing: ['快照讀取失敗'], fallback: false, snapshotDates: null })
        setLoading(false)
        return
      }

      const { purchases, returns, usedInventoryFallback } = derivePurchases(
        entriesRes.data || [], linesRes.data || [], { from, to, includeDraft: draft }
      )

      const statement = generateCostOfGoodsSold({
        openingInventory: openTotalRes.data,
        purchases,
        purchaseReturnsAllowances: returns,
        closingInventory: closeTotalRes.data,
        period: p,
      })
      setState({ statement, missing: [], fallback: usedInventoryFallback, snapshotDates: { openDate, closeDate } })
    } catch (err) {
      logger.error('CostOfGoodsStatement load failed', { error: err?.message })
      setError('資料載入失敗，請重新整理頁面')
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadData(period, includeDraft) }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuery = () => loadData(period, includeDraft)
  const handleToggleDraft = () => {
    const next = !includeDraft
    setIncludeDraft(next)
    loadData(period, next)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const { statement, missing, fallback, snapshotDates } = state

  const handleExportCsv = () => {
    if (!statement) return
    exportToCsv(`cogs-statement_${period}.csv`, statement.rows, [
      { label: '項目', value: 'label' },
      { label: '金額', value: 'amount' },
    ])
  }

  const handleExportPdf = () => {
    if (!statement) return
    openReportPrintWindow({
      title: '營業成本表 Cost of Goods Sold Statement',
      subtitle: `期間：${period}${includeDraft ? '　（含未過帳）' : ''}`,
      bodyHtml: `<table><thead><tr><th>項目</th><th class="r">金額</th></tr></thead><tbody>
        ${statement.rows.map(r => `<tr class="${r.emphasis ? 'subtotal' : ''}"><td>${esc(r.label)}</td><td class="r">${fmt(r.amount)}</td></tr>`).join('')}
        <tr class="total"><td>銷貨成本</td><td class="r">${fmt(statement.costOfGoodsSold)}</td></tr>
      </tbody></table>`,
    })
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="header-icon">📦</span> 營業成本表 COGS Statement
              {includeDraft && <Badge color="orange" size="sm">含未過帳</Badge>}
            </h2>
            <p>期初存貨 ＋ 本期進貨（− 進貨退出及折讓）− 期末存貨 ＝ 銷貨成本（存貨取月結快照）</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>期間</span>
            <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="form-input" style={{ padding: '6px 12px', fontSize: 13 }} />
            <button className="btn btn-primary" onClick={handleQuery} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Filter size={14} /> 查詢
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeDraft} onChange={handleToggleDraft} /> 含未過帳
            </label>
            <button className="btn" onClick={handleExportCsv} disabled={!statement} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Download size={14} /> CSV
            </button>
            <button className="btn btn-primary" onClick={handleExportPdf} disabled={!statement} style={{ fontSize: 12, padding: '6px 12px' }}>
              <FileText size={14} /> 匯出 PDF
            </button>
          </div>
        </div>
      </div>

      {!statement ? (
        <div className="card">
          <EmptyState
            icon={CalendarOff}
            title="月結未執行 — 無存貨評價快照"
            description={`此期間缺少存貨月結快照：${missing.join('、')}。營業成本表的期初／期末存貨取自 inventory_valuations 月結快照（F-C1 月加權平均月結），請先於估價作業執行該期月結後再產表；系統不以即時庫存推估數字。`}
          />
        </div>
      ) : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">期初存貨</div>
              <div className="stat-card-value">{fmt(statement.openingInventory)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">進貨淨額</div>
              <div className="stat-card-value">{fmt(statement.netPurchases)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">期末存貨</div>
              <div className="stat-card-value">{fmt(statement.closingInventory)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">銷貨成本</div>
              <div className="stat-card-value">{fmt(statement.costOfGoodsSold)}</div>
            </div>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-header">
              <div className="card-title"><Package size={16} style={{ marginRight: 6 }} /> 營業成本表</div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                快照日：期初 {snapshotDates?.openDate}　期末 {snapshotDates?.closeDate}
              </span>
            </div>
            <div>
              {statement.rows.map((row, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: row.emphasis ? '10px 16px' : '8px 16px 8px 32px',
                  fontWeight: row.emphasis ? 700 : 400,
                  borderBottom: row.emphasis ? '2px solid var(--border-medium)' : '1px solid var(--border-subtle)',
                  background: row.emphasis ? 'var(--glass-light)' : 'transparent',
                }}>
                  <span>{row.label}</span>
                  <span style={{ fontFamily: 'monospace', color: row.amount < 0 ? 'var(--accent-red)' : 'inherit' }}>{fmtSigned(row.amount)}</span>
                </div>
              ))}
            </div>
            {fallback && (
              <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge color="orange" size="sm">科目 fallback</Badge>
                科目表無「進貨」獨立科目 — 本期進貨以存貨（1150）借方彙總（永續盤存制）。
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
