import { useState, useEffect, useMemo, Fragment } from 'react'
import { Plus, ChevronDown, ChevronUp, Send, FileText, DollarSign, Users, CheckCircle, Download, Upload, Gift, Receipt, Shield } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getPayrollRuns, getPayrollRecords, getActiveEmployees, updatePayrollRun, upsertSalaryRecord } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { getEventBus } from '../../lib/events/index.js'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { exportToCsv } from '../../lib/exportCsv'
import ImportModal from './components/ImportModal'
import YearEndBonusModal from './components/YearEndBonusModal'
import PayslipRow from './components/PayslipRow'

import { fmtNT as fmt } from '../../lib/currency'

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
  const [exportingBank, setExportingBank] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showYearEndModal, setShowYearEndModal] = useState(false)

  const loadData = () => {
    setLoading(true)
    Promise.all([
      getPayrollRuns(profile?.organization_id),
      getActiveEmployees('id, name, department_id, store_id, departments(name), stores(name)', profile?.organization_id),
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

  useEffect(() => { loadData() }, [profile?.organization_id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const { data, error } = await getPayrollRecords(runId)
      if (error) throw error
      setRecords(data || [])
    } catch (err) {
      console.error('Failed to load records:', err)
      toast.error('載入薪資明細失敗')
    } finally {
      setLoadingRecords(false)
    }
  }

  // Create new payroll run — calls generate_payroll() to auto-calculate
  const handleCreateRun = async () => {
    if (!newPeriod) return
    const exists = runs.find(r => r.pay_period === newPeriod)
    if (exists) return toast.error('該月份的薪資作業已存在')
    try {
      // Call Postgres function to generate payroll run + records
      const { data, error } = await supabase.rpc('generate_payroll', {
        p_pay_period: newPeriod,
        p_created_by: profile?.id ?? null,
      })
      if (error) throw error
      const result = data?.[0] || data
      // 外籍移工扣款（仲介費/住宿費/伙食費）— 就業服務法§52
      if (result?.payroll_run_id) {
        await supabase.rpc('apply_fw_deductions', { p_payroll_run_id: result.payroll_run_id })
      }
      toast.success(`薪資計算完成！共產生 ${result?.records_created || 0} 筆薪資記錄`)
      const { data: freshRuns } = await getPayrollRuns(profile?.organization_id)
      setRuns(freshRuns || [])
      setShowCreateModal(false)
    } catch (err) {
      console.error('Create failed:', err)
      toast.error('建立失敗：' + (err.message || '未知錯誤'))
    }
  }

  // Send payslips
  const handleSendPayslips = async () => {
    if (!selectedRunId) return
    if (!(await confirm({ message: '確定要發送此期薪資單給所有員工嗎？' }))) return
    setSendingPayslips(true)
    try {
      const { data, error } = await supabase.functions.invoke('send-payslips', {
        body: { payroll_run_id: selectedRunId },
      })
      if (error) throw error
      toast.success(data?.message || '薪資單已發送')
      const bus = getEventBus()
      const sentRun = runs.find(r => r.id === selectedRunId)
      await bus.publish('hr.payslip.sent', {
        run_id: String(selectedRunId),
        pay_period: sentRun?.pay_period || '',
        recipients_count: records.length,
      })
      // Refresh records to update payslip_sent_at
      const { data: updated } = await supabase
        .from('payroll_records')
        .select('*')
        .eq('payroll_run_id', selectedRunId)
        .order('id')
      if (updated) setRecords(updated)
    } catch (err) {
      console.error('Send payslips failed:', err)
      toast.error('發送失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSendingPayslips(false)
    }
  }

  // Finalize payroll run (draft → finalized)
  const handleFinalizeRun = async () => {
    if (!selectedRunId) return
    if (!(await confirm({ message: '確定定案此薪資作業？定案後無法重新計算。' }))) return
    setFinalizing(true)
    try {
      const { error } = await updatePayrollRun(selectedRunId, { status: 'finalized', finalized_at: new Date().toISOString() })
      if (error) throw error
      setRuns(prev => prev.map(r => r.id === selectedRunId
        ? { ...r, status: 'finalized', finalized_at: new Date().toISOString() }
        : r
      ))
      const bus = getEventBus()
      const finalRun = runs.find(r => r.id === selectedRunId)
      const totalGross = records.reduce((s, r) => s + (r.gross_salary || 0), 0)
      const totalNet = records.reduce((s, r) => s + (r.net_salary || 0), 0)
      await bus.publish('hr.salary.calculated', {
        run_id: String(selectedRunId),
        pay_period: finalRun?.pay_period || '',
        total_gross: totalGross,
        total_net: totalNet,
        records_count: records.length,
      })
    } catch (err) {
      console.error('Finalize failed:', err)
      toast.error('定案失敗：' + (err.message || '未知錯誤'))
    } finally {
      setFinalizing(false)
    }
  }

  // 年終獎金結算完成後重刷 runs
  const handleYearEndComplete = async () => {
    const { data: freshRuns } = await getPayrollRuns()
    setRuns(freshRuns || [])
  }

  // 勞退提繳清冊匯出（CSV）
  const handleExportPensionFiling = async () => {
    if (!selectedRun) return
    try {
      const { data, error } = await supabase
        .from('v_labor_pension_filing_monthly')
        .select('*')
        .eq('pay_period', selectedRun.pay_period)
        .order('employee_name')
      if (error) throw error
      if (!data?.length) return toast.error('查無此期勞退提繳資料')
      exportToCsv(`勞退提繳清冊_${selectedRun.pay_period}.csv`, data, [
        { label: '員工編號',      value: 'employee_id' },
        { label: '姓名',         value: 'employee_name' },
        { label: '身份證',        value: r => r.id_number || '' },
        { label: '提繳基礎',      value: 'capped_pension_base' },
        { label: '雇主提繳(6%)', value: 'employer_contribution' },
        { label: '員工自提',      value: 'employee_contribution' },
        { label: '自提率',        value: r => `${r.employee_rate_pct || 0}%` },
        { label: '合計',         value: 'total_contribution' },
      ])
    } catch (err) {
      toast.error('匯出失敗：' + err.message)
    }
  }

  // 二代健保補充保費申報匯出
  const handleExportNhiSupp = async () => {
    if (!selectedRun) return
    try {
      const { data, error } = await supabase
        .from('v_nhi_supplementary_filing')
        .select('*')
        .eq('pay_period', selectedRun.pay_period)
        .order('category')
      if (error) throw error
      if (!data?.length) return toast.error('該期無補充保費紀錄（沒有員工觸發 2.11% 扣繳）')
      exportToCsv(`二代健保補充保費_${selectedRun.pay_period}.csv`, data, [
        { label: '員工編號', value: 'employee_id' },
        { label: '姓名',    value: 'employee_name' },
        { label: '身份證',  value: r => r.id_number || '' },
        { label: '所得類別', value: 'category' },
        { label: '所得金額', value: 'gross_income' },
        { label: '免扣額',  value: 'exempt_amount' },
        { label: '應扣額',  value: 'taxable_amount' },
        { label: '費率',   value: r => `${(r.premium_rate * 100).toFixed(2)}%` },
        { label: '補充保費', value: 'premium' },
        { label: '已申報',  value: r => r.filed ? '是' : '否' },
      ])
    } catch (err) {
      toast.error('匯出失敗：' + err.message)
    }
  }

  // 銀行轉帳明細表匯出
  const handleBankExport = async () => {
    if (!selectedRunId || records.length === 0) return
    setExportingBank(true)
    try {
      const empIds = records.map(r => r.employee_id)
      const { data: bankData, error: bankErr } = await supabase
        .from('employees')
        .select('id, employee_number, name, bank_code, bank_account')
        .in('id', empIds)
      if (bankErr) throw bankErr
      const bankMap = {}
      ;(bankData || []).forEach(e => { bankMap[e.id] = e })
      const rows = records.map(rec => {
        const b = bankMap[rec.employee_id] || {}
        return {
          employee_number: b.employee_number || '',
          name:            b.name || empMap[rec.employee_id]?.name || '',
          bank_code:       b.bank_code || '',
          bank_account:    b.bank_account || '',
          net_salary:      rec.net_salary || 0,
        }
      })
      exportToCsv(`bankTransfer_${selectedRun?.pay_period || ''}.csv`, rows, [
        { label: '員工編號', value: 'employee_number' },
        { label: '姓名',    value: 'name' },
        { label: '銀行代碼', value: 'bank_code' },
        { label: '帳號',    value: 'bank_account' },
        { label: '轉帳金額', value: 'net_salary' },
      ])
    } catch (err) {
      console.error('Bank export failed:', err)
      toast.error('匯出失敗：' + (err.message || '未知錯誤'))
    } finally {
      setExportingBank(false)
    }
  }

  // ── 薪資條列印（開新視窗 + window.print() ） ──
  const printPayslip = (rec, emp, run) => {
    const win = window.open('', '_blank', 'width=720,height=900')
    if (!win) { toast.error('請允許彈出視窗才能列印薪資條'); return }
    const empName = emp?.name || `#${rec.employee_id}`
    const dept = emp?.departments?.name || emp?.dept || ''
    const period = run?.pay_period || rec.pay_period || ''
    const row = (label, val, bold) => val == null || val === 0 || val === '' ? '' :
      `<tr><td style="padding:4px 12px;color:#666;font-size:13px;${bold ? 'font-weight:700;border-top:1px solid #ccc;' : ''}">${label}</td><td style="padding:4px 12px;text-align:right;font-size:13px;${bold ? 'font-weight:700;border-top:1px solid #ccc;' : ''}">${typeof val === 'number' ? fmt(val) : val}</td></tr>`
    win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>薪資條 ${empName} ${period}</title>
<style>
  body { font-family: 'Microsoft JhengHei', sans-serif; padding: 32px; color: #222; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #666; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .section { border: 1px solid #ccc; border-radius: 6px; }
  .section h2 { font-size: 14px; padding: 8px 12px; margin: 0; background: #f5f5f5; border-bottom: 1px solid #ccc; }
  .section table { width: 100%; border-collapse: collapse; }
  .total { margin-top: 16px; padding: 12px; background: #fff8dc; border: 2px solid #d4a017; border-radius: 6px; text-align: center; font-size: 20px; font-weight: 700; }
  @media print { body { padding: 16px; } }
</style></head><body>
<h1>🧾 薪資明細條</h1>
<div class="meta">${empName} ${dept ? '· ' + dept : ''} ｜ ${period} 月</div>
<div class="grid">
  <div class="section"><h2 style="color:#16a34a">應發項目</h2><table>
    ${row('本薪', rec.base_salary)}
    ${rec.base_insured && rec.base_insured !== rec.base_salary ? row('└ 申報底薪', rec.base_insured) : ''}
    ${row('主管加給', (rec.supervisor_allowance || 0) + (rec.role_allowance || 0))}
    ${row('夜班津貼', rec.night_shift_allowance)}
    ${row('跨區津貼', rec.cross_store_allowance)}
    ${row('伙食津貼', rec.meal_allowance)}
    ${row('交通津貼', rec.transport_allowance)}
    ${row('天災津貼', rec.disaster_allowance)}
    ${row('全勤獎金', rec.attendance_bonus_earned)}
    ${row('加班費', rec.overtime_pay)}
    ${row('└ 平日加班', rec.overtime_pay_weekday)}
    ${row('└ 休息日加班', rec.overtime_pay_restday)}
    ${row('└ 例假加班', rec.overtime_pay_holiday)}
    ${row('└ 國定加班', rec.overtime_pay_national)}
    ${row('休息未休補償', rec.rest_day_unused_pay)}
    ${row('補發前期差額', rec.back_pay_adjustment)}
    ${row('績效獎金', rec.performance_bonus)}
    ${row('業績/差額', rec.commission)}
    ${row('三節獎金', rec.festival_bonus)}
    ${row('其他獎金', rec.other_bonus)}
    ${row('年終獎金', rec.year_end_bonus)}
    ${row('未休特休折現', rec.unused_leave_payout)}
    ${row('應發合計', rec.gross_salary, true)}
  </table></div>
  <div class="section"><h2 style="color:#dc2626">扣除項目</h2><table>
    ${row('請假扣款（有薪）', rec.paid_leave_deduction)}
    ${row('請假扣款（無薪）', rec.unpaid_leave_deduction)}
    ${rec.leave_deduction && !rec.paid_leave_deduction && !rec.unpaid_leave_deduction ? row('請假扣款', rec.leave_deduction) : ''}
    ${row('遲到扣款', rec.late_deduction)}
    ${row('預支扣回', rec.advance_recovery)}
    ${row('勞保（個人）', rec.labor_ins_employee)}
    ${row('健保（個人）', rec.health_ins_employee)}
    ${row('勞退（個人）', rec.labor_pension_employee)}
    ${row('代扣所得稅', rec.income_tax_withheld)}
    ${row('二代健保補充', rec.nhi_supplementary)}
    ${row('法扣項目', rec.legal_deduction_total)}
    ${row('扣除合計', rec.total_deductions, true)}
  </table></div>
</div>
<div class="total">實發 NT$ ${(rec.net_salary || 0).toLocaleString()}</div>
${rec.notes ? `<div style="margin-top:12px;padding:8px;background:#f5f5f5;border-radius:4px;font-size:12px;color:#666">備註：${rec.notes}</div>` : ''}
<script>window.onload = () => { window.print(); }</script>
</body></html>`)
    win.document.close()
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowYearEndModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Gift size={16} /> 年終獎金結算
            </button>
            <button className="btn btn-secondary" onClick={() => setShowImportModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Upload size={16} /> 匯入薪資
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={16} /> 新增薪資作業
            </button>
          </div>
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
                        <button
                          className="btn btn-secondary"
                          onClick={handleBankExport}
                          disabled={exportingBank || records.length === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Download size={14} /> {exportingBank ? '匯出中...' : '銀行轉帳'}
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={handleExportPensionFiling}
                          disabled={records.length === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          title="匯出當月雇主 6% + 員工自提明細，給勞保局申報用"
                        >
                          <Receipt size={14} /> 勞退提繳清冊
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={handleExportNhiSupp}
                          disabled={records.length === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          title="匯出當月二代健保補充保費明細，給健保署申報用"
                        >
                          <Shield size={14} /> 二代健保申報
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
                                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                                        {emp?.name || `#${rec.employee_id}`}
                                        {rec.is_final_settlement && (
                                          <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' }}>離職結算</span>
                                        )}
                                      </td>
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
                                      <PayslipRow
                                        record={rec}
                                        employee={emp}
                                        selectedRun={selectedRun}
                                        printPayslip={printPayslip}
                                      />
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
            建立後狀態為「草稿」，完成計算後可定案並發送薪資單。<br />
            <b style={{ color: 'var(--accent-green)' }}>新版增功能：</b>離職員工最後當月會自動結算未休完特休折現、扣繳二代健保補充保費（加班費超月投保金額部分）、員工自願自提勞退（從 employees.labor_pension_self_rate 抓）。
          </div>
        </Modal>
      )}

      <YearEndBonusModal
        open={showYearEndModal}
        onClose={() => setShowYearEndModal(false)}
        runs={runs}
        onComplete={handleYearEndComplete}
      />

      <ImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        employees={employees}
        onImportComplete={loadData}
      />
    </div>
  )
}

