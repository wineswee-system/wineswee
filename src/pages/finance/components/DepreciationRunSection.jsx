import { useEffect, useMemo, useState } from 'react'
import { Calculator, PlayCircle, ChevronDown, ChevronRight } from 'lucide-react'
import Badge from '../../../components/ui/Badge'
import { previewMonthlyDepreciation, runMonthlyDepreciation } from '../../../lib/accounting/fixedAssetOps'
import { getDepreciationRuns, getDepreciationRunLines } from '../../../lib/db/fixedAssetOps'
import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'
import { fmtNT as fmt } from '../../../lib/currency'

// ─── F-A5 折舊提列（月結批次）────────────────────────────────────
// 期別 → 試算（純前端，鏡射 RPC 公式）→ 執行提列（secure_run_monthly_depreciation，
// 同組織同期冪等）→ 歷史批次清單（可展開逐資產明細）。

const METHOD_LABELS = {
  straight_line: '直線法',
  declining_balance: '定率遞減法',
  sum_of_years: '年數合計法',
}

export default function DepreciationRunSection({ assets, orgId }) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [showPreview, setShowPreview] = useState(false)
  const [running, setRunning] = useState(false)
  const [runs, setRuns] = useState([])
  const [expandedRunId, setExpandedRunId] = useState(null)
  const [runLines, setRunLines] = useState({}) // run_id → lines

  const preview = useMemo(
    () => previewMonthlyDepreciation(assets || [], period),
    [assets, period]
  )

  const loadRuns = async () => {
    const { data, error } = await getDepreciationRuns(orgId)
    if (error) toast.error(`載入提列紀錄失敗：${error.message}`)
    else setRuns(data || [])
  }

  useEffect(() => { loadRuns() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const alreadyRun = runs.some(r => r.period === period)

  const handleRun = async () => {
    if (preview.lines.length === 0) return toast.error('本期無可提列折舊的資產')
    const ok = await confirm({
      message: `將為 ${period} 提列 ${preview.lines.length} 項資產、合計 ${fmt(preview.total)} 的折舊並自動拋轉傳票，是否繼續？`,
    })
    if (!ok) return

    setRunning(true)
    try {
      const result = await runMonthlyDepreciation(period)
      if (result?.already_exists) {
        toast.error(`${period} 已提列過（批次冪等），未重複入帳`)
      } else if (result?.skipped) {
        toast.error(`${period} 無可提列折舊，未建立批次`)
      } else {
        toast.success(`已提列 ${period} 折舊，合計 ${fmt(result?.total_amount || 0)}（傳票草稿，請至傳票管理過帳）`)
      }
      await loadRuns()
    } catch (err) {
      toast.error(err.message)
    }
    setRunning(false)
  }

  const toggleRunLines = async (runId) => {
    if (expandedRunId === runId) return setExpandedRunId(null)
    setExpandedRunId(runId)
    if (!runLines[runId]) {
      const { data, error } = await getDepreciationRunLines(runId, orgId)
      if (error) toast.error(`載入明細失敗：${error.message}`)
      else setRunLines(prev => ({ ...prev, [runId]: data || [] }))
    }
  }

  return (
    <div style={{ marginTop: 24, border: '1px solid var(--border)', borderRadius: 12, padding: 20, background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>折舊提列</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            月結批次：試算 → 執行提列 → 自動拋轉「借 折舊費用 / 貸 累計折舊」傳票（同期冪等）
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="month"
            value={period}
            onChange={e => { setPeriod(e.target.value); setShowPreview(false) }}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
          />
          <button className="btn btn-secondary" onClick={() => setShowPreview(v => !v)}>
            <Calculator size={14} /> 試算
          </button>
          <button className="btn btn-primary" onClick={handleRun} disabled={running || alreadyRun}>
            <PlayCircle size={14} /> {running ? '提列中...' : alreadyRun ? '本期已提列' : '執行提列'}
          </button>
        </div>
      </div>

      {/* 試算預覽 */}
      {showPreview && (
        <div className="data-table-wrapper" style={{ marginTop: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>資產編號</th>
                <th>資產名稱</th>
                <th>折舊方法</th>
                <th style={{ textAlign: 'right' }}>{period} 折舊金額</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>本期無可提列折舊的資產</td></tr>
              ) : (
                <>
                  {preview.lines.map(line => (
                    <tr key={line.asset_id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{line.asset_code || '-'}</td>
                      <td>{line.asset_name}</td>
                      <td>{METHOD_LABELS[line.method] || line.method}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(line.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} style={{ fontWeight: 600 }}>合計（{preview.lines.length} 項資產）</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmt(preview.total)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 歷史批次 */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>提列紀錄</div>
        {runs.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 0' }}>尚無提列紀錄</div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>期別</th>
                  <th>狀態</th>
                  <th style={{ textAlign: 'right' }}>提列總額</th>
                  <th>執行人</th>
                  <th>執行時間</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <RunRow
                    key={run.id}
                    run={run}
                    expanded={expandedRunId === run.id}
                    lines={runLines[run.id]}
                    onToggle={() => toggleRunLines(run.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RunRow({ run, expanded, lines, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td style={{ fontFamily: 'monospace' }}>{run.period}</td>
        <td>
          {run.status === 'posted'
            ? <Badge status="success" size="sm">已拋轉傳票</Badge>
            : <Badge status="warning" size="sm">草稿（未拋轉）</Badge>}
        </td>
        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(run.total_amount)}</td>
        <td>{run.executed_by || '-'}</td>
        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {run.executed_at ? new Date(run.executed_at).toLocaleString('zh-TW') : '-'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ padding: 0, background: 'var(--bg-main)' }}>
            {!lines ? (
              <div style={{ padding: 12, fontSize: 13, color: 'var(--text-secondary)' }}>載入中...</div>
            ) : lines.length === 0 ? (
              <div style={{ padding: 12, fontSize: 13, color: 'var(--text-secondary)' }}>無明細</div>
            ) : (
              <table className="data-table" style={{ margin: 0 }}>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id}>
                      <td style={{ paddingLeft: 40 }}>{l.asset_name || `#${l.asset_id}`}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
