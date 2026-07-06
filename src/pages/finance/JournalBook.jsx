import { useState, useEffect, useCallback } from 'react'
import { BookOpen, Calendar, Filter, Download, FileText, CheckCircle, AlertTriangle } from 'lucide-react'
import { getJournalEntries, getAllJournalLines } from '../../lib/db'
import { generateJournalBook } from '../../lib/accounting'
import { exportToCsv } from '../../lib/exportCsv'
import { openReportPrintWindow, esc } from './components/reportPrint'
import LoadingSpinner from '../../components/LoadingSpinner'
import Badge from '../../components/ui/Badge'
import { useOrgId } from '../../contexts/AuthContext'
import { logger } from '../../lib/logger'

import { fmtNT as fmt } from '../../lib/currency'

function getMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  return { start, end }
}

export default function JournalBook() {
  const orgId = useOrgId()
  const [book, setBook] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const defaultRange = getMonthRange()
  const [from, setFrom] = useState(defaultRange.start)
  const [to, setTo] = useState(defaultRange.end)
  const [includeDraft, setIncludeDraft] = useState(false)

  const loadData = useCallback(async (opts) => {
    setLoading(true)
    setError(null)
    try {
      const [entriesRes, linesRes] = await Promise.all([
        getJournalEntries(orgId),
        getAllJournalLines(orgId),
      ])
      setBook(generateJournalBook(entriesRes.data || [], linesRes.data || [], opts))
    } catch (err) {
      logger.error('JournalBook load failed', { error: err?.message })
      setError('資料載入失敗，請重新整理頁面')
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadData({ from, to, includeDraft }) }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuery = () => loadData({ from, to, includeDraft })
  const handleToggleDraft = () => {
    const next = !includeDraft
    setIncludeDraft(next)
    loadData({ from, to, includeDraft: next })
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const { days = [], months = [], totalDebit = 0, totalCredit = 0, balanced = true, entryCount = 0 } = book || {}

  const flatRows = days.flatMap(day => day.entries.flatMap(en => en.lines.map(l => ({
    date: day.date, entry_number: en.entry_number, status: en.status, description: en.description,
    account_code: l.account_code, account_name: l.account_name, debit: l.debit, credit: l.credit, memo: l.memo,
  }))))

  const handleExportCsv = () => {
    exportToCsv(`journal-book_${from}_${to}.csv`, flatRows, [
      { label: '日期', value: 'date' },
      { label: '傳票編號', value: 'entry_number' },
      { label: '狀態', value: 'status' },
      { label: '摘要', value: r => r.memo || r.description },
      { label: '科目代碼', value: 'account_code' },
      { label: '科目名稱', value: 'account_name' },
      { label: '借方', value: 'debit' },
      { label: '貸方', value: 'credit' },
    ])
  }

  const handleExportPdf = () => {
    const rowsHtml = days.map(day => {
      const entryRows = day.entries.map(en => en.lines.map((l, i) => `
        <tr>
          <td class="c">${i === 0 ? esc(day.date) : ''}</td>
          <td>${i === 0 ? esc(en.entry_number) : ''}</td>
          <td>${esc(l.account_code)} ${esc(l.account_name)}</td>
          <td>${esc(l.memo || en.description)}</td>
          <td class="r">${l.debit ? fmt(l.debit) : ''}</td>
          <td class="r">${l.credit ? fmt(l.credit) : ''}</td>
        </tr>`).join('')).join('')
      return entryRows + `
        <tr class="subtotal"><td colspan="4">日合計　${esc(day.date)}</td>
          <td class="r">${fmt(day.subtotalDebit)}</td><td class="r">${fmt(day.subtotalCredit)}</td></tr>`
    }).join('')
    const monthRows = months.map(m => `
      <tr class="subtotal"><td colspan="4">月合計　${esc(m.month)}</td>
        <td class="r">${fmt(m.totalDebit)}</td><td class="r">${fmt(m.totalCredit)}</td></tr>`).join('')
    openReportPrintWindow({
      title: '日記帳 Journal Book',
      subtitle: `期間：${from} ~ ${to}${includeDraft ? '　（含未過帳）' : ''}`,
      bodyHtml: `<table><thead><tr>
          <th class="c">日期</th><th>傳票編號</th><th>科目</th><th>摘要</th><th class="r">借方</th><th class="r">貸方</th>
        </tr></thead><tbody>${rowsHtml}${monthRows}
        <tr class="total"><td colspan="4">總計</td><td class="r">${fmt(totalDebit)}</td><td class="r">${fmt(totalCredit)}</td></tr>
        </tbody></table>`,
    })
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="header-icon">📖</span> 日記帳 Journal Book
              {includeDraft && <Badge color="orange" size="sm">含未過帳</Badge>}
            </h2>
            <p>依日期／傳票編號排序之全部分錄，含日合計、月合計{includeDraft ? '（含草稿傳票即時試算）' : '（僅含已過帳傳票）'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Calendar size={14} />
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="form-input" style={{ padding: '6px 12px', fontSize: 13 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>~</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="form-input" style={{ padding: '6px 12px', fontSize: 13 }} />
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

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">傳票數</div>
          <div className="stat-card-value">{entryCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">借方合計</div>
          <div className="stat-card-value">{fmt(totalDebit)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">貸方合計</div>
          <div className="stat-card-value">{fmt(totalCredit)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': balanced ? 'var(--accent-green)' : 'var(--accent-red)', '--card-accent-dim': balanced ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">平衡狀態</div>
          <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {balanced
              ? <><CheckCircle size={18} style={{ color: 'var(--accent-green)' }} /> 平衡</>
              : <><AlertTriangle size={18} style={{ color: 'var(--accent-red)' }} /> 不平衡</>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><BookOpen size={16} style={{ marginRight: 6 }} /> 日記帳明細</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{from} ~ {to}</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th><th>傳票編號</th><th>科目</th><th>摘要</th>
                <th style={{ textAlign: 'right' }}>借方</th>
                <th style={{ textAlign: 'right' }}>貸方</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>此期間無{includeDraft ? '' : '已過帳'}傳票</td></tr>
              ) : days.map(day => (
                <DayRows key={day.date} day={day} />
              ))}
              {months.length > 1 && months.map(m => (
                <tr key={m.month} style={{ fontWeight: 700, background: 'var(--accent-cyan-dim)' }}>
                  <td colSpan={4}>月合計　{m.month}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(m.totalDebit)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(m.totalCredit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                <td colSpan={4} style={{ textAlign: 'right' }}>總計</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-green)' }}>{fmt(totalDebit)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-red)' }}>{fmt(totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

function DayRows({ day }) {
  return (
    <>
      {day.entries.map(en => en.lines.map((l, i) => (
        <tr key={`${en.id}-${i}`}>
          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{i === 0 ? day.date : ''}</td>
          <td style={{ fontWeight: 600 }}>
            {i === 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {en.entry_number}
                {en.status === '草稿' && <Badge color="orange" size="sm">草稿</Badge>}
              </span>
            )}
          </td>
          <td><span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 12, marginRight: 6 }}>{l.account_code}</span>{l.account_name}</td>
          <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.memo || en.description}</td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{l.debit ? fmt(l.debit) : '-'}</td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{l.credit ? fmt(l.credit) : '-'}</td>
        </tr>
      )))}
      <tr style={{ fontWeight: 600, background: 'var(--glass-light)' }}>
        <td colSpan={4} style={{ fontSize: 12 }}>日合計　{day.date}</td>
        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(day.subtotalDebit)}</td>
        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(day.subtotalCredit)}</td>
      </tr>
    </>
  )
}
