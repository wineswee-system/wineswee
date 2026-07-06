import { useState, useEffect, useCallback } from 'react'
import { FileText, Download, AlertTriangle, DatabaseZap, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useOrgId } from '../../../contexts/AuthContext'
import { generate401FromVatDocs, generateVatMediaFile } from '../../../lib/taxReport'
import Badge from '../../../components/ui/Badge'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { toast } from '../../../lib/toast'
import { fmtNT as fmt } from '../../../lib/currency'

const FORMAT_LABEL = {
  '31': '三聯式（B2B）',
  '33': '銷項折讓',
  '35': '電子發票（B2C）',
  '21': '三聯式進項',
  '25': '進項折讓',
}

/**
 * F-B3 憑證檔 tab：進銷項憑證清單 + 缺漏警示（一鍵補入）+ 401 預覽 + 媒體檔下載
 * @param {{year: number, period: {label: string, startMonth: number, endMonth: number}}} props
 */
export default function VatDocumentsTab({ year, period }) {
  const orgId = useOrgId()
  const periodInt = year * 100 + period.startMonth
  const rocYear = year - 1911

  const [loading, setLoading] = useState(true)
  const [outputDocs, setOutputDocs] = useState([])
  const [inputDocs, setInputDocs] = useState([])
  const [missing, setMissing] = useState([])
  const [preview401, setPreview401] = useState(null)
  const [backfilling, setBackfilling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setPreview401(null)

    const startDate = `${year}-${String(period.startMonth).padStart(2, '0')}-01`
    const endDay = new Date(year, period.endMonth, 0).getDate()
    const endDate = `${year}-${String(period.endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`

    // 顯式限縮本組織（RLS 之外的第二道防線；orgId 未載入時仍靠 RLS）
    const withOrg = (q) => (orgId ? q.eq('organization_id', orgId) : q)
    const [outRes, inRes, invRes] = await Promise.all([
      withOrg(supabase.from('vat_output_documents').select('*').eq('period', periodInt)).order('doc_date').order('doc_number'),
      withOrg(supabase.from('vat_input_documents').select('*').eq('period', periodInt)).order('doc_date').order('doc_number'),
      withOrg(supabase.from('pos_invoices')
        .select('id, invoice_number, invoice_date, sales_amount, tax_amount, buyer_tax_id, status')
        .gte('invoice_date', startDate).lte('invoice_date', endDate)
        .in('status', ['issued', 'allowance'])),
    ])

    const outs = outRes.data || []
    const ins = inRes.data || []
    setOutputDocs(outs)
    setInputDocs(ins)

    // 缺漏警示：期間內已開立（issued/allowance）但憑證檔沒有對應列的發票
    const outKeys = new Set(outs.filter(d => d.source_type === 'pos_invoice').map(d => d.source_id))
    setMissing((invRes.data || []).filter(inv => !outKeys.has(String(inv.id))))

    setLoading(false)
  }, [year, period.startMonth, period.endMonth, periodInt, orgId])

  useEffect(() => { load() }, [load])

  const handleBackfill = async () => {
    setBackfilling(true)
    const { data, error } = await supabase.rpc('backfill_vat_output_from_pos_invoices', { p_period: periodInt })
    setBackfilling(false)
    if (error) {
      toast.error(error.message || '一鍵補入失敗')
      return
    }
    toast.success(`補入完成：銷項 ${data?.issued_upserted ?? 0} 筆、折讓 ${data?.allowances_upserted ?? 0} 筆、移除作廢 ${data?.voided_removed ?? 0} 筆`)
    load()
  }

  const handlePreview401 = () => {
    setPreview401(generate401FromVatDocs(outputDocs, inputDocs, periodInt))
  }

  const handleMediaDownload = async () => {
    // 賣方統編取組織主檔（無則留空，媒體檔仍可產出供檢視）
    let sellerUbn = ''
    try {
      let q = supabase.from('organizations').select('tax_id')
      if (orgId) q = q.eq('id', orgId)
      const { data } = await q.limit(1).maybeSingle()
      sellerUbn = data?.tax_id || ''
    } catch { /* 組織主檔無統編欄 → 留空 */ }

    const content = generateVatMediaFile(outputDocs, inputDocs, periodInt, sellerUbn)
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `401進銷項媒體檔_${rocYear}年${period.label}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <LoadingSpinner />

  const docTable = (docs, title, isInput) => (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><h3 className="card-title">{title}（{docs.length} 筆）</h3></div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>格式</th><th>憑證號碼</th><th>日期</th><th>{isInput ? '賣方統編' : '買受人統編'}</th>
              <th style={{ textAlign: 'right' }}>金額(未稅)</th><th style={{ textAlign: 'right' }}>稅額</th>
              <th>課稅別</th>{isInput && <th>扣抵</th>}
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr><td colSpan={isInput ? 8 : 7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>本期無{isInput ? '進項' : '銷項'}憑證</td></tr>
            ) : docs.map((d) => (
              <tr key={d.id}>
                <td><Badge color={d.format_code === '33' || d.format_code === '25' ? 'orange' : 'cyan'} size="sm">{d.format_code} {FORMAT_LABEL[d.format_code] || ''}</Badge></td>
                <td style={{ fontFamily: 'monospace' }}>{d.doc_number}</td>
                <td>{d.doc_date}</td>
                <td style={{ fontFamily: 'monospace' }}>{d.counterparty_ubn || '—'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: Number(d.amount) < 0 ? 'var(--accent-red)' : undefined }}>
                  {Number(d.amount) < 0 ? `(${fmt(Math.abs(d.amount))})` : fmt(d.amount)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: Number(d.tax_amount) < 0 ? 'var(--accent-red)' : undefined }}>
                  {Number(d.tax_amount) < 0 ? `(${fmt(Math.abs(d.tax_amount))})` : fmt(d.tax_amount)}
                </td>
                <td>{d.tax_type}</td>
                {isInput && <td>{d.deduction_code}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <>
      {/* 缺漏警示 + 一鍵補入 */}
      {missing.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 14, border: '1px solid var(--accent-orange)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <AlertTriangle size={18} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} />
            <strong style={{ color: 'var(--accent-orange)' }}>缺漏警示：{missing.length} 張已開發票未入憑證檔</strong>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={handleBackfill} disabled={backfilling}>
              <DatabaseZap size={14} /> {backfilling ? '補入中…' : '一鍵補入'}
            </button>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {missing.slice(0, 10).map(m => m.invoice_number).join('、')}
            {missing.length > 10 && ` …等 ${missing.length} 張`}
          </div>
        </div>
      )}

      {/* 動作列 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={handlePreview401} disabled={outputDocs.length === 0 && inputDocs.length === 0}>
          <FileText size={16} /> 401 預覽（憑證檔）
        </button>
        <button className="btn btn-primary" onClick={handleMediaDownload} disabled={outputDocs.length === 0 && inputDocs.length === 0}>
          <Download size={16} /> 媒體檔下載（81 bytes/筆）
        </button>
        <button className="btn" onClick={load}><RefreshCw size={14} /> 重新整理</button>
      </div>

      {/* 401 預覽 */}
      {preview401 && (
        <div className="card" style={{ marginBottom: 16, border: '2px solid var(--accent-green)' }}>
          <div className="card-header">
            <h3 className="card-title">401 預覽 — {preview401.period}</h3>
            <Badge color="cyan" size="sm">資料來源：進銷項憑證檔</Badge>
          </div>
          <div style={{ padding: 16 }}>
            <div className="data-table-wrapper">
              <table className="data-table">
                <tbody>
                  <tr><td>應稅銷售額</td><td style={{ textAlign: 'right' }}>{fmt(preview401.sales.taxable.amount)}</td><td>銷項稅額</td><td style={{ textAlign: 'right' }}>{fmt(preview401.sales.taxable.tax)}</td></tr>
                  <tr><td>零稅率銷售額</td><td style={{ textAlign: 'right' }}>{fmt(preview401.sales.zeroRated.amount)}</td><td>免稅銷售額</td><td style={{ textAlign: 'right' }}>{fmt(preview401.sales.exempt.amount)}</td></tr>
                  <tr><td>可扣抵進項</td><td style={{ textAlign: 'right' }}>{fmt(preview401.purchases.deductible.amount)}</td><td>進項稅額(可扣抵)</td><td style={{ textAlign: 'right' }}>{fmt(preview401.purchases.deductible.tax)}</td></tr>
                  <tr><td>不可扣抵進項</td><td style={{ textAlign: 'right' }}>{fmt(preview401.purchases.nonDeductible.amount)}</td><td style={{ color: 'var(--text-secondary)' }}>不可扣抵稅額(不入扣抵)</td><td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(preview401.purchases.nonDeductible.tax)}</td></tr>
                  <tr style={{ fontWeight: 700, fontSize: '1.05em' }}>
                    <td>{preview401.summary.isRefund ? '溢付稅額（留抵）' : '應納稅額'}</td>
                    <td style={{ textAlign: 'right', color: preview401.summary.isRefund ? 'var(--accent-blue)' : 'var(--accent-green)' }}>
                      {fmt(Math.abs(preview401.summary.taxPayable))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {docTable(outputDocs, '銷項憑證', false)}
      {docTable(inputDocs, '進項憑證', true)}
    </>
  )
}
