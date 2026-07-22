import React, { useState, useEffect } from 'react'
import { Plus, Search, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus, ArrowRightLeft, CheckCircle, XCircle } from 'lucide-react'
import { getPurchaseOrders, createPurchaseOrder, getGoodsReceipts, getAccountsPayable } from '../../lib/db'
import { useOrgId } from '../../contexts/AuthContext'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { performThreeWayMatch, calculatePriceVariance } from '../../lib/threeWayMatch'
import { getCurrencies, getDbExchangeRate, formatCurrency, DEFAULT_RATES, fmtNT as fmt } from '../../lib/currency'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const PAYMENT_TERMS = ['COD', 'NET15', 'NET30', 'NET45', 'NET60']

const fmtCur = (n, cur) => cur && cur !== 'NTD' ? formatCurrency(n, cur) : fmt(n)

const emptyLineItem = () => ({ product: '', qty: '', unit_price: '', total: 0 })

export default function PurchaseOrders() {
  const orgId = useOrgId()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ po_number: '', supplier: '', tax: '', shipping: '', payment_terms: 'NET30', expected_date: '', currency: 'NTD', exchange_rate: 1 })
  const [lineItems, setLineItems] = useState([emptyLineItem()])
  const [expandedRow, setExpandedRow] = useState(null)
  const [currencies, setCurrencies] = useState([])

  // Three-way match state
  const [matchResults, setMatchResults] = useState({}) // keyed by PO id
  const [matchLoading, setMatchLoading] = useState(null) // PO id being matched

  useEffect(() => {
    Promise.all([
      getPurchaseOrders(orgId),
      getCurrencies(),
    ]).then(([poRes, curRes]) => {
      setOrders(poRes.data || [])
      setCurrencies(curRes.length > 0 ? curRes : [{ code: 'NTD', name: '新台幣', symbol: 'NT$' }, { code: 'USD', name: '美元', symbol: '$' }, { code: 'EUR', name: '歐元', symbol: '€' }, { code: 'JPY', name: '日圓', symbol: '¥' }, { code: 'CNY', name: '人民幣', symbol: '¥' }, { code: 'GBP', name: '英鎊', symbol: '£' }, { code: 'HKD', name: '港幣', symbol: 'HK$' }])
    }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Handle currency change — auto-fetch exchange rate
  const handleCurrencyChange = async (currencyCode) => {
    set('currency', currencyCode)
    if (currencyCode === 'NTD') {
      set('exchange_rate', 1)
    } else {
      const dbRate = await getDbExchangeRate(currencyCode)
      set('exchange_rate', dbRate || DEFAULT_RATES[currencyCode] || 1)
    }
  }

  // ── Line Items Management ──
  const updateLineItem = (index, field, value) => {
    setLineItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      // Auto-calculate line total
      const qty = parseFloat(updated[index].qty) || 0
      const price = parseFloat(updated[index].unit_price) || 0
      updated[index].total = qty * price
      return updated
    })
  }

  const addLineItem = () => setLineItems(prev => [...prev, emptyLineItem()])

  const removeLineItem = (index) => {
    if (lineItems.length <= 1) return
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  const lineItemsTotal = lineItems.reduce((sum, li) => sum + (li.total || 0), 0)

  const handleSubmit = async () => {
    if (!form.po_number || !form.supplier) return
    const validLines = lineItems.filter(li => li.product && (parseFloat(li.qty) > 0))
    const total = validLines.length > 0 ? validLines.reduce((s, li) => s + li.total, 0) : 0

    const exchangeRate = parseFloat(form.exchange_rate) || 1
    const currency = form.currency || 'NTD'
    const ntdTotal = currency !== 'NTD' ? Math.round(total * exchangeRate) : total

    const { data } = await createPurchaseOrder({
      ...form,
      total_amount: total,
      tax: parseFloat(form.tax) || 0,
      shipping: parseFloat(form.shipping) || 0,
      status: '待確認',
      line_items: validLines.length > 0 ? validLines : undefined,
      currency,
      exchange_rate: exchangeRate,
      ntd_amount: ntdTotal,
    })
    if (data) {
      setOrders(prev => [...prev, data])
      setShowModal(false)
      setForm({ po_number: '', supplier: '', tax: '', shipping: '', payment_terms: 'NET30', expected_date: '', currency: 'NTD', exchange_rate: 1 })
      setLineItems([emptyLineItem()])
      await createApprovalWorkflow('purchase', data, form.created_by || '系統')
    }
  }

  // ── Price Variance ──
  const getPriceVarianceForOrder = (order) => {
    // Compare against previous POs from the same supplier
    const sameSupplierPOs = orders.filter(o =>
      o.id !== order.id &&
      o.supplier === order.supplier &&
      new Date(o.created_at) < new Date(order.created_at)
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    if (sameSupplierPOs.length === 0) return null

    const lastPO = sameSupplierPOs[0]
    const lastPrice = lastPO.total_amount || 0
    const currentPrice = order.total_amount || 0

    if (lastPrice === 0) return null

    const result = calculatePriceVariance(lastPrice, currentPrice)
    return result
  }

  // ── Three-Way Match for a PO ──
  const handlePOMatch = async (po) => {
    setMatchLoading(po.id)
    try {
      const { data: grRecords } = await getGoodsReceipts(orgId)
      const { data: apRecords } = await getAccountsPayable(orgId)

      const matchingGR = (grRecords || []).find(gr => gr.po_id === po.id)
      const matchingAP = (apRecords || []).find(ap =>
        ap.po_id === po.id || ap.reference?.includes(String(po.id)) || ap.reference?.includes(po.po_number)
      )

      if (!matchingGR) {
        setMatchResults(prev => ({ ...prev, [po.id]: { status: '未收貨', detail: '尚無對應收貨單' } }))
        return
      }

      const poItems = po.line_items && Array.isArray(po.line_items) && po.line_items.length > 0
        ? po.line_items.map(li => ({
            itemCode: li.product || li.itemCode || 'ITEM',
            qty: li.qty || 0,
            unitPrice: li.unit_price || li.unitPrice || 0,
          }))
        : [{ itemCode: 'TOTAL', qty: 1, unitPrice: po.total_amount || 0 }]

      const purchaseOrder = {
        poNumber: po.po_number,
        items: poItems,
        total: (po.total_amount || 0) + (po.tax || 0) + (po.shipping || 0),
      }

      const grItemsNorm = matchingGR.received_items && Array.isArray(matchingGR.received_items)
        ? matchingGR.received_items.map(ri => ({ itemCode: ri.product || ri.itemCode || 'ITEM', receivedQty: ri.received_qty || ri.qty || 0 }))
        : poItems.map(pi => ({ itemCode: pi.itemCode, receivedQty: pi.qty }))

      const goodsReceipt = { grNumber: `GR-${String(matchingGR.id).padStart(3, '0')}`, items: grItemsNorm }

      const invItems = matchingAP?.line_items && Array.isArray(matchingAP.line_items)
        ? matchingAP.line_items.map(li => ({ itemCode: li.product || li.itemCode || 'ITEM', qty: li.qty || 0, unitPrice: li.unit_price || li.unitPrice || 0 }))
        : poItems.map(pi => ({ itemCode: pi.itemCode, qty: pi.qty, unitPrice: pi.unitPrice }))

      const invoice = {
        invoiceNumber: matchingAP ? (matchingAP.invoice_number || `AP-${String(matchingAP.id).padStart(3, '0')}`) : '(無發票)',
        items: invItems,
        total: matchingAP ? (matchingAP.amount || 0) : purchaseOrder.total,
      }

      const result = performThreeWayMatch(purchaseOrder, goodsReceipt, invoice)
      setMatchResults(prev => ({
        ...prev,
        [po.id]: {
          status: result.matched ? '已比對' : '有差異',
          detail: result.matched ? '三方一致' : `${result.discrepancies.length} 項差異`,
          result,
        },
      }))
    } catch (err) {
      console.error('PO 三方比對失敗:', err)
      setMatchResults(prev => ({ ...prev, [po.id]: { status: '錯誤', detail: '比對失敗' } }))
    } finally {
      setMatchLoading(null)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = orders.filter(o =>
    search === '' || o.po_number?.includes(search) || o.supplier?.includes(search)
  )

  const pending = filtered.filter(o => o.status === '待確認').length
  const shipping = filtered.filter(o => o.status === '待出貨').length
  const arrived = filtered.filter(o => o.status === '已到貨').length

  const now = new Date()
  const monthTotal = filtered
    .filter(o => {
      const d = new Date(o.created_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    })
    .reduce((sum, o) => sum + (o.total_amount || 0), 0)

  const statusBadge = (status) => {
    const cls = status === '已到貨' ? 'badge-success' : status === '已取消' ? 'badge-danger' : status === '待出貨' ? 'badge-info' : 'badge-warning'
    return <span className={`badge ${cls}`}><span className="badge-dot"></span>{status}</span>
  }

  const matchBadge = (poId) => {
    const m = matchResults[poId]
    if (!m) return <span className="badge badge-warning" style={{ fontSize: 11 }}><span className="badge-dot"></span>未比對</span>
    if (m.status === '已比對') return <span className="badge badge-success" style={{ fontSize: 11 }}><span className="badge-dot"></span>已比對</span>
    if (m.status === '未收貨') return <span className="badge badge-info" style={{ fontSize: 11 }}><span className="badge-dot"></span>未收貨</span>
    if (m.status === '有差異') return <span className="badge badge-danger" style={{ fontSize: 11 }}><span className="badge-dot"></span>有差異</span>
    return <span className="badge badge-warning" style={{ fontSize: 11 }}><span className="badge-dot"></span>{m.status}</span>
  }

  const calcTotal = (o) => (o.total_amount || 0) + (o.tax || 0) + (o.shipping || 0)

  const priceVarianceIndicator = (order) => {
    const pv = getPriceVarianceForOrder(order)
    if (!pv) return null
    const pct = (pv.percentage * 100).toFixed(1)
    if (Math.abs(pv.variance) < 1) return <span style={{ color: 'var(--text-muted)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 2 }}><Minus size={10} /> 持平</span>
    if (pv.favorable) {
      return <span style={{ color: 'var(--accent-green)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 2 }}><TrendingDown size={10} /> -{pct}%</span>
    }
    return <span style={{ color: 'var(--accent-red)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 2 }}><TrendingUp size={10} /> +{pct}%</span>
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📄</span> 採購單 (PO)</h2>
            <p>採購訂單管理與追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增採購單</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待確認</div>
          <div className="stat-card-value">{pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">待出貨</div>
          <div className="stat-card-value">{shipping}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已到貨</div>
          <div className="stat-card-value">{arrived}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">本月採購額</div>
          <div className="stat-card-value">{fmt(monthTotal)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 採購單列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋PO編號/供應商..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 32 }}></th><th>PO 編號</th><th>供應商</th><th>金額合計</th><th>價格變動</th><th>付款條件</th><th>預計到貨</th><th>狀態</th><th>比對狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無採購單</td></tr>}
              {filtered.map(o => {
                const hasLineItems = o.line_items && Array.isArray(o.line_items) && o.line_items.length > 0
                const isExpanded = expandedRow === o.id
                return (
                  <React.Fragment key={o.id}>
                    <tr>
                      <td style={{ cursor: hasLineItems ? 'pointer' : 'default', textAlign: 'center' }}
                          onClick={() => hasLineItems && setExpandedRow(isExpanded ? null : o.id)}>
                        {hasLineItems && (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{o.po_number}</td>
                      <td>{o.supplier}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{fmtCur(calcTotal(o), o.currency)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          小計 {fmtCur(o.total_amount, o.currency)} + 稅 {fmtCur(o.tax, o.currency)} + 運費 {fmtCur(o.shipping, o.currency)}
                        </div>
                        {o.currency && o.currency !== 'NTD' && (
                          <div style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>
                            NTD {fmt(o.ntd_amount || Math.round(calcTotal(o) * (o.exchange_rate || 1)))} (匯率: {o.exchange_rate})
                          </div>
                        )}
                      </td>
                      <td>{priceVarianceIndicator(o) || <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>--</span>}</td>
                      <td><span className="badge badge-info"><span className="badge-dot"></span>{o.payment_terms}</span></td>
                      <td>{o.expected_date}</td>
                      <td>{statusBadge(o.status)}</td>
                      <td>{matchBadge(o.id)}</td>
                      <td>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          disabled={matchLoading === o.id}
                          onClick={() => handlePOMatch(o)}
                        >
                          {matchLoading === o.id ? '...' : <><ArrowRightLeft size={11} /> 比對</>}
                        </button>
                      </td>
                    </tr>
                    {/* Expanded line items row */}
                    {isExpanded && hasLineItems && (
                      <tr>
                        <td colSpan={10} style={{ padding: 0 }}>
                          <div style={{ padding: '8px 16px 12px 40px', background: 'var(--bg-secondary)' }}>
                            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: 'var(--text-secondary)' }}>採購明細</div>
                            <div className="data-table-wrapper">
                              <table className="data-table" style={{ fontSize: 12 }}>
                                <thead>
                                  <tr><th>品項</th><th>數量</th><th>單價</th><th>小計</th></tr>
                                </thead>
                                <tbody>
                                  {o.line_items.map((li, i) => (
                                    <tr key={i}>
                                      <td style={{ fontWeight: 600 }}>{li.product || li.itemCode || '-'}</td>
                                      <td>{li.qty}</td>
                                      <td>{fmt(li.unit_price || li.unitPrice)}</td>
                                      <td>{fmt((li.qty || 0) * (li.unit_price || li.unitPrice || 0))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {/* Match result detail if available */}
                            {matchResults[o.id]?.result && (
                              <div style={{ marginTop: 8, padding: 8, borderRadius: 6, fontSize: 11, background: matchResults[o.id].result.matched ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)' }}>
                                {matchResults[o.id].result.matched
                                  ? <span style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={12} /> 三方比對通過 - 自動核准</span>
                                  : <span style={{ color: 'var(--accent-red)' }}>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}><XCircle size={12} /> 三方比對有差異</span>
                                      {matchResults[o.id].result.discrepancies.map((d, di) => (
                                        <div key={di} style={{ marginLeft: 16 }}>- {d.field}: PO={d.po_value}, GR={d.gr_value}, 發票={d.inv_value}{d.variance !== 'missing_item' ? ` (${(d.variance * 100).toFixed(1)}%)` : ' (品項缺少)'}</div>
                                      ))}
                                    </span>
                                }
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增採購單" onClose={() => { setShowModal(false); setLineItems([emptyLineItem()]) }} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="PO 編號" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="PO-20260401-001" value={form.po_number} onChange={e => set('po_number', e.target.value)} />
            </Field>
            <Field label="供應商" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="供應商名稱" value={form.supplier} onChange={e => set('supplier', e.target.value)} />
            </Field>
          </div>

          {/* Currency Selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
            <Field label="幣別">
              <select className="form-input" style={{ width: '100%' }} value={form.currency} onChange={e => handleCurrencyChange(e.target.value)}>
                {currencies.map(c => (
                  <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                ))}
              </select>
            </Field>
            {form.currency !== 'NTD' && (
              <Field label={`匯率 (1 ${form.currency} = ? NTD)`}>
                <input className="form-input" type="number" step="0.0001" min="0" style={{ width: '100%' }} value={form.exchange_rate} onChange={e => set('exchange_rate', e.target.value)} />
              </Field>
            )}
          </div>

          {/* Line Items Section */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontWeight: 600, fontSize: 13 }}>採購明細</label>
              <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={addLineItem}>
                <Plus size={11} /> 新增品項
              </button>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div className="data-table-wrapper">
                <table className="data-table" style={{ fontSize: 12, marginBottom: 0 }}>
                  <thead>
                    <tr><th>品項名稱</th><th style={{ width: 80 }}>數量</th><th style={{ width: 100 }}>單價</th><th style={{ width: 100 }}>小計</th><th style={{ width: 40 }}></th></tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i}>
                        <td>
                          <input className="form-input" type="text" style={{ width: '100%', fontSize: 12 }} placeholder="品項名稱" value={li.product} onChange={e => updateLineItem(i, 'product', e.target.value)} />
                        </td>
                        <td>
                          <input className="form-input" type="number" style={{ width: '100%', fontSize: 12 }} placeholder="0" value={li.qty} onChange={e => updateLineItem(i, 'qty', e.target.value)} />
                        </td>
                        <td>
                          <input className="form-input" type="number" style={{ width: '100%', fontSize: 12 }} placeholder="0" value={li.unit_price} onChange={e => updateLineItem(i, 'unit_price', e.target.value)} />
                        </td>
                        <td style={{ fontWeight: 600, textAlign: 'right' }}>{fmt(li.total)}</td>
                        <td>
                          {lineItems.length > 1 && (
                            <button type="button" onClick={() => removeLineItem(i)} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 14 }}>x</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontWeight: 600, marginTop: 6, fontSize: 13 }}>
              品項小計: {fmt(lineItemsTotal)}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
            <Field label="稅額">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.tax} onChange={e => set('tax', e.target.value)} />
            </Field>
            <Field label="運費">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.shipping} onChange={e => set('shipping', e.target.value)} />
            </Field>
          </div>
          <div style={{ textAlign: 'right', marginTop: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent-cyan)' }}>
              合計: {fmtCur(lineItemsTotal + (parseFloat(form.tax) || 0) + (parseFloat(form.shipping) || 0), form.currency)}
            </div>
            {form.currency !== 'NTD' && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                NTD 等值: {fmt(Math.round((lineItemsTotal + (parseFloat(form.tax) || 0) + (parseFloat(form.shipping) || 0)) * (parseFloat(form.exchange_rate) || 1)))}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="付款條件">
              <select className="form-input" style={{ width: '100%' }} value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)}>
                {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="預計到貨日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.expected_date} onChange={e => set('expected_date', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
