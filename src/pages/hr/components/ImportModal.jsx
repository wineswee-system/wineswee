import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Modal, { Field } from '../../../components/Modal'
import { toast } from '../../../lib/toast'
import { useAuth } from '../../../contexts/AuthContext'

// 中文 header → DB column。沒對應的 column 就 ignore。
// 重複欄位（資食費 vs 伙食津貼）以前者為準。
const COLUMN_MAP = {
  '本薪': 'base_salary',
  '底薪': 'base_insured',
  '伙食津貼': 'meal_allowance',
  '資食費': 'meal_allowance',
  '主管加給': 'supervisor_allowance',
  '夜班津貼': 'night_shift_allowance',
  '跨區津貼': 'cross_store_allowance',
  '加班費': 'overtime_pay_weekday',
  '額外加班費': 'overtime_pay_holiday',
  '公休薪資': 'rest_day_unused_pay',
  '補發前期差額': 'back_pay_adjustment',
  '休息未休': 'unused_leave_payout',
  '折扣差額': 'commission',
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

// Props: open, onClose, employees, onImportComplete
export default function ImportModal({ open, onClose, employees, onImportComplete }) {
  const { profile } = useAuth()
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState([])
  const [importHeaders, setImportHeaders] = useState([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const handleClose = () => {
    setImportFile(null)
    setImportPreview([])
    setImportHeaders([])
    setImportResult(null)
    onClose()
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
      if (success > 0) onImportComplete()
    } catch (err) {
      console.error('Import failed:', err)
      toast.error('匯入失敗：' + (err.message || '未知錯誤'))
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  return (
    <Modal
      title="匯入薪資"
      onClose={handleClose}
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
  )
}
