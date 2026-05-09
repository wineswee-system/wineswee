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
    ${row('主管加給', rec.supervisor_allowance)}
    ${row('職務津貼', rec.role_allowance)}
    ${row('夜班津貼', rec.night_shift_allowance)}
    ${row('跨區津貼', rec.cross_store_allowance)}
    ${row('伙食津貼', rec.meal_allowance)}
    ${row('交通津貼', rec.transport_allowance)}
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

  // ── 薪資 CSV 匯入（新版：對應 payroll_records 完整欄位） ──
  // 支援老闆 Excel 格式：前 N 行標題 → 找包含「姓名」的 header row → 跳「總計」row

  // 中文 header → DB column。沒對應的 column 就 ignore。
  // 重複欄位（資食費 vs 伙食津貼）以前者為準。
  const COLUMN_MAP = {
    '本薪': 'base_salary',
    '底薪': 'base_insured',
    '伙食津貼': 'meal_allowance',
    '資食費': 'meal_allowance',          // 老闆 Excel 有兩個都叫伙食的欄位，後面這個會覆蓋前面
    '主管加給': 'supervisor_allowance',
    '夜班津貼': 'night_shift_allowance',
    '跨區津貼': 'cross_store_allowance',
    '加班費': 'overtime_pay_weekday',
    '額外加班費': 'overtime_pay_holiday',
    '公休薪資': 'rest_day_unused_pay',
    '補發前期差額': 'back_pay_adjustment',
    '休息未休': 'unused_leave_payout',
    '折扣差額': 'commission',             // 暫對到 commission；老闆若有差額分類再細分
    '勞保費': 'labor_ins_employee',
    '健保費': 'health_ins_employee',
    '員工自提退休': 'labor_pension_employee',
    '請假扣款(有薪)': 'paid_leave_deduction',
    '請假扣款(無薪)': 'unpaid_leave_deduction',
    '法扣項目': 'legal_deduction_total',
    '應付總計': 'gross_salary',
    '實際薪資': 'net_salary',
    '勞保費(公司負擔)': 'labor_ins_employer',
    '健保費(公司負擔)': 'health_ins_employer',
    '員工退休金提撥(公司負擔)': 'labor_pension_employer',
  }

  // 從原始字串抓 yyyy-MM（例：「2026年04月 台中永春門市 薪資表」→ "2026-04"）
  const extractPayPeriod = (lines) => {
    for (const line of lines.slice(0, 5)) {
      const m = line.match(/(\d{4})\D{0,3}(\d{1,2})/)
      if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
    }
    return null
  }

  // 找 header row（包含「姓名」欄）
  const findHeaderRowIdx = (lines) => {
    return lines.findIndex(l => l.split(',').some(c => c.trim() === '姓名'))
  }

  const handleImportFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportResult(null)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target.result.replace(/^﻿/, '') // strip BOM
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      const headerIdx = findHeaderRowIdx(lines)
      if (headerIdx < 0) {
        setImportHeaders([])
        setImportPreview([])
        toast.error('找不到 header row（沒有「姓名」欄位）')
        return
      }
      const headers = lines[headerIdx].split(',').map(s => s.trim())
      setImportHeaders(headers)
      // 預覽接下來 5 row（跳掉「總計」row）
      const preview = lines.slice(headerIdx + 1, headerIdx + 1 + 8)
        .map(l => l.split(','))
        .filter(cols => {
          const nameIdx = headers.indexOf('姓名')
          const name = cols[nameIdx]?.trim()
          return name && name !== '總計'
        })
        .slice(0, 5)
      setImportPreview(preview)
    }
    reader.readAsText(file, 'utf-8')
  }

  // 確認匯入：對每一筆 row 呼叫 payroll_import_row RPC
  const handleConfirmImport = async () => {
    if (!importFile) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = (await importFile.text()).replace(/^﻿/, '')
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      const payPeriod = extractPayPeriod(lines)
      if (!payPeriod) throw new Error('無法從 CSV 抓出年月（前 5 行需有 yyyy/MM 格式）')

      const headerIdx = findHeaderRowIdx(lines)
      if (headerIdx < 0) throw new Error('找不到 header row（含「姓名」欄）')
      const headers = lines[headerIdx].split(',').map(s => s.trim())
      const nameIdx = headers.indexOf('姓名')
      const dataLines = lines.slice(headerIdx + 1)

      // 員工名 → id 的 map（用 employees 已載入的）
      const empByName = {}
      employees.forEach(e => { empByName[e.name] = e })

      let success = 0, failed = 0, errors = []
      for (const line of dataLines) {
        const cols = line.split(',')
        const empName = cols[nameIdx]?.trim()
        if (!empName || empName === '總計' || empName === '合計') continue
        const emp = empByName[empName]
        if (!emp) {
          failed++
          errors.push(`找不到員工：${empName}`)
          continue
        }
        // 建 payload：依 COLUMN_MAP 把中文 header 對應到 DB 欄
        const payload = {
          pay_period: payPeriod,
          employee_id: emp.id,
          organization_id: profile?.organization_id,
        }
        headers.forEach((h, idx) => {
          const dbCol = COLUMN_MAP[h]
          if (!dbCol) return
          const v = (cols[idx] || '').trim().replace(/[",]/g, '')
          if (v && !isNaN(Number(v))) payload[dbCol] = Number(v)
        })
        try {
          const { data, error } = await supabase.rpc('payroll_import_row', { p_payload: payload })
          if (error) throw error
          if (!data?.ok) throw new Error(data?.error || '未知錯誤')
          success++
        } catch (e) {
          failed++
          errors.push(`${empName}: ${e.message}`)
        }
      }
      setImportResult({ success, failed, errors: errors.slice(0, 10), payPeriod })
      if (success > 0) loadData()
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
                                              <DetailRow label="本薪" value={fmt(rec.base_salary)} />
                                              {rec.base_insured > 0 && rec.base_insured !== rec.base_salary && (
                                                <DetailRow label="└ 申報底薪" value={fmt(rec.base_insured)} />
                                              )}
                                              {rec.supervisor_allowance > 0 && <DetailRow label="主管加給" value={fmt(rec.supervisor_allowance)} />}
                                              <DetailRow label="職務津貼" value={fmt(rec.role_allowance)} />
                                              {rec.night_shift_allowance > 0 && <DetailRow label="夜班津貼" value={fmt(rec.night_shift_allowance)} />}
                                              {rec.cross_store_allowance > 0 && <DetailRow label="跨區津貼" value={fmt(rec.cross_store_allowance)} />}
                                              <DetailRow label="伙食津貼" value={fmt(rec.meal_allowance)} />
                                              <DetailRow label="交通津貼" value={fmt(rec.transport_allowance)} />
                                              <DetailRow label="全勤獎金" value={fmt(rec.attendance_bonus_earned)} />
                                              <DetailRow label="加班費" value={fmt(rec.overtime_pay)} />
                                              {(rec.overtime_pay_weekday > 0 || rec.overtime_pay_restday > 0 || rec.overtime_pay_holiday > 0 || rec.overtime_pay_national > 0) && (
                                                <>
                                                  {rec.overtime_pay_weekday > 0 && <DetailRow label="└ 平日加班" value={fmt(rec.overtime_pay_weekday)} />}
                                                  {rec.overtime_pay_restday > 0 && <DetailRow label="└ 休息日加班" value={fmt(rec.overtime_pay_restday)} />}
                                                  {rec.overtime_pay_holiday > 0 && <DetailRow label="└ 例假加班" value={fmt(rec.overtime_pay_holiday)} />}
                                                  {rec.overtime_pay_national > 0 && <DetailRow label="└ 國定加班" value={fmt(rec.overtime_pay_national)} />}
                                                </>
                                              )}
                                              {rec.rest_day_unused_pay > 0 && <DetailRow label="休息未休補償" value={fmt(rec.rest_day_unused_pay)} />}
                                              {rec.back_pay_adjustment > 0 && <DetailRow label="補發前期差額" value={fmt(rec.back_pay_adjustment)} />}
                                              {rec.performance_bonus > 0 && <DetailRow label="績效獎金" value={fmt(rec.performance_bonus)} />}
                                              {rec.commission > 0 && <DetailRow label="業績/差額" value={fmt(rec.commission)} />}
                                              {rec.festival_bonus > 0 && <DetailRow label="三節獎金" value={fmt(rec.festival_bonus)} />}
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
                                              {rec.paid_leave_deduction > 0 && <DetailRow label="請假扣款（有薪）" value={fmt(rec.paid_leave_deduction)} />}
                                              {rec.unpaid_leave_deduction > 0 && <DetailRow label="請假扣款（無薪）" value={fmt(rec.unpaid_leave_deduction)} />}
                                              {(rec.leave_deduction > 0 && !rec.paid_leave_deduction && !rec.unpaid_leave_deduction) && (
                                                <DetailRow label="請假扣款" value={fmt(rec.leave_deduction)} />
                                              )}
                                              {rec.late_deduction > 0 && <DetailRow label="遲到扣款" value={fmt(rec.late_deduction)} />}
                                              {rec.advance_recovery > 0 && <DetailRow label="預支扣回" value={fmt(rec.advance_recovery)} />}
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
                                              <button
                                                onClick={() => printPayslip(rec, empMap[rec.employee_id], selectedRun)}
                                                style={{
                                                  marginTop: 12, padding: '8px 16px', borderRadius: 8,
                                                  background: 'var(--accent-cyan)', color: '#fff',
                                                  border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                                                  display: 'flex', alignItems: 'center', gap: 6,
                                                }}
                                              >🧾 列印薪資條</button>
                                            </div>
                                            {/* 公司負擔 */}
                                            <div>
                                              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--accent-purple)' }}>公司負擔</div>
                                              <DetailRow label="勞保（公司）" value={fmt(rec.labor_ins_employer)} />
                                              <DetailRow label="健保（公司）" value={fmt(rec.health_ins_employer)} />
                                              <DetailRow label="勞退提撥（6%）" value={fmt(rec.labor_pension_employer)} />
                                              {rec.occupational_injury_employer > 0 && (
                                                <DetailRow label="職災保險" value={fmt(rec.occupational_injury_employer)} />
                                              )}
                                              {rec.nhi_supplementary_employer > 0 && (
                                                <DetailRow label="二代健保補充（公司）" value={fmt(rec.nhi_supplementary_employer)} />
                                              )}
                                              {rec.employer_total_cost > 0 && (
                                                <DetailRow label="公司總成本" value={fmt(rec.employer_total_cost)} bold />
                                              )}
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
              <div>
                匯入完成 {importResult.payPeriod && `(${importResult.payPeriod})`}：成功 {importResult.success} 筆
                {importResult.failed > 0 ? `，失敗 ${importResult.failed} 筆` : ''}
              </div>
              {importResult.errors?.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 6, color: 'var(--accent-red)', maxHeight: 120, overflowY: 'auto' }}>
                  {importResult.errors.map((e, i) => <div key={i}>• {e}</div>)}
                  {importResult.failed > importResult.errors.length && (
                    <div style={{ fontStyle: 'italic', marginTop: 4 }}>... 還有 {importResult.failed - importResult.errors.length} 筆錯誤未顯示</div>
                  )}
                </div>
              )}
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
