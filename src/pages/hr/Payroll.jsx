import { useState, useEffect, useMemo, Fragment, memo } from 'react'
import { Plus, ChevronDown, ChevronUp, Send, FileText, DollarSign, Users, CheckCircle, Download, Upload, Gift, Receipt, Shield } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getPayrollRuns, getPayrollRecords, getActiveEmployees, updatePayrollRun, upsertSalaryRecord } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { getEventBus } from '../../lib/events/index.js'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
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
  const [exportingBank, setExportingBank] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState([])
  const [importHeaders, setImportHeaders] = useState([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [showYearEndModal, setShowYearEndModal] = useState(false)
  const [yearEndYear, setYearEndYear] = useState(new Date().getFullYear())
  const [yearEndMonths, setYearEndMonths] = useState('')  // 空字串=用 salary_structures 預設
  const [generatingYearEnd, setGeneratingYearEnd] = useState(false)

  const loadData = () => {
    setLoading(true)
    Promise.all([
      getPayrollRuns(),
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
      toast.error(`薪資計算完成！共產生 ${result?.records_created || 0} 筆薪資記錄`)
      const { data: freshRuns } = await getPayrollRuns()
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
      toast.error(data?.message || '薪資單已發送')
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

  // 二代健保補充保費（now stored in DB, fallback to legacy calc if not set）
  const suppNhi = (rec) => {
    if (rec.nhi_supplementary != null) return rec.nhi_supplementary
    const bonus = (rec.bonus_total || 0)
    return Math.round(Math.max(0, bonus - 2000) * 0.0211)
  }

  // 年終獎金結算
  const handleGenerateYearEnd = async () => {
    if (!yearEndYear) return
    if (!(await confirm({ message: `確定產生 ${yearEndYear} 年度年終獎金結算？\n${yearEndMonths ? `所有員工統一給 ${yearEndMonths} 個月` : '依員工 salary_structures 各自的設定計算'}\n\n注意：同年度只能跑一次，重跑需先刪除既有 run。` }))) return
    setGeneratingYearEnd(true)
    try {
      const { data, error } = await supabase.rpc('generate_year_end_bonus', {
        p_year: yearEndYear,
        p_months_override: yearEndMonths ? Number(yearEndMonths) : null,
        p_created_by: profile?.id ?? null,
      })
      if (error) throw error
      const result = data?.[0] || data
      toast.error(`年終獎金結算完成！\n發放 ${result?.records_created || 0} 人，總金額 NT$ ${(result?.total_amount || 0).toLocaleString()}`)
      const { data: freshRuns } = await getPayrollRuns()
      setRuns(freshRuns || [])
      setShowYearEndModal(false)
    } catch (err) {
      console.error('Year-end bonus failed:', err)
      toast.error('結算失敗：' + (err.message || '未知錯誤'))
    } finally {
      setGeneratingYearEnd(false)
    }
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
      const headers = '員工編號,姓名,身份證,提繳基礎,雇主提繳(6%),員工自提,自提率,合計'
      const rows = data.map(r => [
        r.employee_id, r.employee_name, r.id_number || '',
        r.capped_pension_base, r.employer_contribution,
        r.employee_contribution, `${r.employee_rate_pct || 0}%`,
        r.total_contribution,
      ].join(','))
      const csv = '﻿' + headers + '\n' + rows.join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `勞退提繳清冊_${selectedRun.pay_period}.csv`
      a.click()
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
      const headers = '員工編號,姓名,身份證,所得類別,所得金額,免扣額,應扣額,費率,補充保費,已申報'
      const rows = data.map(r => [
        r.employee_id, r.employee_name, r.id_number || '',
        r.category, r.gross_income, r.exempt_amount, r.taxable_amount,
        `${(r.premium_rate * 100).toFixed(2)}%`, r.premium,
        r.filed ? '是' : '否',
      ].join(','))
      const csv = '﻿' + headers + '\n' + rows.join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `二代健保補充保費_${selectedRun.pay_period}.csv`
      a.click()
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
        return [
          b.employee_number || '',
          b.name || empMap[rec.employee_id]?.name || '',
          b.bank_code || '',
          b.bank_account || '',
          rec.net_salary || 0,
        ].join(',')
      })
      const csv = '員工編號,姓名,銀行代碼,帳號,轉帳金額\n' + rows.join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bankTransfer_${selectedRun?.pay_period || ''}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Bank export failed:', err)
      toast.error('匯出失敗：' + (err.message || '未知錯誤'))
    } finally {
      setExportingBank(false)
    }
  }

  // 薪資CSV匯入 — parse file on selection
  const handleImportFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportResult(null)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target.result.replace(/^﻿/, '') // strip BOM
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) { setImportPreview([]); setImportHeaders([]); return }
      const headers = lines[0].split(',')
      setImportHeaders(headers)
      const preview = lines.slice(1, 6).map(l => l.split(','))
      setImportPreview(preview)
    }
    reader.readAsText(file, 'utf-8')
  }

  // 確認匯入
  const handleConfirmImport = async () => {
    if (!importFile) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await importFile.text()
      const clean = text.replace(/^﻿/, '')
      const lines = clean.split(/\r?\n/).filter(l => l.trim())
      const dataLines = lines.slice(1)
      let success = 0, failed = 0
      for (const line of dataLines) {
        const cols = line.split(',')
        const [employeeName, month, base_salary, allowance, overtime, deductions, insurance, net_salary] = cols
        if (!employeeName || !month) { failed++; continue }
        try {
          await upsertSalaryRecord({
            employee: employeeName.trim(),
            month: month.trim(),
            base_salary: Number(base_salary) || 0,
            allowance: Number(allowance) || 0,
            overtime: Number(overtime) || 0,
            deductions: Number(deductions) || 0,
            insurance: Number(insurance) || 0,
            net_salary: Number(net_salary) || 0,
          })
          success++
        } catch {
          failed++
        }
      }
      setImportResult({ success, failed })
    } catch (err) {
      console.error('Import failed:', err)
      toast.error('匯入失敗：' + (err.message || '未知錯誤'))
    } finally {
      setImporting(false)
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
                                              {rec.unused_leave_payout > 0 && <DetailRow label={`未休特休折現（${rec.unused_leave_days || 0} 天）`} value={fmt(rec.unused_leave_payout)} />}
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
                                              {suppNhi(rec) > 0 && (
                                                <DetailRow label="二代健保補充保費 (2.11%)" value={fmt(suppNhi(rec))} />
                                              )}
                                              {Array.isArray(rec.nhi_supplementary_breakdown) && rec.nhi_supplementary_breakdown.length > 0 && (
                                                rec.nhi_supplementary_breakdown.map((n, i) => (
                                                  <DetailRow key={`nhi-${i}`} label={`└ ${n.category}`} value={fmt(n.premium)} />
                                                ))
                                              )}
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
            建立後狀態為「草稿」，完成計算後可定案並發送薪資單。<br />
            <b style={{ color: 'var(--accent-green)' }}>新版增功能：</b>離職員工最後當月會自動結算未休完特休折現、扣繳二代健保補充保費（加班費超月投保金額部分）、員工自願自提勞退（從 employees.labor_pension_self_rate 抓）。
          </div>
        </Modal>
      )}

      {/* Year-End Bonus Modal */}
      {showYearEndModal && (
        <Modal title="年終獎金結算" onClose={() => setShowYearEndModal(false)} onSubmit={handleGenerateYearEnd} submitLabel={generatingYearEnd ? '結算中...' : '產生年終獎金'}>
          <Field label="年度">
            <input className="form-input" type="number" value={yearEndYear} onChange={e => setYearEndYear(Number(e.target.value))} min="2020" max="2099" />
          </Field>
          <Field label="統一月數覆寫（空白=用各員工 salary_structures 設定）">
            <input className="form-input" type="number" step="0.5" value={yearEndMonths} onChange={e => setYearEndMonths(e.target.value)} placeholder="例：1.5" />
          </Field>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: 12, borderRadius: 8, lineHeight: 1.6 }}>
            <b>計算方式：</b>每員工年終 = base_salary × 月數<br />
            <b>稅務：</b>使用月度扣繳級距計算所得稅<br />
            <b>二代健保：</b>累計年度獎金超過月投保 4 倍門檻時，超出部分扣 2.11%<br />
            <b>注意：</b>同年度只能跑 1 次（pay_period='YYYY-13'），重跑需先刪除既有 run<br />
            <b>對象：</b>當年度在職 + 當年度離職員工
          </div>
        </Modal>
      )}

      {/* Import Payroll Modal */}
      {showImportModal && (
        <Modal
          title="匯入薪資"
          onClose={() => {
            setShowImportModal(false)
            setImportFile(null)
            setImportPreview([])
            setImportHeaders([])
            setImportResult(null)
          }}
          onSubmit={importResult ? null : handleConfirmImport}
          submitLabel={importing ? '匯入中...' : '確認匯入'}
          submitDisabled={importing || !importFile || importPreview.length === 0}
        >
          <div style={{ fontSize: 13, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
            請上傳 CSV 格式（UTF-8 with BOM）<br />
            欄位順序：<code style={{ fontSize: 12 }}>員工姓名,月份(YYYY-MM),基本薪資,津貼,加班費,扣除項,勞保,淨薪資</code>
          </div>
          <Field label="選擇檔案">
            <input
              className="form-input"
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
            />
          </Field>
          {importPreview.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>預覽（前 {importPreview.length} 筆）</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-tertiary)' }}>
                      {importHeaders.map((h, i) => (
                        <th key={i} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.map((row, ri) => (
                      <tr key={ri} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ padding: '5px 10px', color: 'var(--text-secondary)' }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {importResult && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 8,
              background: importResult.failed === 0 ? 'rgba(0,200,150,0.1)' : 'rgba(251,146,60,0.1)',
              color: importResult.failed === 0 ? 'var(--accent-green)' : 'var(--accent-orange)',
              fontSize: 13, fontWeight: 600,
            }}>
              匯入完成：成功 {importResult.success} 筆{importResult.failed > 0 ? `，失敗 ${importResult.failed} 筆` : ''}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

const DetailRow = memo(function DetailRow({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
})
