import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Calculator, Play, Sparkles, AlertTriangle, CheckCircle, AlertOctagon, Pencil, FunctionSquare } from 'lucide-react'
import { detectPayrollAnomalies, isConfigured as aiReady } from '../../../lib/ai/hrAI'
import PayrollFormulaModal from './PayrollFormulaModal'

import { toast } from '../../../lib/toast'
import { fmtNT as fmt } from '../../../lib/currency'

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

export default function BatchPayrollModal({ month, batchPreview, batchSaving, onClose, onSave, onSaveAsDraft }) {
  const [anomalyReport, setAnomalyReport] = useState(null)
  const [aiChecking, setAiChecking] = useState(false)
  const [formulaPayroll, setFormulaPayroll] = useState(null)

  const handleAICheck = async () => {
    setAiChecking(true)
    try {
      const result = await detectPayrollAnomalies(batchPreview, month)
      setAnomalyReport(result)
    } catch (err) {
      toast.error('AI 審核失敗：' + err.message)
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
        width: '98%', maxWidth: 1600,
        maxHeight: '92vh',
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

          {/* 對齊廠商 PDF 欄位順序：加項 → 應領 → 扣項 → 減項合計 → 實領 → 雇主負擔 */}
          <div style={{ overflowX: 'auto' }}>
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 11, whiteSpace: 'nowrap', minWidth: 2000 }}>
                <thead>
                  {/* 第 1 列：分組標題 */}
                  <tr style={{ background: 'var(--bg-card)' }}>
                    <th colSpan={4} style={{ position: 'sticky', left: 0, background: 'var(--bg-card)', borderRight: '2px solid var(--border-medium)' }}>員工</th>
                    <th colSpan={11} style={{ textAlign: 'center', color: 'var(--accent-cyan)' }}>薪資項目（加項）</th>
                    <th style={{ textAlign: 'center', background: 'var(--bg-secondary)' }}>應領</th>
                    <th colSpan={6} style={{ textAlign: 'center', color: 'var(--accent-orange)' }}>扣款項目</th>
                    <th style={{ textAlign: 'center', color: 'var(--accent-red)' }}>減項</th>
                    <th style={{ textAlign: 'center', color: 'var(--accent-green)' }}>實領</th>
                    <th colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>雇主負擔</th>
                  </tr>
                  {/* 第 2 列：細欄位 */}
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>姓名</th>
                    <th style={{ position: 'sticky', left: 60, background: 'var(--bg-secondary)', zIndex: 1, color: 'var(--text-muted)' }}>職稱</th>
                    <th style={{ position: 'sticky', left: 140, background: 'var(--bg-secondary)', zIndex: 1, color: 'var(--text-muted)' }}>部門</th>
                    <th style={{ position: 'sticky', left: 230, background: 'var(--bg-secondary)', zIndex: 1, borderRight: '2px solid var(--border-medium)', color: 'var(--text-muted)', textAlign: 'center' }}>公式</th>
                    {/* 加項 11 欄 */}
                    <th>本薪</th>
                    <th>伙食津貼</th>
                    <th>主管加給</th>
                    <th>夜間津貼</th>
                    <th>跨店津貼</th>
                    <th>其他津貼</th>
                    <th>加班費</th>
                    <th title="過期補休自動兌現（已含在加班費內）">過期補休</th>
                    <th>額外加班</th>
                    <th>獎金</th>
                    <th>請假折現</th>
                    {/* 應領 */}
                    <th style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>應領合計</th>
                    {/* 扣項 6 欄 */}
                    <th style={{ color: 'var(--accent-orange)' }}>投保</th>
                    <th style={{ color: 'var(--accent-orange)' }}>勞保</th>
                    <th style={{ color: 'var(--accent-orange)' }}>健保</th>
                    <th style={{ color: 'var(--accent-orange)' }}>勞退自提</th>
                    <th style={{ color: 'var(--accent-orange)' }}>請假扣</th>
                    <th style={{ color: 'var(--accent-orange)' }}>法扣</th>
                    {/* 減項 + 實領 */}
                    <th style={{ color: 'var(--accent-red)', fontWeight: 700 }}>減項合計</th>
                    <th style={{ color: 'var(--accent-green)', fontWeight: 800 }}>實領</th>
                    {/* 雇主負擔 4 欄 */}
                    <th style={{ color: 'var(--text-muted)' }}>勞保(公司)</th>
                    <th style={{ color: 'var(--text-muted)' }}>健保(公司)</th>
                    <th style={{ color: 'var(--text-muted)' }}>勞退(公司)</th>
                    <th style={{ color: 'var(--text-muted)', fontWeight: 700 }}>合計</th>
                  </tr>
                </thead>
                <tbody>
                  {batchPreview.map((p, i) => {
                    const hasAnomaly = anomalyReport?.anomalies?.some(a => a.employee === p.employee)
                    const employerTotal = (p.laborEmployer || 0) + (p.healthEmployer || 0) + (p.pensionEmployer || 0)
                    const leaveDeduction = (p.absenceDeduction || 0) + (p.lateDeduction || 0)
                    const rowBg = hasAnomaly ? 'rgba(245,158,11,0.06)' : undefined
                    return (
                      <tr key={i} style={rowBg ? { background: rowBg } : undefined}>
                        <td style={{ position: 'sticky', left: 0, background: rowBg || 'var(--bg-secondary)', fontWeight: 600 }}>
                          {hasAnomaly && <AlertTriangle size={10} style={{ color: 'var(--accent-orange)', marginRight: 3 }} />}
                          {p.employee}
                          {(p.salary_prorate_ratio != null && p.salary_prorate_ratio < 0.9999) && (
                            <span
                              title={[
                                `薪資比例：${p.salary_actual_wd}/${p.salary_total_wd} 曆日（${(p.salary_prorate_ratio * 100).toFixed(1)}%）`,
                                p.is_partial_month ? `在保比例：${p.in_service_days}/${p.month_days} 曆日` : null,
                                p.join_date   ? `入職 ${p.join_date}`   : null,
                                p.resign_date ? `離職 ${p.resign_date}` : null,
                              ].filter(Boolean).join(' · ')}
                              style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 4, fontSize: 9, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', fontWeight: 600 }}
                            >
                              {p.salary_actual_wd}/{p.salary_total_wd}日
                            </span>
                          )}
                        </td>
                        <td style={{ position: 'sticky', left: 60, background: rowBg || 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{p.position || '-'}</td>
                        <td style={{ position: 'sticky', left: 140, background: rowBg || 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{p.dept || '-'}</td>
                        <td style={{ position: 'sticky', left: 230, background: rowBg || 'var(--bg-secondary)', borderRight: '2px solid var(--border-medium)', textAlign: 'center' }}>
                          <button
                            onClick={() => setFormulaPayroll(p)}
                            title="看完整計算公式"
                            style={{ padding: '2px 6px', border: '1px solid var(--accent-cyan)', background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', borderRadius: 4, cursor: 'pointer', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          >
                            <FunctionSquare size={10} /> 看
                          </button>
                        </td>
                        {/* 加項 */}
                        <td>{p.base_salary?.toLocaleString() || 0}</td>
                        <td>{p.meal_allowance?.toLocaleString() || 0}</td>
                        <td>{p.role_allowance?.toLocaleString() || 0}</td>
                        <td>{p.night_allowance?.toLocaleString() || 0}</td>
                        <td>{p.cross_store_allowance?.toLocaleString() || 0}</td>
                        <td>{p.other_custom_total?.toLocaleString() || 0}</td>
                        <td>{p.regular_overtime_pay?.toLocaleString() || 0}</td>
                        <td style={{ color: p.comp_time_settled_pay > 0 ? 'var(--accent-orange)' : 'var(--text-muted)' }}
                            title={p.comp_time_settled_count > 0 ? `${p.comp_time_settled_count} 筆過期補休兌現` : ''}>
                          {p.comp_time_settled_pay > 0 ? p.comp_time_settled_pay.toLocaleString() : '-'}
                        </td>
                        <td>{p.extra_overtime_pay?.toLocaleString() || 0}</td>
                        <td>{p.policyBonus?.toLocaleString() || 0}</td>
                        <td style={{ color: 'var(--text-muted)' }}>0</td>{/* 請假折現（特休未休） — Stage #5 補 */}
                        {/* 應領 */}
                        <td style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>{fmt(p.gross)}</td>
                        {/* 扣項 */}
                        <td style={{ color: 'var(--text-muted)' }}>
                          {(p.insuredLabor === p.insuredHealth)
                            ? (p.insuredLabor?.toLocaleString() || 0)
                            : (
                              <span title="勞保上限 45,800 / 健保上限 313,000，高薪員工兩者不同">
                                <span>勞 {p.insuredLabor?.toLocaleString() || 0}</span>
                                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
                                <span>健 {p.insuredHealth?.toLocaleString() || 0}</span>
                              </span>
                            )}
                        </td>
                        <td style={{ color: 'var(--accent-orange)' }}>{p.laborInsurance > 0 ? `-${p.laborInsurance.toLocaleString()}` : 0}</td>
                        <td style={{ color: 'var(--accent-orange)' }}>{p.healthInsurance > 0 ? `-${p.healthInsurance.toLocaleString()}` : 0}</td>
                        <td style={{ color: 'var(--accent-orange)' }}>{p.pension > 0 ? `-${p.pension.toLocaleString()}` : 0}</td>
                        <td style={{ color: 'var(--accent-orange)' }}>{leaveDeduction > 0 ? `-${leaveDeduction.toLocaleString()}` : 0}</td>
                        <td style={{ color: 'var(--accent-orange)' }}>{p.legal_deduction > 0 ? `-${p.legal_deduction.toLocaleString()}` : 0}</td>
                        {/* 減項合計 + 實領 */}
                        <td style={{ color: 'var(--accent-red)', fontWeight: 600 }}>-{p.totalDeductions?.toLocaleString() || 0}</td>
                        <td style={{ color: 'var(--accent-green)', fontWeight: 800 }}>{fmt(p.netSalary)}</td>
                        {/* 雇主負擔 */}
                        <td style={{ color: 'var(--text-muted)' }}>{p.laborEmployer?.toLocaleString() || 0}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{p.healthEmployer?.toLocaleString() || 0}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{p.pensionEmployer?.toLocaleString() || 0}</td>
                        <td style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{employerTotal.toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                    <td colSpan={4} style={{ position: 'sticky', left: 0, background: 'var(--bg-secondary)' }}>合計</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.base_salary || 0), 0).toLocaleString()}</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.meal_allowance || 0), 0).toLocaleString()}</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.role_allowance || 0), 0).toLocaleString()}</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.night_allowance || 0), 0).toLocaleString()}</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.cross_store_allowance || 0), 0).toLocaleString()}</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.other_custom_total || 0), 0).toLocaleString()}</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.regular_overtime_pay || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>{batchPreview.reduce((s, p) => s + (p.comp_time_settled_pay || 0), 0).toLocaleString()}</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.extra_overtime_pay || 0), 0).toLocaleString()}</td>
                    <td>{batchPreview.reduce((s, p) => s + (p.policyBonus || 0), 0).toLocaleString()}</td>
                    <td>0</td>
                    <td style={{ background: 'var(--bg-secondary)' }}>{fmt(batchPreview.reduce((s, p) => s + (p.gross || 0), 0))}</td>
                    <td style={{ color: 'var(--text-muted)' }}>—</td>
                    <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + (p.laborInsurance || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + (p.healthInsurance || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + (p.pension || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + (p.absenceDeduction || 0) + (p.lateDeduction || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + (p.legal_deduction || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-red)' }}>-{batchPreview.reduce((s, p) => s + (p.totalDeductions || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-green)' }}>{fmt(batchPreview.reduce((s, p) => s + (p.netSalary || 0), 0))}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{batchPreview.reduce((s, p) => s + (p.laborEmployer || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{batchPreview.reduce((s, p) => s + (p.healthEmployer || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{batchPreview.reduce((s, p) => s + (p.pensionEmployer || 0), 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{batchPreview.reduce((s, p) => s + (p.laborEmployer || 0) + (p.healthEmployer || 0) + (p.pensionEmployer || 0), 0).toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            已含加班費 / 績效獎金 / 出勤扣 / 法扣。橫向滑動看完整欄位。儲存後可逐筆編輯調整。
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {aiReady() && (
              <button className="btn btn-secondary" onClick={handleAICheck} disabled={aiChecking} style={{ fontSize: 12 }}>
                <Sparkles size={13} /> {aiChecking ? 'AI 審核中...' : 'AI 薪資審核'}
              </button>
            )}
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            {onSaveAsDraft && (
              <button className="btn btn-secondary"
                onClick={onSaveAsDraft}
                disabled={batchSaving}
                title="儲存為 draft 狀態，跳到逐筆調整頁繼續編輯"
                style={{ borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }}>
                <Pencil size={14} /> {batchSaving ? '儲存中...' : '存為草稿 → 逐筆調整'}
              </button>
            )}
            <button className="btn btn-primary" onClick={onSave} disabled={batchSaving}>
              {batchSaving ? '儲存中...' : (<><Play size={14} /> 確認儲存 {batchPreview.length} 筆</>)}
            </button>
          </div>
        </div>

      </div>

      {formulaPayroll && (
        <PayrollFormulaModal
          payroll={formulaPayroll}
          month={month}
          onClose={() => setFormulaPayroll(null)}
        />
      )}
    </div>
  )
}
