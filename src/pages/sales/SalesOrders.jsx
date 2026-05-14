import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import { Plus, Search, Trash2, ChevronDown, ChevronRight, Save, Loader } from 'lucide-react'
import {
  getSalesOrders, createSalesOrder, createShipment, updateSalesOrder,
  getSalesOrderLines, createSalesOrderLine, updateSalesOrderLine, deleteSalesOrderLine,
  batchCreateSalesOrderLines, getSKUs
} from '../../lib/db'
import { calculateInvoiceTax } from '../../lib/einvoice'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { getEventBus } from '../../lib/events/index.js'
import { useTenant } from '../../contexts/TenantContext'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`
const PAYMENT_BADGE = { '已付款': 'badge-success', '未付款': 'badge-danger', '部分付款': 'badge-warning' }
const SHIPPING_BADGE = { '已出貨': 'badge-success', '待出貨': 'badge-warning', '已取消': 'badge-danger' }

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

function dbLineToLocal(line) {
  // tax_rate 預設邏輯修：DB 是小數（0.05），UI 顯示是百分比（5）
  // 之前 NaN || 5 會把 NULL 也吃掉變 5，掩蓋資料錯誤；改成顯式 fallback
  const rawTax = line.tax_rate
  const taxPct = (rawTax === null || rawTax === undefined || isNaN(Number(rawTax)))
    ? 5
    : Number(rawTax) * 100
  return {
    _id: line.id,
    sku_id: line.sku_id || '',
    product: line.description || line.skus?.name || '',
    qty: Number(line.quantity) || 1,
    unit_price: Number(line.unit_price) || 0,
    discount: Number(line.discount_percent) || 0,
    tax_rate: taxPct,
  }
}

export default function SalesOrders() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState(null)
  const [form, setForm] = useState({ order_number: '', customer: '', payment_status: '未付款', shipping_status: '待出貨', credit_check: '通過' })
  const [lineItems, setLineItems] = useState([emptyLineItem()])
  const [skus, setSkus] = useState([])

  const [expandedLines, setExpandedLines] = useState([])
  const [expandedLinesLoading, setExpandedLinesLoading] = useState(false)
  const [editingLines, setEditingLines] = useState(null)
  const [editLines, setEditLines] = useState([])
  const [savingLines, setSavingLines] = useState(false)

  useEffect(() => {
    Promise.all([
      getSalesOrders(orgId),
      getSKUs(),
    ]).then(([soRes, skuRes]) => {
      setItems(soRes.data || [])
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

  const totals = calcTotals(lineItems)

  const handleSubmit = async () => {
    if (!form.order_number || !form.customer) return
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
      const { data } = await createSalesOrder(payload)
      if (data) {
        const dbLines = lineItems.map(li => ({
          order_id: data.id,
          sku_id: li.sku_id || null,
          description: li.product,
          quantity: li.qty,
          unit_price: li.unit_price,
          discount_percent: li.discount,
          tax_rate: (li.tax_rate || 5) / 100,
        }))
        await batchCreateSalesOrderLines(dbLines)
        setItems(prev => [...prev, data])
        setShowModal(false)
        setForm({ order_number: '', customer: '', payment_status: '未付款', shipping_status: '待出貨', credit_check: '通過' })
        setLineItems([emptyLineItem()])
        const bus = getEventBus()
        await bus.publish('sales.order.created', {
          order_id: String(data.id),
          order_number: data.order_number,
          customer: data.customer,
          items: lineItems.map(li => ({ sku_id: li.sku_id || null, product: li.product, qty: li.qty, unit_price: li.unit_price })),
          total_amount: totals.grandTotal,
          source: 'direct',
        })
      }
    } catch (err) {
      console.error('Failed to create sales order:', err)
    }
  }

  const [actionMsg, setActionMsg] = useState('')

  const handleShipOrder = async (order) => {
    try {
      const shipNum = `SHP-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`
      await createShipment({
        shipment_number: shipNum,
        order_ref: order.order_number,
        carrier: '待指定',
        destination: order.customer,
        recipient: order.customer,
        items: order.items || [],
        status: '待出貨',
      })
      const { data } = await updateSalesOrder(order.id, { shipping_status: '已出貨' })
      if (data) setItems(prev => prev.map(i => i.id === order.id ? data : i))
      const bus = getEventBus()
      await bus.publish('sales.order.confirmed', {
        order_id: String(order.id),
        order_number: order.order_number,
        customer: order.customer,
        shipment_number: shipNum,
        total_amount: order.total || 0,
      })
      setActionMsg(`已建立出貨單 ${shipNum}`)
      setTimeout(() => setActionMsg(''), 4000)
    } catch (err) {
      console.error('Failed to ship order:', err)
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
      const { data } = await getSalesOrderLines(id)
      setExpandedLines(data || [])
    } catch (err) {
      console.error('Failed to load order lines:', err)
      setExpandedLines([])
    } finally {
      setExpandedLinesLoading(false)
    }
  }, [expandedRow])

  const startEditLines = (orderId) => {
    setEditingLines(orderId)
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

  const handleSaveLines = async (orderId) => {
    setSavingLines(true)
    try {
      for (const line of expandedLines) {
        await deleteSalesOrderLine(line.id)
      }
      const dbLines = editLines.filter(li => li.product).map(li => ({
        order_id: orderId,
        sku_id: li.sku_id || null,
        description: li.product,
        quantity: li.qty,
        unit_price: li.unit_price,
        discount_percent: li.discount,
        tax_rate: (li.tax_rate || 5) / 100,
      }))
      if (dbLines.length > 0) {
        await batchCreateSalesOrderLines(dbLines)
      }
      await updateSalesOrder(orderId, {
        items: editLines,
        subtotal: editTotals.subtotal,
        discount: editTotals.discountTotal,
        tax: editTotals.tax,
        total: editTotals.grandTotal,
      })
      setItems(prev => prev.map(i => i.id === orderId ? { ...i, subtotal: editTotals.subtotal, discount: editTotals.discountTotal, tax: editTotals.tax, total: editTotals.grandTotal, items: editLines } : i))
      const { data } = await getSalesOrderLines(orderId)
      setExpandedLines(data || [])
      setEditingLines(null)
    } catch (err) {
      console.error('Failed to save lines:', err)
    } finally {
      setSavingLines(false)
    }
  }

  const filtered = useMemo(() => items.filter(s =>
    search === '' || s.order_number?.includes(search) || s.customer?.includes(search)
  ), [items, search])

  const { pendingShip, shipped, unpaid, monthRevenue } = useMemo(() => {
    const now = new Date()
    return {
      pendingShip: filtered.filter(s => s.shipping_status === '待出貨').length,
      shipped: filtered.filter(s => s.shipping_status === '已出貨').length,
      unpaid: filtered.filter(s => s.payment_status === '未付款').length,
      monthRevenue: filtered
        .filter(s => { const d = new Date(s.created_at); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() })
        .reduce((sum, s) => sum + (s.total || 0), 0),
    }
  }, [filtered])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

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

  const SkuSelect = ({ value, onChange, style }) => (
    <select className="form-input" style={{ ...style, width: '100%' }} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">-- 選擇品項 --</option>
      {skus.map(s => (
        <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
      ))}
    </select>
  )

  const renderEditableLines = (lines, updateFn, addFn, removeFn, skuSelectFn, totalsObj, label = '訂單明細') => (
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
            <h2><span className="header-icon">📦</span> 銷售訂單</h2>
            <p>訂單管理、出貨與收款追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增訂單</button>
        </div>
        {actionMsg && (
          <div style={{ marginTop: 8, padding: '10px 16px', borderRadius: 10, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontSize: 13, fontWeight: 600 }}>
            {actionMsg}
          </div>
        )}
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待出貨</div>
          <div className="stat-card-value">{pendingShip}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已出貨</div>
          <div className="stat-card-value">{shipped}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">未付款</div>
          <div className="stat-card-value">{unpaid}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">本月營收</div>
          <div className="stat-card-value">{fmt(monthRevenue)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 訂單列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋訂單..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 32 }}></th><th>訂單編號</th><th>客戶</th><th>小計</th><th>稅額</th><th>總金額</th><th>付款狀態</th><th>出貨狀態</th><th>信用檢核</th><th>建立時間</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無訂單</td></tr>}
              {filtered.map(s => (
                <>
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => handleExpandRow(s.id)}>
                    <td style={{ textAlign: 'center' }}>
                      {expandedRow === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td style={{ fontWeight: 600 }}>{s.order_number}</td>
                    <td>{s.customer}</td>
                    <td>{fmt(s.subtotal)}</td>
                    <td>{fmt(s.tax)}</td>
                    <td>{fmt(s.total)}</td>
                    <td>
                      <span className={`badge ${PAYMENT_BADGE[s.payment_status] || 'badge-info'}`}>
                        <span className="badge-dot"></span>{s.payment_status}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${SHIPPING_BADGE[s.shipping_status] || 'badge-info'}`}>
                        <span className="badge-dot"></span>{s.shipping_status}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: s.credit_check === '通過' ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                        {s.credit_check}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}</td>
                    <td onClick={e => e.stopPropagation()}>
                      {s.shipping_status === '待出貨' && s.credit_check === '通過' && (
                        <button className="btn btn-sm btn-primary" onClick={() => handleShipOrder(s)}>安排出貨</button>
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
        <Modal title="新增銷售訂單" onClose={() => { setShowModal(false); setLineItems([emptyLineItem()]) }} onSubmit={handleSubmit} width={820}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="訂單編號" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="SO-2026-001" value={form.order_number} onChange={e => set('order_number', e.target.value)} />
            </Field>
            <Field label="客戶" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="客戶名稱" value={form.customer} onChange={e => set('customer', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="付款狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.payment_status} onChange={e => set('payment_status', e.target.value)}>
                <option>未付款</option>
                <option>部分付款</option>
                <option>已付款</option>
              </select>
            </Field>
            <Field label="出貨狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.shipping_status} onChange={e => set('shipping_status', e.target.value)}>
                <option>待出貨</option>
                <option>已出貨</option>
                <option>已取消</option>
              </select>
            </Field>
            <Field label="信用檢核">
              <select className="form-input" style={{ width: '100%' }} value={form.credit_check} onChange={e => set('credit_check', e.target.value)}>
                <option>通過</option>
                <option>鎖定</option>
              </select>
            </Field>
          </div>

          {renderEditableLines(lineItems, updateLineItem, addLineItem, removeLineItem, handleSkuSelect, totals)}
        </Modal>
      )}
    </div>
  )
}
