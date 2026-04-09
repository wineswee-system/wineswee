import { Search, XCircle, ChevronDown, ChevronRight, Plus, Save, Loader, FileText } from 'lucide-react'
import { calculateInvoiceTax } from '../../../lib/einvoice'
import { formatCurrency as fmtCurrency } from '../../../lib/currency'
import InvoiceLineEditor from './InvoiceLineEditor'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`
const fmtCur = (n, cur) => cur && cur !== 'NTD' ? fmtCurrency(n, cur) : fmt(n)

function calcItemAmount(item) {
  return Math.round((item.qty || 0) * (item.unit_price || 0))
}

function DbLinesDetail({ lines }) {
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

function ItemsDetail({ rowItems }) {
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

export default function InvoiceTable({
  filtered, search, setSearch, selectedInvoiceIds, toggleSelectInvoice, toggleSelectAll,
  expandedRow, handleExpandRow, expandedLinesLoading, expandedLines,
  editingLines, setEditingLines, editLines, updateEditLine, addEditLine, removeEditLine,
  handleEditSkuSelect, editTotals, savingLines, handleSaveLines, startEditLines,
  handleExportMIG, handleVoid, skus,
}) {
  return (
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
                          <InvoiceLineEditor
                            lines={editLines}
                            updateFn={updateEditLine}
                            addFn={addEditLine}
                            removeFn={removeEditLine}
                            skuSelectFn={handleEditSkuSelect}
                            totalsObj={editTotals}
                            skus={skus}
                          />
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
                            ? <DbLinesDetail lines={expandedLines} />
                            : <ItemsDetail rowItems={inv.items} />
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
  )
}
