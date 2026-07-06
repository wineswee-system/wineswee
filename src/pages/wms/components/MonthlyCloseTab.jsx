import { useState, useEffect, useCallback } from 'react'
import { CalendarCheck, Calculator, Lock, History } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  runInventoryClose, getCloseRuns, getCostingMode, setCostingMode,
  COSTING_MODES, deriveAdjustment,
} from '../../../lib/inventoryMonthlyClose'
import Badge from '../../../components/ui/Badge'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'

// F-C1 月結頁籤：試算 → 確認 → 產傳票 → 鎖定（Valuation.jsx 的「月結」tab）

const fmtMoney = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`
const fmtQty = (n) => (Number(n) || 0).toLocaleString()
const prevMonth = () => {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MonthlyCloseTab() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id ?? null

  const [period, setPeriod] = useState(prevMonth)
  const [result, setResult] = useState(null)     // { run, lines, voucher_number, already_confirmed }
  const [runs, setRuns] = useState([])
  const [mode, setMode] = useState('moving_average')
  const [running, setRunning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(true)

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await getCloseRuns())
    } catch (err) {
      console.error('讀取月結歷史失敗:', err)
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  useEffect(() => { loadRuns() }, [loadRuns])
  useEffect(() => {
    if (orgId) getCostingMode(orgId).then(setMode).catch(() => {})
  }, [orgId])

  const handleModeChange = async (next) => {
    const prev = mode
    setMode(next)
    try {
      await setCostingMode(orgId, next)
      toast.success(`成本模式已切換為「${COSTING_MODES[next]}」`)
    } catch (err) {
      setMode(prev)
      toast.error(err.message || '切換失敗')
    }
  }

  // 試算（confirmed 期間 RPC 只回既有結果，不重算 — 即月結鎖定）
  const loadPeriod = useCallback(async (p, { notifyLocked = false } = {}) => {
    setRunning(true)
    try {
      const data = await runInventoryClose(p)
      setResult(data)
      if (notifyLocked && data?.already_confirmed) {
        toast.success(`${p} 已確認月結，顯示既有結果（期間已鎖定）`)
      }
      return data
    } catch (err) {
      toast.error(err.message || '月結試算失敗')
      return null
    } finally {
      setRunning(false)
    }
  }, [])

  const handleDraft = async () => {
    if (!period) return
    await loadPeriod(period, { notifyLocked: true })
    await loadRuns()
  }

  const handleConfirm = async () => {
    if (!result?.run || result.run.status !== 'draft') return
    const total = result.run.total_adjustment
    if (!(await confirm({
      message: `確認 ${period} 月結？將產生 ${fmtMoney(Math.abs(total))} 的銷貨成本調整傳票並鎖定該期間，不可重算。`,
    }))) return
    setConfirming(true)
    try {
      const data = await runInventoryClose(period, { confirm: true })
      setResult(data)
      toast.success(data?.voucher_number
        ? `月結完成，調整傳票：${data.voucher_number}`
        : '月結完成（差額為 0，未產傳票）')
      await loadRuns()
    } catch (err) {
      toast.error(err.message || '月結確認失敗')
    } finally {
      setConfirming(false)
    }
  }

  const lines = result?.lines || []
  const totals = deriveAdjustment(lines)
  const isDraft = result?.run?.status === 'draft'
  const isConfirmed = result?.run?.status === 'confirmed'

  return (
    <>
      {/* 控制列 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>月結期間</label>
            <input
              type="month"
              className="form-input"
              style={{ fontSize: 12 }}
              value={period}
              onChange={e => setPeriod(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>成本模式</label>
            <select
              className="form-input"
              style={{ fontSize: 12 }}
              value={mode}
              onChange={e => handleModeChange(e.target.value)}
              disabled={!orgId}
            >
              {Object.entries(COSTING_MODES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleDraft} disabled={running || !period}>
              <Calculator size={14} /> {running ? '試算中...' : '試算'}
            </button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={!isDraft || confirming}>
              <Lock size={14} /> {confirming ? '確認中...' : '確認月結'}
            </button>
          </div>
        </div>
      </div>

      {/* 試算結果 */}
      {result && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">期間</div>
              <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {result.run?.period}
                {isConfirmed
                  ? <Badge status="success" dot size="sm">已確認</Badge>
                  : <Badge status="warning" dot size="sm">試算</Badge>}
              </div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">重算出庫成本</div>
              <div className="stat-card-value">{fmtMoney(totals.totalRecalc)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">原出庫成本</div>
              <div className="stat-card-value">{fmtMoney(totals.totalOriginal)}</div>
            </div>
            <div className="stat-card" style={{
              '--card-accent': totals.totalAdjustment >= 0 ? 'var(--accent-orange)' : 'var(--accent-green)',
              '--card-accent-dim': totals.totalAdjustment >= 0 ? 'var(--accent-orange-dim)' : 'var(--accent-green-dim)',
            }}>
              <div className="stat-card-label">調整差額</div>
              <div className="stat-card-value">
                {totals.totalAdjustment >= 0 ? '+' : '−'}{fmtMoney(Math.abs(totals.totalAdjustment))}
              </div>
            </div>
          </div>

          {isConfirmed && result.voucher_number && (
            <div style={{
              padding: 12, marginBottom: 16, borderRadius: 8, fontSize: 13,
              background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', color: 'var(--accent-green)',
            }}>
              <Lock size={13} style={{ verticalAlign: -2 }} /> 該期間已鎖定，調整傳票：<strong style={{ fontFamily: 'monospace' }}>{result.voucher_number}</strong>
              {result.snapshot_count != null && `｜期末快照 ${result.snapshot_count} 筆`}
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">
                <span className="card-title-icon"><CalendarCheck size={16} /></span>
                月結明細（{result.run?.period}）
              </div>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>品號</th>
                    <th>品名</th>
                    <th>倉庫</th>
                    <th style={{ textAlign: 'right' }}>期初量/值</th>
                    <th style={{ textAlign: 'right' }}>進貨量/值(含費用)</th>
                    <th style={{ textAlign: 'right' }}>月加權單價</th>
                    <th style={{ textAlign: 'right' }}>出庫量</th>
                    <th style={{ textAlign: 'right' }}>出庫重算/原值</th>
                    <th style={{ textAlign: 'right' }}>差額</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                      本期無存貨異動
                    </td></tr>
                  )}
                  {lines.map(l => (
                    <tr key={l.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.sku_code || `#${l.sku_id}`}</td>
                      <td>{l.sku_name || '-'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.warehouse_name || '-'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtQty(l.opening_qty)} / {fmtMoney(l.opening_value)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtQty(l.receipt_qty)} / {fmtMoney(l.receipt_value)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtMoney(l.monthly_avg_cost)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtQty(l.issued_qty)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtMoney(l.issued_value_recalc)} / {fmtMoney(l.issued_value_original)}</td>
                      <td style={{
                        textAlign: 'right', fontFamily: 'monospace', fontWeight: 700,
                        color: Number(l.adjustment) === 0 ? 'var(--text-muted)'
                          : Number(l.adjustment) > 0 ? 'var(--accent-orange)' : 'var(--accent-green)',
                      }}>
                        {Number(l.adjustment) > 0 ? '+' : ''}{fmtMoney(l.adjustment)}
                      </td>
                    </tr>
                  ))}
                  {lines.length > 0 && (
                    <tr style={{ background: 'var(--bg-main)', fontWeight: 700 }}>
                      <td colSpan={7} style={{ textAlign: 'right' }}>合計</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtMoney(totals.totalRecalc)} / {fmtMoney(totals.totalOriginal)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: totals.totalAdjustment >= 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>
                        {totals.totalAdjustment > 0 ? '+' : ''}{fmtMoney(totals.totalAdjustment)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 月結歷史 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><History size={16} /></span> 月結歷史</div>
        </div>
        {loadingRuns ? <LoadingSpinner /> : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>期間</th><th>狀態</th><th style={{ textAlign: 'right' }}>調整差額</th><th>執行人</th><th>確認時間</th></tr>
              </thead>
              <tbody>
                {runs.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無月結記錄</td></tr>
                )}
                {runs.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => { setPeriod(r.period); loadPeriod(r.period) }}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.period}</td>
                    <td>
                      {r.status === 'confirmed'
                        ? <Badge status="success" dot size="sm">已確認</Badge>
                        : <Badge status="warning" dot size="sm">試算</Badge>}
                    </td>
                    <td style={{
                      textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
                      color: Number(r.total_adjustment) > 0 ? 'var(--accent-orange)'
                        : Number(r.total_adjustment) < 0 ? 'var(--accent-green)' : 'var(--text-muted)',
                    }}>
                      {Number(r.total_adjustment) > 0 ? '+' : ''}{fmtMoney(r.total_adjustment)}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.executed_by || '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {r.executed_at ? new Date(r.executed_at).toLocaleString('zh-TW') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
