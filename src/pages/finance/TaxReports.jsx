import { useState, useEffect } from 'react'
import { FileText, Download, Filter } from 'lucide-react'
import { getInvoices } from '../../lib/db'
import { generate401Report, generate403Report, calculateBusinessTax, formatTaxPeriod } from '../../lib/taxReport'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useTenant } from '../../contexts/TenantContext'

import { fmtNT as fmt } from '../../lib/currency'

export default function TaxReports() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('401')
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    const month = now.getMonth() + 1
    const biMonth = month % 2 === 0 ? month : month - 1 || 12
    const year = biMonth === 12 && month === 1 ? now.getFullYear() - 1 : now.getFullYear()
    return `${year}-${String(biMonth).padStart(2, '0')}`
  })

  useEffect(() => {
    getInvoices(orgId).then(({ data }) => {
      setInvoices(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [orgId])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const report401 = generate401Report(invoices, period)
  const report403 = generate403Report(invoices, period)
  const businessTax = calculateBusinessTax(report401)

  const { salesTax = 0, purchaseTax = 0, netPayable = 0, salesInvoices = [], purchaseInvoices = [] } = report401 || {}
  const { withholdingRecords = [], totalWithholding = 0 } = report403 || {}

  // Bi-monthly periods for Taiwan 401
  const biMonthlyPeriods = []
  for (let i = 0; i < 6; i++) {
    const d = new Date()
    d.setMonth(d.getMonth() - (i * 2))
    const m = d.getMonth() + 1
    const biMonth = m % 2 === 0 ? m : m - 1 || 12
    const y = biMonth === 12 && m === 1 ? d.getFullYear() - 1 : d.getFullYear()
    const val = `${y}-${String(biMonth).padStart(2, '0')}`
    if (!biMonthlyPeriods.includes(val)) biMonthlyPeriods.push(val)
  }

  const handleGenerateMedia = () => {
    const content = activeTab === '401'
      ? [
          `401 營業稅申報媒體檔`,
          `期別: ${formatTaxPeriod(period)}`,
          `銷項稅額: ${salesTax}`,
          `進項稅額: ${purchaseTax}`,
          `應納稅額: ${netPayable}`,
          `銷項發票數: ${salesInvoices.length}`,
          `進項發票數: ${purchaseInvoices.length}`,
        ].join('\n')
      : [
          `403 扣繳申報媒體檔`,
          `期別: ${formatTaxPeriod(period)}`,
          `扣繳筆數: ${withholdingRecords.length}`,
          `扣繳總額: ${totalWithholding}`,
        ].join('\n')

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeTab}_${period}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const tabStyle = (tab) => ({
    padding: '10px 24px',
    border: 'none',
    borderBottom: activeTab === tab ? '3px solid var(--accent-blue)' : '3px solid transparent',
    background: 'transparent',
    color: activeTab === tab ? 'var(--accent-blue)' : 'var(--text-secondary)',
    fontWeight: activeTab === tab ? 700 : 400,
    cursor: 'pointer',
    fontSize: 14,
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧾</span> 稅務申報</h2>
            <p>Tax Reports — 營業稅與扣繳申報管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Filter size={14} />
            <select value={period} onChange={e => setPeriod(e.target.value)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              {biMonthlyPeriods.map(p => <option key={p} value={p}>{formatTaxPeriod(p)}</option>)}
            </select>
            <button className="btn btn-primary" onClick={handleGenerateMedia}><Download size={14} /> 產生媒體檔</button>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 20, display: 'flex' }}>
        <button style={tabStyle('401')} onClick={() => setActiveTab('401')}>401 營業稅</button>
        <button style={tabStyle('403')} onClick={() => setActiveTab('403')}>403 扣繳申報</button>
      </div>

      {activeTab === '401' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">銷項稅額</div>
              <div className="stat-card-value">{fmt(salesTax)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">進項稅額</div>
              <div className="stat-card-value">{fmt(purchaseTax)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': netPayable >= 0 ? 'var(--accent-red)' : 'var(--accent-green)', '--card-accent-dim': netPayable >= 0 ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">應納（退）稅額</div>
              <div className="stat-card-value">{fmt(netPayable)}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Sales Invoices */}
            <div>
              <h4 style={{ margin: '0 0 12px' }}>銷項發票明細（{salesInvoices.length} 筆）</h4>
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>發票號碼</th>
                      <th>買受人</th>
                      <th style={{ textAlign: 'right' }}>金額</th>
                      <th style={{ textAlign: 'right' }}>稅額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesInvoices.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>無資料</td></tr>
                    ) : salesInvoices.map((inv, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'monospace' }}>{inv.invoice_number}</td>
                        <td>{inv.buyer_name}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(inv.amount)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(inv.tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Purchase Invoices */}
            <div>
              <h4 style={{ margin: '0 0 12px' }}>進項發票明細（{purchaseInvoices.length} 筆）</h4>
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>發票號碼</th>
                      <th>賣方</th>
                      <th style={{ textAlign: 'right' }}>金額</th>
                      <th style={{ textAlign: 'right' }}>稅額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseInvoices.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>無資料</td></tr>
                    ) : purchaseInvoices.map((inv, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'monospace' }}>{inv.invoice_number}</td>
                        <td>{inv.seller_name}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(inv.amount)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(inv.tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === '403' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">扣繳筆數</div>
              <div className="stat-card-value">{withholdingRecords.length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">扣繳總額</div>
              <div className="stat-card-value">{fmt(totalWithholding)}</div>
            </div>
          </div>

          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>所得人</th>
                  <th>統一編號/身分證</th>
                  <th>所得類別</th>
                  <th style={{ textAlign: 'right' }}>給付總額</th>
                  <th style={{ textAlign: 'right' }}>扣繳稅額</th>
                </tr>
              </thead>
              <tbody>
                {withholdingRecords.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>本期無扣繳資料</td></tr>
                ) : withholdingRecords.map((rec, i) => (
                  <tr key={i}>
                    <td>{rec.name}</td>
                    <td style={{ fontFamily: 'monospace' }}>{rec.taxId}</td>
                    <td><span className="badge badge-info"><span className="badge-dot"></span>{rec.incomeType}</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(rec.grossAmount)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(rec.withholdingAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
