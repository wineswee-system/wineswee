import { useState, useEffect, useMemo } from 'react'
import { FileDown } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { generateWithholdingMediaFile, WITHHOLDING_MEDIA_LAYOUT } from '../../../lib/withholdingMedia'
import { getNhiRecordsByYear } from '../../../lib/db/nhiSupplement'
import { logger } from '../../../lib/logger'
import { toast } from '../../../lib/toast'
import { fmtNT as fmt } from '../../../lib/currency'

/**
 * F-B4 扣繳憑單媒體申報檔（固定長度 120 bytes/筆）下載區塊
 *
 * 掛在 TaxFiling 扣繳彙總 tab 下方 — 純新增，不動既有 pipe 格式下載。
 * 一人一筆（格式代別 50），二代健保費自 nhi_supplement_records 年度彙總帶入。
 *
 * @param {{year: number, salaryRows: Array}} props - salaryRows = 該年度 salary_records
 */
export default function WithholdingMediaSection({ year, salaryRows }) {
  const rocYear = year - 1911
  const [employees, setEmployees] = useState([])
  const [nhiByEmployee, setNhiByEmployee] = useState({})
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('employees').select('id, name, id_number'),
      getNhiRecordsByYear(year).catch(() => []), // 表未建立/無資料 → 二代健保費以 0 帶入
    ]).then(([empRes, nhiRows]) => {
      if (cancelled) return
      setEmployees(empRes.data || [])
      const byEmp = {}
      for (const r of nhiRows) {
        byEmp[r.employee_id] = (byEmp[r.employee_id] || 0) + (Number(r.premium) || 0)
      }
      setNhiByEmployee(byEmp)
    }).catch(err => {
      if (cancelled) return
      logger.error('Withholding media data load failed', { module: 'finance', error: err?.message })
    })
    return () => { cancelled = true }
  }, [year])

  // 一人一筆彙總（格式 50 薪資所得）：給付總額 = Σ(本薪+津貼+加班+獎金)
  const mediaRecords = useMemo(() => {
    const empMap = {}
    for (const e of employees) empMap[e.id] = e

    const byEmp = {}
    for (const s of (salaryRows || [])) {
      const key = s.employee_id ?? s.employee
      if (key == null) continue
      if (!byEmp[key]) {
        const emp = empMap[s.employee_id]
        byEmp[key] = {
          format_code: s.income_type || '50',
          payee_id: emp?.id_number || '',
          payee_name: emp?.name || s.employee || '',
          gross_amount: 0,
          tax_withheld: 0,
          nhi_premium: nhiByEmployee[s.employee_id] || 0,
        }
      }
      byEmp[key].gross_amount +=
        (Number(s.base_salary) || 0) + (Number(s.allowance) || 0)
        + (Number(s.overtime) || 0) + (Number(s.bonus) || 0)
      byEmp[key].tax_withheld += Number(s.tax_withheld ?? s.withholding_tax) || 0
    }
    return Object.values(byEmp)
  }, [salaryRows, employees, nhiByEmployee])

  const totalGross = mediaRecords.reduce((s, r) => s + r.gross_amount, 0)
  const totalNhi = mediaRecords.reduce((s, r) => s + r.nhi_premium, 0)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      // 扣繳單位統編取組織主檔（同 VatDocumentsTab 慣例；無則留空，檔案仍可產出檢視）
      let filerUbn = ''
      try {
        const { data } = await supabase.from('organizations').select('tax_id').limit(1).maybeSingle()
        filerUbn = data?.tax_id || ''
      } catch { /* 組織主檔無統編欄 → 留空 */ }

      const content = generateWithholdingMediaFile(mediaRecords, { year, filerUbn })
      const blob = new Blob([content], { type: 'text/plain; charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `各類所得憑單媒體檔_${rocYear}年.txt`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`媒體檔已產出：${mediaRecords.length} 筆（${WITHHOLDING_MEDIA_LAYOUT.recordLength} bytes/筆）`)
    } catch (err) {
      logger.error('Withholding media file generation failed', { module: 'finance', error: err?.message })
      toast.error(err?.message || '媒體檔產出失敗')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <h3 className="card-title">憑單媒體申報檔（財政部固定欄寬格式）</h3>
      </div>
      <div style={{ padding: 16 }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
          每張憑單一筆、每筆 {WITHHOLDING_MEDIA_LAYOUT.recordLength} bytes（中文以 Big5 位元組計長）。
          本期 {mediaRecords.length} 人：給付總額 {fmt(totalGross)}、二代健保代扣 {fmt(totalNhi)}。
          正式申報前請以國稅局「各類所得憑單電子申報系統」審核程式實測。
        </p>
        <button
          className="btn btn-primary"
          onClick={handleDownload}
          disabled={downloading || mediaRecords.length === 0}
        >
          <FileDown size={16} /> {downloading ? '產出中…' : '媒體檔下載（固定欄寬）'}
        </button>
      </div>
    </div>
  )
}
