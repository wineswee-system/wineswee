import { useState, useEffect, useCallback } from 'react'
import { Plus, Download } from 'lucide-react'
import { toast } from '../../lib/toast'
import {
  getInvoices, createInvoice, updateInvoice,
  getInvoiceLines, createInvoiceLine, updateInvoiceLine, deleteInvoiceLine,
  batchCreateInvoiceLines, getSKUs
} from '../../lib/db'
import { useTenant } from '../../contexts/TenantContext'
import { calculateInvoiceTax, validateTaxId, generateInvoiceNumber, generateMIGXml, generateTurnkeyBatch, validateInvoiceNumber } from '../../lib/einvoice'
import { getCurrencies, getDbExchangeRate, formatCurrency as fmtCurrency, DEFAULT_RATES } from '../../lib/currency'
import LoadingSpinner from '../../components/LoadingSpinner'
import InvoiceTable from './components/InvoiceTable'
import InvoiceFormModal from './components/InvoiceFormModal'
import { getEventBus } from '../../lib/events/index.js'

import { confirm } from '../../lib/confirm'
const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const emptyLineItem = () => ({ product: '', sku_id: '', qty: 1, unit_price: 0, tax_type: '應稅' })

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
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
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
      getInvoices(orgId),
      getSKUs(),
      getCurrencies(),
    ]).then(([invRes, skuRes, curRes]) => {
      setInvoices(invRes.data || [])
      if (invRes.data && invRes.data.length > 0) setInvoiceSeq(invRes.data.length + 1)
      setSkus(skuRes.data || [])
      setCurrencies(curRes.length > 0 ? curRes : [{ code: 'NTD', name: '新台幣', symbol: 'NT$' }, { code: 'USD', name: '美元', symbol: '$' }, { code: 'EUR', name: '歐元', symbol: '€' }, { code: 'JPY', name: '日圓', symbol: '¥' }, { code: 'CNY', name: '人民幣', symbol: '¥' }, { code: 'GBP', name: '英鎊', symbol: '£' }, { code: 'HKD', name: '港幣', symbol: 'HK$' }])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [orgId])

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
          const taxRate = li.tax_type === '應稅' ? 0.05 : 0
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
        const bus = getEventBus()
        await bus.publish('finance.ar.created', {
          invoice_id: String(data.id),
          invoice_number: data.invoice_number,
          customer: data.buyer_name,
          amount: data.total || 0,
          tax: data.tax || 0,
          currency: data.currency || 'NTD',
        })
        setForm({ invoice_number: '', invoice_date: '', buyer_name: '', buyer_tax_id: '', carrier_type: '無', status: '已開立', order_ref: '', currency: 'NTD', exchange_rate: 1 })
        setLineItems([emptyLineItem()])
        setFormError('')
      }
    } catch (err) {
      console.error('Failed to create invoice:', err)
    }
  }

  const handleVoid = async (invoice) => {
    if (!(await confirm({ message: `確定要作廢發票 ${invoice.invoice_number} 嗎？` }))) return
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
      toast.error('MIG XML 匯出失敗: ' + (err.message || '未知錯誤'))
    }
  }

  // ── Turnkey 批次匯出 ──
  const handleExportTurnkeyBatch = () => {
    const selected = invoices.filter(inv => selectedInvoiceIds.has(inv.id))
    if (selected.length === 0) {
      toast.warning('請先勾選要匯出的發票')
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
      toast.error('Turnkey 批次匯出失敗: ' + (err.message || '未知錯誤'))
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

      <InvoiceTable
        filtered={filtered}
        search={search}
        setSearch={setSearch}
        selectedInvoiceIds={selectedInvoiceIds}
        toggleSelectInvoice={toggleSelectInvoice}
        toggleSelectAll={toggleSelectAll}
        expandedRow={expandedRow}
        handleExpandRow={handleExpandRow}
        expandedLinesLoading={expandedLinesLoading}
        expandedLines={expandedLines}
        editingLines={editingLines}
        setEditingLines={setEditingLines}
        editLines={editLines}
        updateEditLine={updateEditLine}
        addEditLine={addEditLine}
        removeEditLine={removeEditLine}
        handleEditSkuSelect={handleEditSkuSelect}
        editTotals={editTotals}
        savingLines={savingLines}
        handleSaveLines={handleSaveLines}
        startEditLines={startEditLines}
        handleExportMIG={handleExportMIG}
        handleVoid={handleVoid}
        skus={skus}
      />

      {showModal && (
        <InvoiceFormModal
          form={form}
          set={set}
          formError={formError}
          lineItems={lineItems}
          totals={totals}
          skus={skus}
          currencies={currencies}
          updateLineItem={updateLineItem}
          addLineItem={addLineItem}
          removeLineItem={removeLineItem}
          handleSkuSelect={handleSkuSelect}
          handleAutoNumber={handleAutoNumber}
          handleCurrencyChange={handleCurrencyChange}
          handleSubmit={handleSubmit}
          onClose={() => { setShowModal(false); setLineItems([emptyLineItem()]); setFormError('') }}
        />
      )}
    </div>
  )
}
