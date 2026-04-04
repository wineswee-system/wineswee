import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, XCircle, Trash2, ChevronDown, ChevronRight, Save, Loader, Download, FileText } from 'lucide-react'
import {
  getInvoices, createInvoice, updateInvoice,
  getInvoiceLines, createInvoiceLine, updateInvoiceLine, deleteInvoiceLine,
  batchCreateInvoiceLines, getSKUs
} from '../../lib/db'
import { calculateInvoiceTax, validateTaxId, generateInvoiceNumber, generateMIGXml, generateTurnkeyBatch, validateInvoiceNumber } from '../../lib/einvoice'
import { getCurrencies, getDbExchangeRate, formatCurrency as fmtCurrency, DEFAULT_RATES } from '../../lib/currency'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`
const fmtCur = (n, cur) => cur && cur !== 'NTD' ? fmtCurrency(n, cur) : fmt(n)
const CARRIER_TYPES = ['手機條碼', '自然人憑證', '無']
const TAX_TYPES = ['應稅', '零稅率', '免稅']

const emptyLineItem = () => ({ product: '', sku_id: '', qty: 1, unit_price: 0, tax_type: '應稅' })

function calcItemAmount(item) {
  return Math.round((item.qty || 0) * (item.unit_price || 0))
}

function calcAllTotals(lineItems) {
  let subtotal = 0
  let taxTotal = 0
  const itemsWithTax = []

  for (const li of lineItems) {
    const { subtotal: itemSub, taxAmount: itemTax } = calculateInvoiceTax(
      [{ description: li.product, qty: li.qty, unitPrice: li.unit_price }],
      li.tax_type || '應稅'
    )
    subtotal += itemSub
    taxTotal += itemTax
    itemsWithTax.push({ ...li, amount: itemSub, tax: itemTax })
  }

  return { subtotal, tax: taxTotal, grandTotal: subtotal + taxTotal, itemsWithTax }
}

function dbLineToLocal(line) {
  return {
    _id: line.id,
    sku_id: line.sku_id || '',
    product: line.description || line.skus?.name || '',
    qty: Number(line.quantity) || 1,
    unit_price: Number(line.unit_price) || 0,
    tax_type: Number(line.tax_rate) === 0 ? '零稅率' : '應稅',
  }
}

export default function Invoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState(null)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ invoice_number: '', invoice_date: '', buyer_name: '', buyer_tax_id: '', carrier_type: '無', status: '已開立', order_ref: '', currency: 'NTD', exchange_rate: 1 })
  const [lineItems, setLineItems] = useState([emptyLineItem()])
  const [invoiceSeq, setInvoiceSeq] = useState(1)
  const [skus, setSkus] = useState([])

  const [expandedLines, setExpandedLines] = useState([])
  const [expandedLinesLoading, setExpandedLinesLoading] = useState(false)
  const [editingLines, setEditingLines] = useState(null)
  const [editLines, setEditLines] = useState([])
  const [savingLines, setSavingLines] = useState(false)
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(new Set())
  const [currencies, setCurrencies] = useState([])

  useEffect(() => {
    Promise.all([
      getInvoices(),
      getSKUs(),
      getCurrencies(),
    ]).then(([invRes, skuRes, curRes]) => {
      setInvoices(invRes.data || [])
      if (invRes.data && invRes.data.length > 0) setInvoiceSeq(invRes.data.length + 1)
      setSkus(skuRes.data || [])
      setCurrencies(curRes.length > 0 ? curRes : [{ code: 'NTD', name: '新台幣', symbol: 'NT$' }, { code: 'USD', name: '���元', symbol: '$' }, { code: 'EUR', name: '歐元', symbol: '€' }, { code: 'JPY', name: '日圓', symbol: '¥' }, { code: 'CNY', name: '人民幣', symbol: '¥' }, { code: 'GBP', name: '英鎊', symbol: '£' }, { code: 'HKD', name: '港幣', symbol: 'HK$' }])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleCurrencyChange = async (currencyCode) => {
    set('currency', currencyCode)
    if (currencyCode === 'NTD') {
      set('exchange_rate', 1)
    } else {
      const dbRate = await getDbExchangeRate(currencyCode)
      set('exchange_rate', dbRate || DEFAULT_RATES[currencyCode] || 1)
    }
  }

  const updateLineItem = (idx, field, value) => {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, [field]: value } : li))
  }
  const addLineItem = () => setLineItems(prev => [...prev, emptyLineItem()])
  const removeLineItem = (idx) => setLineItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)

  const handleSkuSelect = (idx, skuId) => {
    const sku = skus.find(s => s.id === Number(skuId))
    if (sku) {
      setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, sku_id: sku.id, product: sku.name, unit_price: sku.unit_cost || 0 } : li))
    } else {
      setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, sku_id: '' } : li))
    }
  }

  const handleEditSkuSelect = (idx, skuId) => {
    const sku = skus.find(s => s.id === Number(skuId))
    if (sku) {
      setEditLines(prev => prev.map((li, i) => i === idx ? { ...li, sku_id: sku.id, product: sku.name, unit_price: sku.unit_cost || 0 } : li))
    } else {
      setEditLines(prev => prev.map((li, i) => i === idx ? { ...li, sku_id: '' } : li))
    }
  }

  const totals = calcAllTotals(lineItems)

  const handleAutoNumber = () => {
    try {
      const num = generateInvoiceNumber('AB', invoiceSeq)
      set('invoice_number', num)
      setInvoiceSeq(prev => prev + 1)
    } catch (err) {
      console.error(err)
    }
  }

  const handleSubmit = async () => {
    setFormError('')
    if (!form.invoice_number || !form.buyer_name) {
      setFormError('請填寫發票號碼與買受人')
      return
    }
    if (!validateInvoiceNumber(form.invoice_number)) {
      setFormError('發票號碼格式不正確，需為 2 碼大寫英文 + 8 位數字（例如 AB12345678）')
      return
    }
    if (lineItems.some(li => !li.product)) {
      setFormError('請填寫所有品項名稱')
      return
    }
    if (form.buyer_tax_id) {
      const taxResult = validateTaxId(form.buyer_tax_id)
      if (!taxResult.valid) {
        setFormError(taxResult.error)
        return
      }
    }
    try {
      const exchangeRate = parseFloat(form.exchange_rate) || 1
      const currency = form.currency || 'NTD'
      const ntdTotal = currency !== 'NTD' ? Math.round(totals.grandTotal * exchangeRate) : totals.grandTotal

      const payload = {
        ...form,
        items: lineItems,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.grandTotal,
        currency,
        exchange_rate: exchangeRate,
        ntd_amount: ntdTotal,
      }
      const { data } = await createInvoice(payload)
      if (data) {
        const dbLines = lineItems.map(li => {
          const taxRate = li.tax_type === '應���' ? 0.05 : 0
          return {
            invoice_id: data.id,
            sku_id: li.sku_id || null,
            description: li.product,
            quantity: li.qty,
            unit_price: li.unit_price,
            discount_percent: 0,
            tax_rate: taxRate,
          }
        })
        await batchCreateInvoiceLines(dbLines)
        setInvoices(prev => [...prev, data])
        setShowModal(false)
        setForm({ invoice_number: '', invoice_date: '', buyer_name: '', buyer_tax_id: '', carrier_type: '無', status: '已開立', order_ref: '', currency: 'NTD', exchange_rate: 1 })
        setLineItems([emptyLineItem()])
        setFormError('')
      }
    } catch (err) {
      console.error('Failed to create invoice:', err)
    }
  }

  const handleVoid = async (invoice) => {
    if (!confirm(`確定要作廢發票 ${invoice.invoice_number} 嗎？`)) return
    try {
      const { data } = await updateInvoice(invoice.id, { status: '已作廢' })
      if (data) {
        setInvoices(prev => prev.map(inv => inv.id === invoice.id ? { ...inv, status: '已作廢' } : inv))
      }
    } catch (err) {
      console.error('Failed to void invoice:', err)
    }
  }

  const handleExpandRow = useCallback(async (id) => {
    if (expandedRow === id) {
      setExpandedRow(null)
      setEditingLines(null)
      return
    }
    setExpandedRow(id)
    setEditingLines(null)
    setExpandedLinesLoading(true)
    try {
      const { data } = await getInvoiceLines(id)
      setExpandedLines(data || [])
    } catch (err) {
      console.error('Failed to load invoice lines:', err)
      setExpandedLines([])
    } finally {
      setExpandedLinesLoading(false)
    }
  }, [expandedRow])

  const startEditLines = (invoiceId) => {
    setEditingLines(invoiceId)
    setEditLines(expandedLines.length > 0
      ? expandedLines.map(dbLineToLocal)
      : [emptyLineItem()]
    )
  }

  const updateEditLine = (idx, field, value) => {
    setEditLines(prev => prev.map((li, i) => i === idx ? { ...li, [field]: value } : li))
  }
  const addEditLine = () => setEditLines(prev => [...prev, emptyLineItem()])
  const removeEditLine = (idx) => setEditLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)

  const editTotals = editLines.length > 0 ? calcAllTotals(editLines) : { subtotal: 0, tax: 0, grandTotal: 0, itemsWithTax: [] }

  const handleSaveLines = async (invoiceId) => {
    setSavingLines(true)
    try {
      for (const line of expandedLines) {
        await deleteInvoiceLine(line.id)
      }
      const dbLines = editLines.filter(li => li.product).map(li => {
        const taxRate = li.tax_type === '應稅' ? 0.05 : 0
        return {
          invoice_id: invoiceId,
          sku_id: li.sku_id || null,
          description: li.product,
          quantity: li.qty,
          unit_price: li.unit_price,
          discount_percent: 0,
          tax_rate: taxRate,
        }
      })
      if (dbLines.length > 0) {
        await batchCreateInvoiceLines(dbLines)
      }
      await updateInvoice(invoiceId, {
        items: editLines,
        subtotal: editTotals.subtotal,
        tax: editTotals.tax,
        total: editTotals.grandTotal,
      })
      setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, subtotal: editTotals.subtotal, tax: editTotals.tax, total: editTotals.grandTotal, items: editLines } : i))
      const { data } = await getInvoiceLines(invoiceId)
      setExpandedLines(data || [])
      setEditingLines(null)
    } catch (err) {
      console.error('Failed to save lines:', err)
    } finally {
      setSavingLines(false)
    }
  }

  // ── MIG XML 單張匯出 ──
  const handleExportMIG = (inv) => {
    try {
      const xml = generateMIGXml(inv)
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `einvoice_${inv.invoice_number || 'unknown'}.xml`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('MIG XML export failed:', err)
      alert('MIG XML 匯出失敗: ' + (err.message || '未知錯誤'))
    }
  }

  // ── Turnkey 批次匯出 ──
  const handleExportTurnkeyBatch = () => {
    const selected = invoices.filter(inv => selectedInvoiceIds.has(inv.id))
    if (selected.length === 0) {
      alert('請先勾選要匯出的發票')
      return
    }
    try {
      const content = generateTurnkeyBatch(selected)
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `turnkey_batch_${new Date().toISOString().slice(0, 10)}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Turnkey batch export failed:', err)
      alert('Turnkey 批次匯出失敗: ' + (err.message || '未知錯誤'))
    }
  }

  const toggleSelectInvoice = (id) => {
    setSelectedInvoiceIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedInvoiceIds.size === filtered.length) {
      setSelectedInvoiceIds(new Set())
    } else {
      setSelectedInvoiceIds(new Set(filtered.map(inv => inv.id)))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = invoices.filter(inv =>
    search === '' || inv.invoice_number?.includes(search) || inv.buyer_name?.includes(search) || inv.buyer_tax_id?.includes(search)
  )

  const issued = filtered.filter(inv => inv.status === '已開立').length
  const voided = filtered.filter(inv => inv.status === '已作廢').length
  const now = new Date()
  const thisMonthTotal = filtered
    .filter(inv => {
      const d = new Date(inv.invoice_date || inv.created_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && inv.status === '已開立'
    })
    .reduce((sum, inv) => sum + (inv.total || 0), 0)

  const renderDbLines = (lines) => {
    if (!lines.length) return <em style={{ color: 'var(--text-muted)' }}>無明細</em>
    const linesList = lines.map(l => {
      const amt = Number(l.line_total) || (Number(l.quantity) * Number(l.unit_price))
      const taxRate = Number(l.tax_rate) || 0
      const taxAmt = Math.round(amt * taxRate)
      return {
        product: l.description || l.skus?.name || '',
        skuCode: l.skus?.code || '',
        qty: Number(l.quantity),
        unit_price: Number(l.unit_price),
        tax_type: taxRate > 0 ? '應稅' : '零稅率',
        amount: amt,
        taxAmt,
      }
    })
    const sub = linesList.reduce((s, l) => s + l.amount, 0)
    const tax = linesList.reduce((s, l) => s + l.taxAmt, 0)
    return (
      <>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>品項 (SKU)</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>說明</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>數量</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>單價</th>
              <th style={{ padding: '6px 8px', textAlign: 'center' }}>稅別</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>金額</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>稅額</th>
            </tr>
          </thead>
          <tbody>
            {linesList.map((li, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{li.skuCode || '-'}</td>
                <td style={{ padding: '6px 8px' }}>{li.product}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{li.qty}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(li.unit_price)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <span className={`badge ${li.tax_type === '應稅' ? 'badge-info' : 'badge-secondary'}`}>
                    <span className="badge-dot"></span>{li.tax_type}
                  </span>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(li.amount)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(li.taxAmt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <div style={{ minWidth: 220, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span>小計：</span><span>{fmt(sub)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span>稅額：</span><span>{fmt(tax)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: '2px solid var(--border-color)', fontWeight: 700 }}>
              <span>總計：</span><span>{fmt(sub + tax)}</span>
            </div>
          </div>
        </div>
      </>
    )
  }

  const renderItemsDetail = (rowItems) => {
    const parsedItems = typeof rowItems === 'string' ? JSON.parse(rowItems) : (rowItems || [])
    if (!parsedItems.length) return <em style={{ color: 'var(--text-muted)' }}>無明細</em>
    return (
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-tertiary)' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>品項</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>數量</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>單價</th>
            <th style={{ padding: '6px 8px', textAlign: 'center' }}>稅別</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>金額</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>稅額</th>
          </tr>
        </thead>
        <tbody>
          {parsedItems.map((li, i) => {
            const amt = calcItemAmount({ qty: li.qty, unit_price: li.unit_price || li.unitPrice })
            const { taxAmount } = calculateInvoiceTax(
              [{ description: li.product, qty: li.qty, unitPrice: li.unit_price || li.unitPrice }],
              li.tax_type || '應稅'
            )
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '6px 8px' }}>{li.product || li.description}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{li.qty}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(li.unit_price || li.unitPrice)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <span className={`badge ${li.tax_type === '應稅' ? 'badge-info' : li.tax_type === '免稅' ? 'badge-warning' : 'badge-secondary'}`}>
                    <span className="badge-dot"></span>{li.tax_type || '應稅'}
                  </span>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(amt)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(taxAmount)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  const SkuSelect = ({ value, onChange, style }) => (
    <select className="form-input" style={{ ...style, width: '100%' }} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">-- 選擇品項 --</option>
      {skus.map(s => (
        <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
      ))}
    </select>
  )

  const renderEditableLines = (lines, updateFn, addFn, removeFn, skuSelectFn, totalsObj, label = '發票明細') => (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label style={{ fontWeight: 600, fontSize: 14 }}>{label}</label>
        <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addFn}>
          <Plus size={12} /> 新增品項
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)' }}>
              <th style={{ padding: '8px', textAlign: 'left', minWidth: 150 }}>品項 (SKU)</th>
              <th style={{ padding: '8px', textAlign: 'left', minWidth: 120 }}>品項名稱 *</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 70 }}>數量</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 100 }}>單價</th>
              <th style={{ padding: '8px', textAlign: 'center', width: 100 }}>稅別</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 100 }}>金額</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 80 }}>稅額</th>
              <th style={{ padding: '8px', width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((li, idx) => {
              const amt = calcItemAmount(li)
              const { taxAmount } = calculateInvoiceTax(
                [{ description: li.product, qty: li.qty, unitPrice: li.unit_price }],
                li.tax_type
              )
              return (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '4px 8px' }}>
                    <SkuSelect value={li.sku_id} onChange={(v) => skuSelectFn(idx, v)} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input className="form-input" type="text" style={{ width: '100%' }} placeholder="品項名稱" value={li.product} onChange={e => updateFn(idx, 'product', e.target.value)} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input className="form-input" type="number" style={{ width: '100%', textAlign: 'right' }} min={1} value={li.qty} onChange={e => updateFn(idx, 'qty', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input className="form-input" type="number" style={{ width: '100%', textAlign: 'right' }} min={0} value={li.unit_price} onChange={e => updateFn(idx, 'unit_price', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <select className="form-input" style={{ width: '100%' }} value={li.tax_type} onChange={e => updateFn(idx, 'tax_type', e.target.value)}>
                      {TAX_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>
                    {fmt(amt)}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                    {fmt(taxAmount)}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <button type="button" onClick={() => removeFn(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <div style={{ minWidth: 240, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>小計：</span><span>{fmt(totalsObj.subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>稅額：</span><span>{fmt(totalsObj.tax)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '2px solid var(--border-color)', fontWeight: 700, fontSize: 15 }}>
            <span>總計：</span><span>{fmt(totalsObj.grandTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧾</span> 電子發票</h2>
            <p>電子發票開立與管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }} onClick={handleExportTurnkeyBatch} disabled={selectedInvoiceIds.size === 0}>
              <Download size={14} /> 批次匯出 Turnkey {selectedInvoiceIds.size > 0 && `(${selectedInvoiceIds.size})`}
            </button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 開立發票</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已開立</div>
          <div className="stat-card-value">{issued}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已作廢</div>
          <div className="stat-card-value">{voided}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">本月開立額</div>
          <div className="stat-card-value">{fmt(thisMonthTotal)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 發票列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋發票..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={filtered.length > 0 && selectedInvoiceIds.size === filtered.length} onChange={toggleSelectAll} title="全選" />
                </th>
                <th style={{ width: 32 }}></th>
                <th>發票號碼</th><th>開立日期</th><th>買受人</th><th>統一編號</th><th>小計</th><th>稅額</th><th>總金額</th><th>載具類型</th><th>狀態</th><th>訂單參考</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無發票</td></tr>}
              {filtered.map(inv => (
                <>
                  <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => handleExpandRow(inv.id)}>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedInvoiceIds.has(inv.id)} onChange={() => toggleSelectInvoice(inv.id)} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {expandedRow === inv.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td style={{ fontWeight: 600 }}>{inv.invoice_number}</td>
                    <td>{inv.invoice_date}</td>
                    <td>{inv.buyer_name}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{inv.buyer_tax_id}</td>
                    <td>{fmtCur(inv.subtotal, inv.currency)}</td>
                    <td>{fmtCur(inv.tax, inv.currency)}</td>
                    <td>
                      <div>{fmtCur(inv.total, inv.currency)}</div>
                      {inv.currency && inv.currency !== 'NTD' && (
                        <div style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>
                          {fmt(inv.ntd_amount || Math.round((inv.total || 0) * (inv.exchange_rate || 1)))}
                        </div>
                      )}
                    </td>
                    <td>{inv.carrier_type}</td>
                    <td>
                      <span className={`badge ${inv.status === '已開立' ? 'badge-success' : 'badge-danger'}`}>
                        <span className="badge-dot"></span>{inv.status}
                      </span>
                    </td>
                    <td>{inv.order_ref}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {inv.status === '已開立' && (
                          <>
                            <button
                              className="btn btn-sm"
                              style={{ background: 'transparent', border: '1px solid var(--accent-blue, #3b82f6)', color: 'var(--accent-blue, #3b82f6)', padding: '2px 8px', fontSize: 12, borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              onClick={() => handleExportMIG(inv)}
                              title="匯出 MIG XML"
                            >
                              <FileText size={12} /> MIG
                            </button>
                            <button className="btn btn-sm" style={{ color: 'var(--accent-red)', background: 'transparent', border: '1px solid var(--accent-red)', padding: '2px 8px', fontSize: 12, borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => handleVoid(inv)}>
                              <XCircle size={12} /> 作廢
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedRow === inv.id && (
                    <tr key={`${inv.id}-detail`}>
                      <td colSpan={13} style={{ padding: '12px 24px', background: 'var(--bg-secondary)' }}>
                        {expandedLinesLoading ? (
                          <div style={{ textAlign: 'center', padding: 16 }}><Loader size={16} className="spin" /> 載入明細中...</div>
                        ) : editingLines === inv.id ? (
                          <div>
                            {renderEditableLines(editLines, updateEditLine, addEditLine, removeEditLine, handleEditSkuSelect, editTotals)}
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                              <button className="btn" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => setEditingLines(null)}>取消</button>
                              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} disabled={savingLines} onClick={() => handleSaveLines(inv.id)}>
                                <Save size={12} /> {savingLines ? '儲存中...' : '儲存明細'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            {expandedLines.length > 0
                              ? renderDbLines(expandedLines)
                              : renderItemsDetail(inv.items)
                            }
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                              <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => startEditLines(inv.id)}>
                                <Plus size={12} /> 編輯明細
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="開立發票" onClose={() => { setShowModal(false); setLineItems([emptyLineItem()]); setFormError('') }} onSubmit={handleSubmit} width={820}>
          {formError && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
              {formError}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="發票號碼 *">
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="AB12345678" value={form.invoice_number} onChange={e => set('invoice_number', e.target.value)} />
                <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: '4px 8px', whiteSpace: 'nowrap' }} onClick={handleAutoNumber}>
                  自動產生
                </button>
              </div>
            </Field>
            <Field label="開立日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.invoice_date} onChange={e => set('invoice_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="買受人 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="買受人名稱" value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} />
            </Field>
            <Field label="統一編號">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="12345678 (8碼)" value={form.buyer_tax_id} onChange={e => set('buyer_tax_id', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="載具類型">
              <select className="form-input" style={{ width: '100%' }} value={form.carrier_type} onChange={e => set('carrier_type', e.target.value)}>
                {CARRIER_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="訂單參考">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="SO-001" value={form.order_ref} onChange={e => set('order_ref', e.target.value)} />
            </Field>
          </div>

          {/* Currency Selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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

          {renderEditableLines(lineItems, updateLineItem, addLineItem, removeLineItem, handleSkuSelect, totals)}

          {form.currency !== 'NTD' && (
            <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--accent-cyan)', fontWeight: 600, marginTop: 4 }}>
              NTD 等值: {fmt(Math.round(totals.grandTotal * (parseFloat(form.exchange_rate) || 1)))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
