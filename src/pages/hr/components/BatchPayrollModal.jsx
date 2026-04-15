import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Calculator, Play, Sparkles, AlertTriangle, CheckCircle, AlertOctagon } from 'lucide-react'
import { detectPayrollAnomalies, isConfigured as aiReady } from '../../../lib/ai/hrAI'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const STATUS_ICON = {
  clean: { icon: CheckCircle, color: 'var(--accent-green)', label: '正常' },
  warning: { icon: AlertTriangle, color: 'var(--accent-orange)', label: '警告' },
  critical: { icon: AlertOctagon, color: 'var(--accent-red)', label: '嚴重' },
}

const SEVERITY_STYLE = {
  high: { color: 'var(--accent-red)', bg: 'rgba(239,68,68,0.12)' },
  medium: { color: 'var(--accent-orange)', bg: 'rgba(245,158,11,0.12)' },
  low: { color: 'var(--accent-cyan)', bg: 'rgba(6,182,212,0.12)' },
}

export default function BatchPayrollModal({ month, batchPreview, batchSaving, onClose, onSave }) {
  const [anomalyReport, setAnomalyReport] = useState(null)
  const [aiChecking, setAiChecking] = useState(false)

  const handleAICheck = async () => {
    setAiChecking(true)
    try {
      const result = await detectPayrollAnomalies(batchPreview, month)
      setAnomalyReport(result)
    } catch (err) {
      alert('AI 審核失敗：' + err.message)
    } finally {
      setAiChecking(false)
    }
  }

  const statusInfo = anomalyReport ? (STATUS_ICON[anomalyReport.status] || STATUS_ICON.warning) : null
  const StatusIcon = statusInfo?.icon

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 16,
        width: '100%', maxWidth: 960,
        maxHeight: '90vh',
        boxShadow: 'var(--shadow-xl)',
        animation: 'fadeIn 0.15s ease',
        display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>
            <Calculator size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            批次計薪預覽 — {month}
          </h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {anomalyReport && StatusIcon && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: statusInfo.color }}>
                <StatusIcon size={14} /> {statusInfo.label} · {anomalyReport.anomaly_count || 0} 項異常
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {batchPreview.length} 位員工</span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {/* AI Anomaly Report */}
          {anomalyReport && (
            <div style={{
              marginBottom: 16, padding: 16, borderRadius: 10,
              background: anomalyReport.status === 'clean' ? 'rgba(16,185,129,0.06)' : anomalyReport.status === 'critical' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
              border: `1px solid ${statusInfo.color}30`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} style={{ color: 'var(--accent-cyan)' }} /> AI 薪資審核結果
              </div>
              {anomalyReport.summary && (
                <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>{anomalyReport.summary}</div>
              )}

              {/* Anomalies */}
              {(anomalyReport.anomalies || []).length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {anomalyReport.anomalies.map((a, i) => {
                    const sev = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.medium
                    return (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6, padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, borderLeft: `3px solid ${sev.color}` }}>
                        <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, color: sev.color, background: sev.bg, whiteSpace: 'nowrap' }}>
                          {a.severity === 'high' ? '高' : a.severity === 'medium' ? '中' : '低'}
                        </span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{a.employee}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>{a.detail}</span>
                          {a.suggestion && <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 2 }}>{a.suggestion}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Compliance issues */}
              {(anomalyReport.compliance_issues || []).length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--accent-orange)' }}>合規提醒</div>
                  {anomalyReport.compliance_issues.map((c, i) => (
                    <div key={i} style={{ fontSize: 12, marginBottom: 2, paddingLeft: 10, borderLeft: '2px solid var(--accent-orange)' }}>{c}</div>
                  ))}
                </div>
              )}

              {/* Suggestions */}
              {(anomalyReport.suggestions || []).length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--accent-green)' }}>改善建議</div>
                  {anomalyReport.suggestions.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, marginBottom: 2, color: 'var(--text-secondary)' }}>• {s}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="data-table-wrapper">
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>員工</th>
                  <th>部門</th>
                  <th>底薪</th>
                  <th>總薪資</th>
                  <th style={{ color: 'var(--accent-orange)' }}>勞保</th>
                  <th style={{ color: 'var(--accent-orange)' }}>健保</th>
                  <th style={{ color: 'var(--accent-red)' }}>所得稅</th>
                  <th style={{ color: 'var(--accent-red)' }}>扣除合計</th>
                  <th style={{ color: 'var(--accent-green)', fontWeight: 800 }}>實領</th>
                </tr>
              </thead>
              <tbody>
                {batchPreview.map((p, i) => {
                  const hasAnomaly = anomalyReport?.anomalies?.some(a => a.employee === p.employee)
                  return (
                    <tr key={i} style={hasAnomaly ? { background: 'rgba(245,158,11,0.06)' } : undefined}>
                      <td style={{ fontWeight: 600 }}>
                        {hasAnomaly && <AlertTriangle size={11} style={{ color: 'var(--accent-orange)', marginRight: 4 }} />}
                        {p.employee}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.dept || '-'}</td>
                      <td>{fmt(p.base_salary)}</td>
                      <td>{fmt(p.gross)}</td>
                      <td style={{ color: 'var(--accent-orange)' }}>-{p.laborInsurance.toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-orange)' }}>-{p.healthInsurance.toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-red)' }}>{p.incomeTax > 0 ? `-${p.incomeTax.toLocaleString()}` : '—'}</td>
                      <td style={{ color: 'var(--accent-red)', fontWeight: 600 }}>-{p.totalDeductions.toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-green)', fontWeight: 800 }}>{fmt(p.netSalary)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                  <td colSpan={3}>合計</td>
                  <td>{fmt(batchPreview.reduce((s, p) => s + p.gross, 0))}</td>
                  <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + p.laborInsurance, 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + p.healthInsurance, 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-red)' }}>-{batchPreview.reduce((s, p) => s + p.incomeTax, 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-red)' }}>-{batchPreview.reduce((s, p) => s + p.totalDeductions, 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-green)' }}>{fmt(batchPreview.reduce((s, p) => s + p.netSalary, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            使用員工底薪計算，不含加班費 / 獎金 / 扣款。儲存後可逐筆編輯調整。
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {aiReady() && (
              <button className="btn btn-secondary" onClick={handleAICheck} disabled={aiChecking} style={{ fontSize: 12 }}>
                <Sparkles size={13} /> {aiChecking ? 'AI 審核中...' : 'AI 薪資審核'}
              </button>
            )}
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={onSave} disabled={batchSaving}>
              {batchSaving ? '儲存中...' : (<><Play size={14} /> 確認儲存 {batchPreview.length} 筆</>)}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
