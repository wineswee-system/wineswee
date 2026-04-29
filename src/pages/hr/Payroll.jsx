import { useState, useEffect, useMemo, Fragment } from 'react'
import { Plus, ChevronDown, ChevronUp, Send, FileText, DollarSign, Users, CheckCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const STATUS_STYLES = {
  draft: { label: '草稿', bg: 'rgba(255,180,0,0.15)', color: 'var(--accent-yellow, #f0b429)' },
  finalized: { label: '已定案', bg: 'rgba(0,200,150,0.15)', color: 'var(--accent-green)' },
}

export default function Payroll() {
  const { profile } = useAuth()
  const [runs, setRuns] = useState([])
  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [expandedRecord, setExpandedRecord] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newPeriod, setNewPeriod] = useState(() => new Date().toISOString().slice(0, 7))
  const [sendingPayslips, setSendingPayslips] = useState(false)
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [finalizing, setFinalizing] = useState(false)

  const loadData = () => {
    setLoading(true)
    Promise.all([
      supabase.from('payroll_runs').select('*').order('pay_period', { ascending: false }),
      supabase.from('employees').select('id, name, department_id, store_id, departments(name), stores(name)').eq('status', '在職').order('name'),
    ]).then(([r, e]) => {
      setRuns(r.data || [])
      setEmployees(e.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [])

  const empMap = useMemo(() => {
    const m = {}
    employees.forEach(e => { m[e.id] = e })
    return m
  }, [employees])

  const selectedRun = runs.find(r => r.id === selectedRunId)

  // Load records when a run is selected
  const selectRun = async (runId) => {
    if (selectedRunId === runId) {
      setSelectedRunId(null)
      setRecords([])
      return
    }
    setSelectedRunId(runId)
    setExpandedRecord(null)
    setLoadingRecords(true)
    try {
      const { data, error } = await supabase
        .from('payroll_records')
        .select('*')
        .eq('payroll_run_id', runId)
        .order('id')
      if (error) throw error
      setRecords(data || [])
    } catch (err) {
      console.error('Failed to load records:', err)
      alert('載入薪資明細失敗')
    } finally {
      setLoadingRecords(false)
    }
  }

  // Create new payroll run — calls generate_payroll() to auto-calculate
  const handleCreateRun = async () => {
    if (!newPeriod) return
    const exists = runs.find(r => r.pay_period === newPeriod)
    if (exists) return alert('該月份的薪資作業已存在')
    try {
      // Call Postgres function to generate payroll run + records
      const { data, error } = await supabase.rpc('generate_payroll', {
        p_pay_period: newPeriod,
        p_created_by: profile?.id ?? null,
      })
      if (error) throw error
      const result = data?.[0] || data
      alert(`薪資計算完成！共產生 ${result?.records_created || 0} 筆薪資記錄`)
      // Reload runs
      const { data: freshRuns } = await supabase.from('payroll_runs').select('*').order('pay_period', { ascending: false })
      setRuns(freshRuns || [])
      setShowCreateModal(false)
    } catch (err) {
      console.error('Create failed:', err)
      alert('建立失敗：' + (err.message || '未知錯誤'))
    }
  }

  // Send payslips
  const handleSendPayslips = async () => {
    if (!selectedRunId) return
    if (!confirm('確定要發送此期薪資單給所有員工嗎？')) return
    setSendingPayslips(true)
    try {
      const { data, error } = await supabase.functions.invoke('send-payslips', {
        body: { payroll_run_id: selectedRunId },
      })
      if (error) throw error
      alert(data?.message || '薪資單已發送')
      // Refresh records to update payslip_sent_at
      const { data: updated } = await supabase
        .from('payroll_records')
        .select('*')
        .eq('payroll_run_id', selectedRunId)
        .order('id')
      if (updated) setRecords(updated)
    } catch (err) {
      console.error('Send payslips failed:', err)
      alert('發送失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSendingPayslips(false)
    }
  }

  // Finalize payroll run (draft → finalized)
  const handleFinalizeRun = async () => {
    if (!selectedRunId) return
    if (!confirm('確定定案此薪資作業？定案後無法重新計算。')) return
    setFinalizing(true)
    try {
      const { error } = await supabase
        .from('payroll_runs')
        .update({ status: 'finalized', finalized_at: new Date().toISOString() })
        .eq('id', selectedRunId)
      if (error) throw error
      setRuns(prev => prev.map(r => r.id === selectedRunId
        ? { ...r, status: 'finalized', finalized_at: new Date().toISOString() }
        : r
      ))
    } catch (err) {
      console.error('Finalize failed:', err)
      alert('定案失敗：' + (err.message || '未知錯誤'))
    } finally {
      setFinalizing(false)
    }
  }

  // Summary for selected run
  const summary = useMemo(() => {
    if (!records.length) return { totalGross: 0, totalNet: 0, count: 0 }
    return {
      totalGross: records.reduce((s, r) => s + (r.gross_salary || 0), 0),
      totalNet: records.reduce((s, r) => s + (r.net_salary || 0), 0),
      count: records.length,
    }
  }, [records])

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>⚠ {error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>薪資作業</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>管理每月薪資計算與發放</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={16} /> 新增薪資作業
          </button>
        </div>
      </div>

      {/* Payroll Runs List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {runs.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            尚無薪資作業，請點擊上方按鈕新增
          </div>
        ) : runs.map(run => {
          const st = STATUS_STYLES[run.status] || STATUS_STYLES.draft
          const isSelected = selectedRunId === run.id
          return (
            <div key={run.id}>
              {/* Run Header */}
              <div
                onClick={() => selectRun(run.id)}
                style={{
                  background: isSelected ? 'var(--bg-secondary)' : 'var(--bg-card)',
                  border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                  borderRadius: isSelected ? '12px 12px 0 0' : 12,
                  padding: '16px 20px',
                  cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <FileText size={18} style={{ color: 'var(--text-muted)' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{run.pay_period}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {run.finalized_at ? `定案於 ${new Date(run.finalized_at).toLocaleDateString('zh-TW')}` : '尚未定案'}
                    </div>
                  </div>
                  <span style={{
                    padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    background: st.bg, color: st.color,
                  }}>
                    {st.label}
                  </span>
                </div>
                {isSelected ? <ChevronUp size={18} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={18} style={{ color: 'var(--text-muted)' }} />}
              </div>

              {/* Records Panel */}
              {isSelected && (
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--accent-cyan)',
                  borderTop: 'none',
                  borderRadius: '0 0 12px 12px',
                  padding: '20px',
                }}>
                  {loadingRecords ? (
                    <LoadingSpinner message="載入薪資明細..." />
                  ) : (
                    <>
                      {/* Summary Cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                        <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <Users size={15} style={{ color: 'var(--accent-cyan)' }} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>員工人數</span>
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.count}</div>
                        </div>
                        <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <DollarSign size={15} style={{ color: 'var(--accent-green)' }} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>總應發</span>
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(summary.totalGross)}</div>
                        </div>
                        <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <DollarSign size={15} style={{ color: 'var(--accent-cyan)' }} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>總實發</span>
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(summary.totalNet)}</div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                        <button
                          className="btn btn-primary"
                          onClick={handleSendPayslips}
                          disabled={sendingPayslips || records.length === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Send size={14} /> {sendingPayslips ? '發送中...' : '發送薪資單'}
                        </button>
                        {selectedRun?.status === 'draft' && (
                          <button
                            className="btn btn-secondary"
                            onClick={handleFinalizeRun}
                            disabled={finalizing || records.length === 0}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <CheckCircle size={14} /> {finalizing ? '定案中...' : '定案'}
                          </button>
                        )}
                      </div>

                      {/* Records Table */}
                      {records.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>此期尚無薪資明細</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
                                {['', '員工', '應發薪資', '扣除合計', '實發薪資', '薪資單'].map(h => (
                                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {records.map(rec => {
                                const emp = empMap[rec.employee_id]
                                const isExpanded = expandedRecord === rec.id
                                return (
                                  <Fragment key={rec.id}>
                                    <tr
                                      onClick={() => setExpandedRecord(isExpanded ? null : rec.id)}
                                      style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                                    >
                                      <td style={{ padding: '10px 14px', width: 30 }}>
                                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                      </td>
                                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{emp?.name || `#${rec.employee_id}`}</td>
                                      <td style={{ padding: '10px 14px', color: 'var(--accent-green)' }}>{fmt(rec.gross_salary)}</td>
                                      <td style={{ padding: '10px 14px', color: 'var(--accent-red)' }}>{fmt(rec.total_deductions)}</td>
                                      <td style={{ padding: '10px 14px', fontWeight: 700 }}>{fmt(rec.net_salary)}</td>
                                      <td style={{ padding: '10px 14px' }}>
                                        {rec.payslip_sent_at ? (
                                          <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>已發送</span>
                                        ) : (
                                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>未發送</span>
                                        )}
                                      </td>
                                    </tr>
                                    {isExpanded && (
                                      <tr style={{ background: 'var(--bg-tertiary)' }}>
                                        <td colSpan={6} style={{ padding: '16px 20px' }}>
                                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                                            {/* Income */}
                                            <div>
                                              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent-green)' }}>收入項目</div>
                                              <DetailRow label="底薪" value={fmt(rec.base_salary)} />
                                              <DetailRow label="職務津貼" value={fmt(rec.role_allowance)} />
                                              <DetailRow label="餐費津貼" value={fmt(rec.meal_allowance)} />
                                              <DetailRow label="交通津貼" value={fmt(rec.transport_allowance)} />
                                              <DetailRow label="全勤獎金" value={fmt(rec.attendance_bonus_earned)} />
                                              <DetailRow label="加班費" value={fmt(rec.overtime_pay)} />
                                              {rec.other_bonus > 0 && <DetailRow label="其他獎金" value={fmt(rec.other_bonus)} />}
                                              {rec.year_end_bonus > 0 && <DetailRow label="年終獎金" value={fmt(rec.year_end_bonus)} />}
                                              {Array.isArray(rec.custom_allowances_breakdown) && rec.custom_allowances_breakdown.length > 0 && (
                                                <>
                                                  {rec.custom_allowances_breakdown.map((c, i) => (
                                                    <DetailRow key={i} label={`└ ${c.name}`} value={fmt(c.amount)} />
                                                  ))}
                                                  <DetailRow label="自訂津貼合計" value={fmt(rec.custom_allowances_total)} bold />
                                                </>
                                              )}
                                              <DetailRow label="應發合計" value={fmt(rec.gross_salary)} bold />
                                            </div>
                                            {/* Deductions */}
                                            <div>
                                              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent-red)' }}>扣除項目</div>
                                              <DetailRow label="請假扣款" value={fmt(rec.leave_deduction)} />
                                              {rec.late_deduction > 0 && <DetailRow label="遲到扣款" value={fmt(rec.late_deduction)} />}
                                              <DetailRow label="勞保（個人）" value={fmt(rec.labor_ins_employee)} />
                                              <DetailRow label="健保（個人）" value={fmt(rec.health_ins_employee)} />
                                              <DetailRow label="勞退（個人）" value={fmt(rec.labor_pension_employee)} />
                                              <DetailRow label="代扣所得稅" value={fmt(rec.income_tax_withheld)} />
                                              {Array.isArray(rec.legal_deduction_breakdown) && rec.legal_deduction_breakdown.length > 0 && (
                                                <>
                                                  {rec.legal_deduction_breakdown.map((d, i) => (
                                                    <DetailRow
                                                      key={i}
                                                      label={`└ ${d.title}${d.shortfall > 0 ? ' ⚠️' : ''}`}
                                                      value={fmt(d.amount)}
                                                    />
                                                  ))}
                                                  <DetailRow label="法扣合計" value={fmt(rec.legal_deduction_total)} bold />
                                                </>
                                              )}
                                              <DetailRow label="扣除合計" value={fmt(rec.total_deductions)} bold />
                                              {Array.isArray(rec.legal_deduction_breakdown) &&
                                                rec.legal_deduction_breakdown.some(d => d.shortfall > 0) && (
                                                <div style={{
                                                  marginTop: 6, fontSize: 11, color: 'var(--accent-orange)',
                                                  padding: '4px 8px', background: 'rgba(251,146,60,0.08)',
                                                  borderRadius: 6,
                                                }}>
                                                  ⚠️ 部分法扣金額不足當月扣完，已自動延後到下月
                                                </div>
                                              )}
                                            </div>
                                            {/* Summary */}
                                            <div>
                                              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent-cyan)' }}>其他資訊</div>
                                              <DetailRow label="實際工時" value={rec.hours_worked != null ? `${rec.hours_worked} 小時` : '-'} />
                                              <DetailRow label="實發薪資" value={fmt(rec.net_salary)} bold />
                                              <DetailRow label="薪資單發送" value={rec.payslip_sent_at ? new Date(rec.payslip_sent_at).toLocaleString('zh-TW') : '尚未發送'} />
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Create Run Modal */}
      {showCreateModal && (
        <Modal title="新增薪資作業" onClose={() => setShowCreateModal(false)} onSubmit={handleCreateRun} submitLabel="建立">
          <Field label="薪資月份">
            <input className="form-input" type="month" value={newPeriod} onChange={e => setNewPeriod(e.target.value)} />
          </Field>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: 12, borderRadius: 8 }}>
            建立後狀態為「草稿」，完成計算後可定案並發送薪資單。
          </div>
        </Modal>
      )}
    </div>
  )
}

function DetailRow({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}
