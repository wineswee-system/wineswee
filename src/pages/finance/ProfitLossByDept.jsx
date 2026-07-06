import { useState, useEffect, useCallback, useMemo } from 'react'
import { Calendar, Filter, Download, FileText, Building2, Scale } from 'lucide-react'
import { getJournalEntries, getAllJournalLines } from '../../lib/db'
import { getDistinctCostCenters } from '../../lib/db/costCenters'
import { generateProfitLossByCostCenter, allocateCommonExpenses, COMMON_COLUMN } from '../../lib/accounting/costCenterReports'
import { exportToCsv } from '../../lib/exportCsv'
import { openReportPrintWindow, esc } from './components/reportPrint'
import LoadingSpinner from '../../components/LoadingSpinner'
import Badge from '../../components/ui/Badge'
import { useOrgId } from '../../contexts/AuthContext'
import { logger } from '../../lib/logger'
import { fmtNT as fmt } from '../../lib/currency'

// 部門/門市損益（F-A6）：journal_lines.cost_center 維度損益 + 共同費用分攤
// 註：本頁尚未掛路由（src/modules/finance 由路由負責人統一註冊）

function getMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  return { start, end }
}

const METRICS = [
  { key: 'revenue', label: '營業收入' },
  { key: 'cogs', label: '銷貨成本' },
  { key: 'grossProfit', label: '營業毛利', emphasis: true },
  { key: 'expenses', label: '營業費用' },
  { key: 'operatingIncome', label: '營業利益', emphasis: true },
]

export default function ProfitLossByDept() {
  const orgId = useOrgId()
  const defaultRange = getMonthRange()
  const [from, setFrom] = useState(defaultRange.start)
  const [to, setTo] = useState(defaultRange.end)
  const [includeDraft, setIncludeDraft] = useState(false)
  const [ccOptions, setCcOptions] = useState([])
  const [selected, setSelected] = useState([]) // 空 = 全部
  const [allocate, setAllocate] = useState(false)
  const [method, setMethod] = useState('revenue') // revenue | headcount
  const [weights, setWeights] = useState({})
  const [raw, setRaw] = useState({ entries: [], lines: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [entriesRes, linesRes, ccRes] = await Promise.all([
        getJournalEntries(orgId),
        getAllJournalLines(orgId),
        getDistinctCostCenters(orgId),
      ])
      setRaw({ entries: entriesRes.data || [], lines: linesRes.data || [] })
      setCcOptions(ccRes.data || [])
    } catch (err) {
      logger.error('ProfitLossByDept load failed', { error: err?.message })
      setError('資料載入失敗，請重新整理頁面')
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  // 純計算 — 篩選條件改變時即時重算，不需重新取數
  const report = useMemo(() => generateProfitLossByCostCenter(raw.entries, raw.lines, {
    from, to, includeDraft,
    costCenters: selected.length > 0 ? selected : undefined,
  }), [raw, from, to, includeDraft, selected])

  const allocation = useMemo(() => allocate
    ? allocateCommonExpenses(report.columns, report.common, { method, weights })
    : null, [allocate, report, method, weights])

  const displayColumns = allocation ? allocation.columns : report.columns
  const commonColumn = allocation ? allocation.common : report.common

  const toggleCenter = (cc) => setSelected(prev =>
    prev.includes(cc) ? prev.filter(x => x !== cc) : [...prev, cc]
  )

  const buildRows = () => METRICS.map(m => {
    const row = { metric: m.label, emphasis: m.emphasis }
    for (const col of displayColumns) row[col.costCenter] = col[m.key]
    row[COMMON_COLUMN] = commonColumn[m.key]
    row['合計'] = report.total[m.key]
    return row
  })

  const handleExportCsv = () => {
    const cols = [
      { label: '項目', value: 'metric' },
      ...displayColumns.map(c => ({ label: c.costCenter, value: c.costCenter })),
      { label: `${COMMON_COLUMN}費用`, value: COMMON_COLUMN },
      { label: '合計', value: '合計' },
    ]
    exportToCsv(`profit-loss-by-dept_${from}_${to}.csv`, buildRows(), cols)
  }

  const handleExportPdf = () => {
    const headers = ['項目', ...displayColumns.map(c => c.costCenter), `${COMMON_COLUMN}費用`, '合計']
    const bodyRows = buildRows().map(r => `
      <tr${r.emphasis ? ' class="subtotal"' : ''}>
        <td>${esc(r.metric)}</td>
        ${displayColumns.map(c => `<td class="r">${fmt(r[c.costCenter])}</td>`).join('')}
        <td class="r">${fmt(r[COMMON_COLUMN])}</td>
        <td class="r">${fmt(r['合計'])}</td>
      </tr>`).join('')
    const allocHtml = allocation && allocation.allocations.length > 0 ? `
      <h3 class="section">共同費用分攤明細（${method === 'revenue' ? '按營收比' : '按人數/權數比'}${allocation.fallbackEqual ? '，基礎皆為 0 → 平均分攤' : ''}）</h3>
      <table><thead><tr><th>成本中心</th><th class="r">分攤基礎</th><th class="r">比例</th><th class="r">分攤金額</th></tr></thead>
      <tbody>${allocation.allocations.map(a => `
        <tr><td>${esc(a.costCenter)}</td><td class="r">${fmt(a.base)}</td>
        <td class="r">${(a.ratio * 100).toFixed(2)}%</td><td class="r">${fmt(a.allocated)}</td></tr>`).join('')}
        <tr class="total"><td colspan="3">共同費用分攤合計</td><td class="r">${fmt(allocation.totalAllocated)}</td></tr>
      </tbody></table>` : ''
    openReportPrintWindow({
      title: '部門/門市損益表',
      subtitle: `期間：${from} ~ ${to}${includeDraft ? '　（含未過帳）' : ''}${allocate ? '　（含共同費用分攤）' : ''}`,
      bodyHtml: `<table><thead><tr>${headers.map(h => `<th class="r">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${bodyRows}</tbody></table>${allocHtml}`,
    })
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={loadData} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="header-icon">🏬</span> 部門/門市損益
              {includeDraft && <Badge color="orange" size="sm">含未過帳</Badge>}
              {allocate && <Badge color="purple" size="sm">已分攤共同費用</Badge>}
            </h2>
            <p>依 cost_center 維度切分之損益表；未標記部門的分錄列於「{COMMON_COLUMN}」欄，可按營收比/權數比分攤</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Calendar size={14} />
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="form-input" style={{ padding: '6px 12px', fontSize: 13 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>~</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="form-input" style={{ padding: '6px 12px', fontSize: 13 }} />
            <button className="btn btn-primary" onClick={loadData} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Filter size={14} /> 重新取數
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeDraft} onChange={e => setIncludeDraft(e.target.checked)} /> 含未過帳
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

      {/* 成本中心多選 + 分攤設定 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><Building2 size={16} style={{ marginRight: 6 }} /> 成本中心篩選與分攤</div>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>成本中心（未勾選 = 全部）：</span>
            {ccOptions.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>分錄尚無 cost_center 標記</span>}
            {ccOptions.map(cc => (
              <label key={cc} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={selected.includes(cc)} onChange={() => toggleCenter(cc)} /> {cc}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={allocate} onChange={e => setAllocate(e.target.checked)} />
              <Scale size={13} /> 分攤{COMMON_COLUMN}費用
            </label>
            {allocate && (
              <>
                <select className="form-input" style={{ padding: '4px 8px', fontSize: 12, width: 'auto' }} value={method} onChange={e => setMethod(e.target.value)}>
                  <option value="revenue">按營收比（預設）</option>
                  <option value="headcount">按人數/自訂權數比</option>
                </select>
                {method === 'headcount' && displayColumns.map(c => (
                  <label key={c.costCenter} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                    {c.costCenter}
                    <input type="number" min="0" className="form-input" style={{ width: 72, padding: '3px 6px', fontSize: 12 }}
                      value={weights[c.costCenter] ?? ''} placeholder="人數"
                      onChange={e => setWeights(w => ({ ...w, [c.costCenter]: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                  </label>
                ))}
                {allocation?.fallbackEqual && (
                  <Badge status="warning" size="sm">分攤基礎皆為 0 → 已退回平均分攤</Badge>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 損益欄位表 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📊</span> 損益表（成本中心欄位）</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{from} ~ {to}</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>項目</th>
                {displayColumns.map(c => <th key={c.costCenter} style={{ textAlign: 'right' }}>{c.costCenter}</th>)}
                <th style={{ textAlign: 'right' }}>{COMMON_COLUMN}費用</th>
                <th style={{ textAlign: 'right' }}>合計</th>
              </tr>
            </thead>
            <tbody>
              {displayColumns.length === 0 && !commonColumn.expenses && !commonColumn.revenue ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>此期間無{includeDraft ? '' : '已過帳'}分錄</td></tr>
              ) : METRICS.map(m => (
                <tr key={m.key} style={m.emphasis ? { fontWeight: 700, background: 'var(--glass-light)' } : undefined}>
                  <td>{m.label}{m.key === 'expenses' && allocate ? '（含分攤）' : ''}</td>
                  {displayColumns.map(c => (
                    <td key={c.costCenter} style={{ textAlign: 'right', fontFamily: 'monospace', color: m.key === 'operatingIncome' && c[m.key] < 0 ? 'var(--accent-red)' : undefined }}>
                      {fmt(c[m.key])}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{fmt(commonColumn[m.key])}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(report.total[m.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分攤明細 */}
      {allocation && allocation.allocations.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div className="card-title"><Scale size={16} style={{ marginRight: 6 }} /> 共同費用分攤明細</div>
            <Badge color="purple" size="sm">{method === 'revenue' ? '按營收比' : '按人數/權數比'}</Badge>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>成本中心</th><th style={{ textAlign: 'right' }}>分攤基礎</th><th style={{ textAlign: 'right' }}>比例</th><th style={{ textAlign: 'right' }}>分攤金額</th></tr></thead>
              <tbody>
                {allocation.allocations.map(a => (
                  <tr key={a.costCenter}>
                    <td>{a.costCenter}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(a.base)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{(a.ratio * 100).toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(a.allocated)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                  <td colSpan={3} style={{ textAlign: 'right' }}>分攤合計</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(allocation.totalAllocated)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
