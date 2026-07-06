import { useState, useEffect, useCallback } from 'react'
import { Landmark, Calendar, Filter, Download, FileText } from 'lucide-react'
import { getJournalEntries, getAllJournalLines, getAccounts, getCostCenters } from '../../lib/db'
import { generateGeneralLedger, CHART_OF_ACCOUNTS } from '../../lib/accounting'
import { exportToCsv } from '../../lib/exportCsv'
import { openReportPrintWindow, esc } from './components/reportPrint'
import LoadingSpinner from '../../components/LoadingSpinner'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { useOrgId } from '../../contexts/AuthContext'
import { logger } from '../../lib/logger'

import { fmtNT as fmt } from '../../lib/currency'
const fmtBal = (n) => n >= 0 ? fmt(n) : `(${fmt(Math.abs(n))})` // 負餘額：紅色 + 括號（專案慣例）

function getMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  return { start, end }
}

export default function GeneralLedger() {
  const orgId = useOrgId()
  const [accounts, setAccounts] = useState([])
  const [costCenters, setCostCenters] = useState([])
  const [ledger, setLedger] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const defaultRange = getMonthRange()
  const [from, setFrom] = useState(defaultRange.start)
  const [to, setTo] = useState(defaultRange.end)
  const [selectedCodes, setSelectedCodes] = useState([]) // 空 = 全部有交易科目
  const [costCenter, setCostCenter] = useState('')
  const [includeDraft, setIncludeDraft] = useState(false)

  const loadData = useCallback(async (opts) => {
    setLoading(true)
    setError(null)
    try {
      const [entriesRes, linesRes, accountsRes, ccRes] = await Promise.all([
        getJournalEntries(orgId),
        getAllJournalLines(orgId),
        getAccounts(orgId),
        getCostCenters(orgId),
      ])
      setAccounts(accountsRes.data?.length ? accountsRes.data : CHART_OF_ACCOUNTS)
      setCostCenters(ccRes.data || [])
      setLedger(generateGeneralLedger(entriesRes.data || [], linesRes.data || [], opts))
    } catch (err) {
      logger.error('GeneralLedger load failed', { error: err?.message })
      setError('資料載入失敗，請重新整理頁面')
    }
    setLoading(false)
  }, [orgId])

  const buildOpts = (overrides = {}) => ({
    from, to, includeDraft,
    accountCodes: selectedCodes,
    costCenter: costCenter || undefined,
    ...overrides,
  })

  useEffect(() => { loadData(buildOpts()) }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuery = () => loadData(buildOpts())
  const handleToggleDraft = () => {
    const next = !includeDraft
    setIncludeDraft(next)
    loadData(buildOpts({ includeDraft: next }))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const ledgerAccounts = ledger?.accounts || []

  const flatRows = ledgerAccounts.flatMap(a => [
    { account: `${a.account_code} ${a.account_name}`, date: from, entry_number: '', memo: '期初餘額', debit: '', credit: '', balance: a.openingBalance },
    ...a.postings.map(p => ({ account: `${a.account_code} ${a.account_name}`, date: p.date, entry_number: p.entry_number, memo: p.memo || p.description, debit: p.debit, credit: p.credit, balance: p.balance })),
    { account: `${a.account_code} ${a.account_name}`, date: to, entry_number: '', memo: '期末餘額', debit: a.totalDebit, credit: a.totalCredit, balance: a.closingBalance },
  ])

  const handleExportCsv = () => {
    exportToCsv(`general-ledger_${from}_${to}.csv`, flatRows, [
      { label: '科目', value: 'account' },
      { label: '日期', value: 'date' },
      { label: '傳票編號', value: 'entry_number' },
      { label: '摘要', value: 'memo' },
      { label: '借方', value: 'debit' },
      { label: '貸方', value: 'credit' },
      { label: '餘額', value: 'balance' },
    ])
  }

  const handleExportPdf = () => {
    const bodyHtml = ledgerAccounts.map(a => `
      <h3 class="section">${esc(a.account_code)} ${esc(a.account_name)}（${esc(a.type)}）</h3>
      <table><thead><tr>
        <th class="c">日期</th><th>傳票編號</th><th>摘要</th><th class="r">借方</th><th class="r">貸方</th><th class="r">餘額</th>
      </tr></thead><tbody>
        <tr class="subtotal"><td colspan="5">期初餘額</td><td class="r">${fmt(a.openingBalance)}</td></tr>
        ${a.postings.map(p => `<tr>
          <td class="c">${esc(p.date)}</td><td>${esc(p.entry_number)}</td><td>${esc(p.memo || p.description)}</td>
          <td class="r">${p.debit ? fmt(p.debit) : ''}</td><td class="r">${p.credit ? fmt(p.credit) : ''}</td><td class="r">${fmt(p.balance)}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="3">期末餘額</td>
          <td class="r">${fmt(a.totalDebit)}</td><td class="r">${fmt(a.totalCredit)}</td><td class="r">${fmt(a.closingBalance)}</td></tr>
      </tbody></table>`).join('')
    openReportPrintWindow({
      title: '總分類帳 General Ledger',
      subtitle: `期間：${from} ~ ${to}${costCenter ? `　｜　成本中心：${costCenter}` : ''}${includeDraft ? '　（含未過帳）' : ''}`,
      bodyHtml,
    })
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="header-icon">📚</span> 總分類帳 General Ledger
              {includeDraft && <Badge color="orange" size="sm">含未過帳</Badge>}
              {costCenter && <Badge color="purple" size="sm">明細帳：{costCenter}</Badge>}
            </h2>
            <p>各科目期初餘額、逐筆過帳與逐筆餘額、期末餘額{includeDraft ? '（含草稿傳票即時試算）' : '（僅含已過帳傳票）'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Calendar size={14} />
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="form-input" style={{ padding: '6px 12px', fontSize: 13 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>~</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="form-input" style={{ padding: '6px 12px', fontSize: 13 }} />
            <select value={costCenter} onChange={e => setCostCenter(e.target.value)} className="form-input" style={{ padding: '6px 12px', fontSize: 13 }}>
              <option value="">全部成本中心</option>
              {costCenters.map(cc => <option key={cc.id ?? cc.code} value={cc.code}>{cc.code} {cc.name}</option>)}
            </select>
            <button className="btn btn-primary" onClick={handleQuery} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Filter size={14} /> 查詢
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeDraft} onChange={handleToggleDraft} /> 含未過帳
            </label>
            <button className="btn" onClick={handleExportCsv} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Download size={14} /> CSV
            </button>
            <button className="btn btn-primary" onClick={handleExportPdf} style={{ fontSize: 12, padding: '6px 12px' }}>
              <FileText size={14} /> 匯出 PDF
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🔎</span> 科目選擇</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>不勾選 = 全部有交易科目（按住 Ctrl 可多選）</span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            multiple
            size={Math.min(8, Math.max(4, accounts.length))}
            value={selectedCodes}
            onChange={e => setSelectedCodes([...e.target.selectedOptions].map(o => o.value))}
            className="form-input"
            style={{ minWidth: 280, fontSize: 13, fontFamily: 'monospace' }}
          >
            {accounts.map(a => (
              <option key={a.code} value={a.code}>{a.code}　{a.name}</option>
            ))}
          </select>
          {selectedCodes.length > 0 && (
            <button className="btn" onClick={() => setSelectedCodes([])} style={{ fontSize: 12, padding: '6px 12px' }}>清除選擇（{selectedCodes.length}）</button>
          )}
        </div>
      </div>

      {ledgerAccounts.length === 0 ? (
        <EmptyState title="此期間無分錄" description="調整期間、科目或成本中心後重新查詢" icon={Landmark} />
      ) : ledgerAccounts.map(a => (
        <div className="card" key={a.account_code} style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">
              <span style={{ fontFamily: 'monospace', marginRight: 8 }}>{a.account_code}</span>
              {a.account_name}
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>{a.type}（{a.normal_side === 'debit' ? '借餘' : '貸餘'}）</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              期末餘額：<span style={{ fontFamily: 'monospace', fontWeight: 700, color: a.closingBalance >= 0 ? 'var(--text-primary)' : 'var(--accent-red)' }}>{fmtBal(a.closingBalance)}</span>
            </span>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>日期</th><th>傳票編號</th><th>摘要</th>
                  <th style={{ textAlign: 'right' }}>借方</th>
                  <th style={{ textAlign: 'right' }}>貸方</th>
                  <th style={{ textAlign: 'right' }}>餘額</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ fontWeight: 600, background: 'var(--glass-light)' }}>
                  <td colSpan={5}>期初餘額</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: a.openingBalance >= 0 ? 'inherit' : 'var(--accent-red)' }}>{fmtBal(a.openingBalance)}</td>
                </tr>
                {a.postings.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.date}</td>
                    <td style={{ fontWeight: 600 }}>{p.entry_number}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {p.memo || p.description}
                      {p.cost_center && <> <Badge color="purple" size="sm">{p.cost_center}</Badge></>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{p.debit ? fmt(p.debit) : '-'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{p.credit ? fmt(p.credit) : '-'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: p.balance >= 0 ? 'inherit' : 'var(--accent-red)' }}>{fmtBal(p.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                  <td colSpan={3}>期末餘額</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-green)' }}>{fmt(a.totalDebit)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-red)' }}>{fmt(a.totalCredit)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: a.closingBalance >= 0 ? 'inherit' : 'var(--accent-red)' }}>{fmtBal(a.closingBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
