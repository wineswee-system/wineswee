import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, ArrowRightCircle, Trash2, ChevronDown, ChevronRight, Save, Loader } from 'lucide-react'
import {
  getQuotations, createQuotation, updateQuotation, createSalesOrder,
  getQuotationLines, createQuotationLine, updateQuotationLine, deleteQuotationLine,
  batchCreateQuotationLines, batchCreateSalesOrderLines, getSKUs
} from '../../lib/db'
import { calculateInvoiceTax } from '../../lib/einvoice'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useTenant } from '../../contexts/TenantContext'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`
const STATUS_BADGE = { '草稿': 'badge-warning', '已送出': 'badge-info', '已成交': 'badge-success', '已失效': 'badge-danger' }

const emptyLineItem = () => ({ product: '', sku_id: '', qty: 1, unit_price: 0, discount: 0, tax_rate: 5 })

function calcLineTotal(item) {
  return Math.round((item.qty || 0) * (item.unit_price || 0) * (1 - (item.discount || 0) / 100))
}

function calcTotals(lineItems) {
  const subtotal = lineItems.reduce((sum, li) => sum + calcLineTotal(li), 0)
  const discountTotal = lineItems.reduce((sum, li) => {
    const gross = Math.round((li.qty || 0) * (li.unit_price || 0))
    return sum + (gross - calcLineTotal(li))
  }, 0)
  const { taxAmount } = calculateInvoiceTax(
    lineItems.map(li => ({ description: li.product, qty: li.qty, unitPrice: li.unit_price * (1 - (li.discount || 0) / 100) })),
    '應稅'
  )
  const grandTotal = subtotal + taxAmount
  return { subtotal, discountTotal, tax: taxAmount, grandTotal }
}

// Convert DB line to local line shape
function dbLineToLocal(line) {
  return {
    _id: line.id,
    sku_id: line.sku_id || '',
    product: line.description || line.skus?.name || '',
    qty: Number(line.quantity) || 1,
    unit_price: Number(line.unit_price) || 0,
    discount: Number(line.discount_percent) || 0,
    tax_rate: Number(line.tax_rate) * 100 || 5,
  }
}

export default function Quotations() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState(null)
  const [form, setForm] = useState({ quote_number: '', customer: '', version: 1, valid_until: '', status: '草稿', created_by: '' })
  const [lineItems, setLineItems] = useState([emptyLineItem()])
  const [skus, setSkus] = useState([])

  // Expanded row line items (DB-backed)
  const [expandedLines, setExpandedLines] = useState([])
  const [expandedLinesLoading, setExpandedLinesLoading] = useState(false)
  const [editingLines, setEditingLines] = useState(null) // quotation id being edited
  const [editLines, setEditLines] = useState([])
  const [savingLines, setSavingLines] = useState(false)

  useEffect(() => {
    Promise.all([
      getQuotations(orgId),
      getSKUs(),
    ]).then(([qRes, skuRes]) => {
      setItems(qRes.data || [])
      setSkus(skuRes.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const updateLineItem = (idx, field, value) => {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, [field]: value } : li))
  }
  const addLineItem = () => setLineItems(prev => [...prev, emptyLineItem()])
  const removeLineItem = (idx) => setLineItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)

  // SKU selection handler for modal
  const handleSkuSelect = (idx, skuId) => {
    const sku = skus.find(s => s.id === Number(skuId))
    if (sku) {
      setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, sku_id: sku.id, product: sku.name, unit_price: sku.unit_cost || 0 } : li))
    } else {
      setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, sku_id: '' } : li))
    }
  }

  // SKU selection handler for edit mode
  const handleEditSkuSelect = (idx, skuId) => {
    const sku = skus.find(s => s.id === Number(skuId))
    if (sku) {
      setEditLines(prev => prev.map((li, i) => i === idx ? { ...li, sku_id: sku.id, product: sku.name, unit_price: sku.unit_cost || 0 } : li))
    } else {
      setEditLines(prev => prev.map((li, i) => i === idx ? { ...li, sku_id: '' } : li))
    }
  }

  const totals = calcTotals(lineItems)

  const handleSubmit = async () => {
    if (!form.quote_number || !form.customer) return
    if (lineItems.some(li => !li.product)) return
    try {
      const payload = {
        ...form,
        items: lineItems,
        subtotal: totals.subtotal,
        discount: totals.discountTotal,
        tax: totals.tax,
        total: totals.grandTotal,
      }
      const { data } = await createQuotation(payload)
      if (data) {
        // Create DB line items
        const dbLines = lineItems.map(li => ({
          quotation_id: data.id,
          sku_id: li.sku_id || null,
          description: li.product,
          quantity: li.qty,
          unit_price: li.unit_price,
          discount_percent: li.discount,
          tax_rate: (li.tax_rate || 5) / 100,
        }))
        await batchCreateQuotationLines(dbLines)
        setItems(prev => [...prev, data])
        setShowModal(false)
        setForm({ quote_number: '', customer: '', version: 1, valid_until: '', status: '草稿', created_by: '' })
        setLineItems([emptyLineItem()])
      }
    } catch (err) {
      console.error('Failed to create quotation:', err)
    }
  }

  const [convertMsg, setConvertMsg] = useState('')

  const handleConvertToOrder = async (item) => {
    try {
      const orderNumber = `SO-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`
      const { data: order } = await createSalesOrder({
        order_number: orderNumber,
        quote_id: item.id,
        customer: item.customer,
        items: item.items || [],
        subtotal: item.subtotal || item.total || 0,
        discount: item.discount || 0,
        tax: item.tax || 0,
        total: item.total || 0,
        created_by: item.created_by || '系統',
      })
      if (order) {
        // Copy quotation lines to sales order lines
        const { data: qLines } = await getQuotationLines(item.id)
        if (qLines && qLines.length > 0) {
          const orderLines = qLines.map(ql => ({
            order_id: order.id,
            sku_id: ql.sku_id || null,
            description: ql.description,
            quantity: ql.quantity,
            unit_price: ql.unit_price,
            discount_percent: ql.discount_percent,
            tax_rate: ql.tax_rate,
          }))
          await batchCreateSalesOrderLines(orderLines)
        }
        await updateQuotation(item.id, { status: '已成交', converted_order_id: order.id })
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: '已成交' } : i))
        setConvertMsg(`已建立銷售訂單 ${orderNumber}`)
        setTimeout(() => setConvertMsg(''), 4000)
      }
    } catch (err) {
      console.error('Failed to convert to order:', err)
    }
  }

  // Load line items when expanding a row
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
      const { data } = await getQuotationLines(id)
      setExpandedLines(data || [])
    } catch (err) {
      console.error('Failed to load quotation lines:', err)
      setExpandedLines([])
    } finally {
      setExpandedLinesLoading(false)
    }
  }, [expandedRow])

  // Start editing lines for expanded row
  const startEditLines = (quotationId) => {
    setEditingLines(quotationId)
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

  const editTotals = editLines.length > 0 ? calcTotals(editLines) : { subtotal: 0, discountTotal: 0, tax: 0, grandTotal: 0 }

  // Save edited lines
  const handleSaveLines = async (quotationId) => {
    setSavingLines(true)
    try {
      // Delete all existing lines for this quotation
      for (const line of expandedLines) {
        await deleteQuotationLine(line.id)
      }
      // Create new lines
      const dbLines = editLines.filter(li => li.product).map(li => ({
        quotation_id: quotationId,
        sku_id: li.sku_id || null,
        description: li.product,
        quantity: li.qty,
        unit_price: li.unit_price,
        discount_percent: li.discount,
        tax_rate: (li.tax_rate || 5) / 100,
      }))
      if (dbLines.length > 0) {
        await batchCreateQuotationLines(dbLines)
      }
      // Update header totals
      await updateQuotation(quotationId, {
        items: editLines,
        subtotal: editTotals.subtotal,
        discount: editTotals.discountTotal,
        tax: editTotals.tax,
        total: editTotals.grandTotal,
      })
      // Refresh
      setItems(prev => prev.map(i => i.id === quotationId ? { ...i, subtotal: editTotals.subtotal, discount: editTotals.discountTotal, tax: editTotals.tax, total: editTotals.grandTotal, items: editLines } : i))
      const { data } = await getQuotationLines(quotationId)
      setExpandedLines(data || [])
      setEditingLines(null)
    } catch (err) {
      console.error('Failed to save lines:', err)
    } finally {
      setSavingLines(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = items.filter(s =>
    search === '' || s.quote_number?.includes(search) || s.customer?.includes(search)
  )

  const draft = filtered.filter(s => s.status === '草稿').length
  const sent = filtered.filter(s => s.status === '已送出').length
  const won = filtered.filter(s => s.status === '已成交').length
  const now = new Date()
  const monthTotal = filtered
    .filter(s => { const d = new Date(s.created_at); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() })
    .reduce((sum, s) => sum + (s.total || 0), 0)

  // Render line items in expanded detail (read-only view)
  const renderDbLines = (lines) => {
    if (!lines.length) return <em style={{ color: 'var(--text-muted)' }}>無明細</em>
    const linesList = lines.map(l => ({
      product: l.description || l.skus?.name || '',
      skuCode: l.skus?.code || '',
      qty: Number(l.quantity),
      unit_price: Number(l.unit_price),
      discount: Number(l.discount_percent),
      tax_rate: Number(l.tax_rate) * 100,
      line_total: Number(l.line_total),
    }))
    const sub = linesList.reduce((s, l) => s + l.line_total, 0)
    const tax = linesList.reduce((s, l) => s + Math.round(l.line_total * l.tax_rate / 100), 0)
    return (
      <>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>品項 (SKU)</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>說明</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>數量</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>單價</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>折扣 %</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>稅率</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>小計</th>
            </tr>
          </thead>
          <tbody>
            {linesList.map((li, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{li.skuCode || '-'}</td>
                <td style={{ padding: '6px 8px' }}>{li.product}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{li.qty}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(li.unit_price)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{li.discount}%</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{li.tax_rate}%</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(li.line_total)}</td>
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

  // Render legacy JSONB items fallback
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
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>折扣 %</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>小計</th>
          </tr>
        </thead>
        <tbody>
          {parsedItems.map((li, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '6px 8px' }}>{li.product || li.description}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{li.qty}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(li.unit_price || li.unitPrice)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{li.discount || 0}%</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(calcLineTotal({ qty: li.qty, unit_price: li.unit_price || li.unitPrice, discount: li.discount || 0 }))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  // SKU select dropdown component
  const SkuSelect = ({ value, onChange, style }) => (
    <select className="form-input" style={{ ...style, width: '100%' }} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">-- 選擇品項 --</option>
      {skus.map(s => (
        <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
      ))}
    </select>
  )

  // Render editable lines table (used in both modal and expanded edit)
  const renderEditableLines = (lines, updateFn, addFn, removeFn, skuSelectFn, totalsObj) => (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label style={{ fontWeight: 600, fontSize: 14 }}>報價明細</label>
        <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addFn}>
          <Plus size={12} /> 新增品項
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)' }}>
              <th style={{ padding: '8px', textAlign: 'left', minWidth: 150 }}>品項 (SKU)</th>
              <th style={{ padding: '8px', textAlign: 'left', minWidth: 120 }}>說明 *</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 70 }}>數量</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 100 }}>單價</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 70 }}>折扣 %</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 60 }}>稅率</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 100 }}>小計</th>
              <th style={{ padding: '8px', width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((li, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '4px 8px' }}>
                  <SkuSelect value={li.sku_id} onChange={(v) => skuSelectFn(idx, v)} />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input className="form-input" type="text" style={{ width: '100%' }} placeholder="說明" value={li.product} onChange={e => updateFn(idx, 'product', e.target.value)} />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input className="form-input" type="number" style={{ width: '100%', textAlign: 'right' }} min={1} value={li.qty} onChange={e => updateFn(idx, 'qty', Number(e.target.value))} />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input className="form-input" type="number" style={{ width: '100%', textAlign: 'right' }} min={0} value={li.unit_price} onChange={e => updateFn(idx, 'unit_price', Number(e.target.value))} />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input className="form-input" type="number" style={{ width: '100%', textAlign: 'right' }} min={0} max={100} value={li.discount} onChange={e => updateFn(idx, 'discount', Number(e.target.value))} />
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {li.tax_rate}%
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>
                  {fmt(calcLineTotal(li))}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                  <button type="button" onClick={() => removeFn(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Totals */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <div style={{ minWidth: 240, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>小計：</span><span>{fmt(totalsObj.subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--accent-red)' }}>
            <span>折扣總額：</span><span>-{fmt(totalsObj.discountTotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>稅額 (5%)：</span><span>{fmt(totalsObj.tax)}</span>
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
            <h2><span className="header-icon">📝</span> 報價管理</h2>
            <p>報價單建立、追蹤與轉換</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增報價</button>
        </div>
        {convertMsg && (
          <div style={{ marginTop: 8, padding: '10px 16px', borderRadius: 10, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontSize: 13, fontWeight: 600 }}>
            {convertMsg}
          </div>
        )}
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">草稿</div>
          <div className="stat-card-value">{draft}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">已送出</div>
          <div className="stat-card-value">{sent}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已成交</div>
          <div className="stat-card-value">{won}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">本月報價額</div>
          <div className="stat-card-value">{fmt(monthTotal)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 報價單列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋報價單..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 32 }}></th><th>報價單號</th><th>客戶</th><th>版本</th><th>小計</th><th>稅額</th><th>總金額</th><th>有效期限</th><th>狀態</th><th>建立者</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無報價單</td></tr>}
              {filtered.map(s => (
                <>
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => handleExpandRow(s.id)}>
                    <td style={{ textAlign: 'center' }}>
                      {expandedRow === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td style={{ fontWeight: 600 }}>{s.quote_number}</td>
                    <td>{s.customer}</td>
                    <td>v{s.version}</td>
                    <td>{fmt(s.subtotal)}</td>
                    <td>{fmt(s.tax)}</td>
                    <td>{fmt(s.total)}</td>
                    <td>{s.valid_until}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[s.status] || 'badge-info'}`}>
                        <span className="badge-dot"></span>{s.status}
                      </span>
                    </td>
                    <td>{s.created_by}</td>
                    <td onClick={e => e.stopPropagation()}>
                      {s.status === '已送出' && (
                        <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => handleConvertToOrder(s)}>
                          <ArrowRightCircle size={12} /> 轉為訂單
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedRow === s.id && (
                    <tr key={`${s.id}-detail`}>
                      <td colSpan={11} style={{ padding: '12px 24px', background: 'var(--bg-secondary)' }}>
                        {expandedLinesLoading ? (
                          <div style={{ textAlign: 'center', padding: 16 }}><Loader size={16} className="spin" /> 載入明細中...</div>
                        ) : editingLines === s.id ? (
                          <div>
                            {renderEditableLines(editLines, updateEditLine, addEditLine, removeEditLine, handleEditSkuSelect, editTotals)}
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                              <button className="btn" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => setEditingLines(null)}>取消</button>
                              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} disabled={savingLines} onClick={() => handleSaveLines(s.id)}>
                                <Save size={12} /> {savingLines ? '儲存中...' : '儲存明細'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            {expandedLines.length > 0
                              ? renderDbLines(expandedLines)
                              : renderItemsDetail(s.items)
                            }
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                              <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => startEditLines(s.id)}>
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
        <Modal title="新增報價單" onClose={() => { setShowModal(false); setLineItems([emptyLineItem()]) }} onSubmit={handleSubmit} width={820}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="報價單號 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="Q-2026-001" value={form.quote_number} onChange={e => set('quote_number', e.target.value)} />
            </Field>
            <Field label="客戶 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="客戶名稱" value={form.customer} onChange={e => set('customer', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Field label="版本">
              <input className="form-input" type="number" style={{ width: '100%' }} min={1} value={form.version} onChange={e => set('version', Number(e.target.value))} />
            </Field>
            <Field label="有效期限">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.valid_until} onChange={e => set('valid_until', e.target.value)} />
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>草稿</option>
                <option>已送出</option>
                <option>已成交</option>
                <option>已失效</option>
              </select>
            </Field>
            <Field label="建立者">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="姓名" value={form.created_by} onChange={e => set('created_by', e.target.value)} />
            </Field>
          </div>

          {renderEditableLines(lineItems, updateLineItem, addLineItem, removeLineItem, handleSkuSelect, totals)}
        </Modal>
      )}
    </div>
  )
}
