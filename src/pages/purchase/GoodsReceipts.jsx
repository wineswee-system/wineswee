import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, Search, CheckCircle, XCircle, AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { getGoodsReceipts, createGoodsReceipt, getPurchaseOrders, getAccountsPayable } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { getEventBus } from '../../lib/events/index.js'
import { performThreeWayMatch, calculatePriceVariance, performThreeWayMatchById } from '../../lib/threeWayMatch'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

export default function GoodsReceipts() {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id
  const [receipts, setReceipts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ po_id: '', receiver: '', received_date: '', notes: '' })

  // Three-way match state
  const [matchResults, setMatchResults] = useState({}) // keyed by GR id
  const [showMatchModal, setShowMatchModal] = useState(null) // holds the GR being matched
  const [matchLoading, setMatchLoading] = useState(false)
  const [currentMatchResult, setCurrentMatchResult] = useState(null)
  const [autoMatchAlert, setAutoMatchAlert] = useState(null) // auto-match warning after GR save

  useEffect(() => {
    getGoodsReceipts().then(({ data }) => { setReceipts(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.po_id || !form.receiver) return
    const poId = parseInt(form.po_id) || 0
    const { data } = await createGoodsReceipt({ ...form, po_id: poId, status: '已驗收' })
    if (data) {
      setReceipts(prev => [...prev, data])
      setShowModal(false)
      setForm({ po_id: '', receiver: '', received_date: '', notes: '' })
      // 自動產生應付帳款
      const { data: po } = await supabase.from('purchase_orders').select('*').eq('id', poId).maybeSingle()
      if (po) getEventBus().publish('purchase.goods_receipt.completed', {
          receipt_id: data.id,
          po_id: po.id,
          po_number: po.po_number,
          supplier: po.supplier,
          total_amount: po.total_amount,
          tax: po.tax,
          shipping: po.shipping,
          payment_terms: po.payment_terms,
        }, { source: 'GoodsReceipts.jsx' })

      // 自動執行三方比對
      try {
        const matchResult = await performThreeWayMatchById(poId)
        if (matchResult && !matchResult.error) {
          setMatchResults(prev => ({
            ...prev,
            [data.id]: matchResult.status === 'matched' ? '已比對' : '有差異',
          }))
          if (matchResult.status !== 'matched') {
            setAutoMatchAlert({
              grId: data.id,
              status: matchResult.status,
              discrepancies: matchResult.discrepancies || [],
            })
          }
        }
      } catch (matchErr) {
        console.error('自動三方比對失敗:', matchErr)
      }
    }
  }

  // ── Three-Way Match Handler ──
  const handleThreeWayMatch = async (gr) => {
    setShowMatchModal(gr)
    setMatchLoading(true)
    setCurrentMatchResult(null)

    try {
      // 1. Load the related PO
      const { data: po } = await supabase.from('purchase_orders').select('*').eq('id', gr.po_id).maybeSingle()
      if (!po) {
        setCurrentMatchResult({ error: `找不到對應的採購單 PO-${String(gr.po_id).padStart(3, '0')}` })
        setMatchLoading(false)
        return
      }

      // 2. Find matching AP / invoice records for this PO
      const { data: apRecords } = await getAccountsPayable(orgId)
      const matchingAP = (apRecords || []).find(ap =>
        ap.po_id === gr.po_id || ap.reference?.includes(String(gr.po_id)) || ap.reference?.includes(po.po_number)
      )

      // 3. Build normalized objects for the matching engine
      // PO items: use line_items if available, otherwise build a single-item from totals
      const poItems = po.line_items && Array.isArray(po.line_items) && po.line_items.length > 0
        ? po.line_items.map(li => ({
            itemCode: li.product || li.itemCode || 'ITEM',
            description: li.product || li.description || '',
            qty: li.qty || 0,
            unitPrice: li.unit_price || li.unitPrice || 0,
          }))
        : [{ itemCode: 'TOTAL', description: po.supplier || '', qty: 1, unitPrice: po.total_amount || 0 }]

      const purchaseOrder = {
        poNumber: po.po_number,
        items: poItems,
        total: (po.total_amount || 0) + (po.tax || 0) + (po.shipping || 0),
      }

      // GR items: use received_items if available, otherwise mirror PO structure
      const grItemsNorm = gr.received_items && Array.isArray(gr.received_items) && gr.received_items.length > 0
        ? gr.received_items.map(ri => ({
            itemCode: ri.product || ri.itemCode || 'ITEM',
            receivedQty: ri.received_qty || ri.receivedQty || ri.qty || 0,
          }))
        : poItems.map(pi => ({ itemCode: pi.itemCode, receivedQty: pi.qty }))

      const goodsReceipt = {
        grNumber: `GR-${String(gr.id).padStart(3, '0')}`,
        items: grItemsNorm,
        receivedDate: gr.received_date,
      }

      // Invoice / AP record
      const invItems = matchingAP
        ? (matchingAP.line_items && Array.isArray(matchingAP.line_items) && matchingAP.line_items.length > 0
            ? matchingAP.line_items.map(li => ({
                itemCode: li.product || li.itemCode || 'ITEM',
                qty: li.qty || 0,
                unitPrice: li.unit_price || li.unitPrice || 0,
              }))
            : poItems.map(pi => ({ itemCode: pi.itemCode, qty: pi.qty, unitPrice: pi.unitPrice })))
        : poItems.map(pi => ({ itemCode: pi.itemCode, qty: pi.qty, unitPrice: pi.unitPrice }))

      const invoice = {
        invoiceNumber: matchingAP ? (matchingAP.invoice_number || `AP-${String(matchingAP.id).padStart(3, '0')}`) : '(未找到發票)',
        items: invItems,
        total: matchingAP ? (matchingAP.amount || 0) : purchaseOrder.total,
      }

      // 4. Run the match
      const result = performThreeWayMatch(purchaseOrder, goodsReceipt, invoice)

      const fullResult = {
        ...result,
        po,
        invoice,
        purchaseOrder,
        goodsReceipt,
        matchingAP,
      }

      setCurrentMatchResult(fullResult)
      setMatchResults(prev => ({
        ...prev,
        [gr.id]: result.matched ? '已比對' : '有差異',
      }))
    } catch (err) {
      console.error('三方比對失敗:', err)
      setCurrentMatchResult({ error: '比對過程發生錯誤' })
    } finally {
      setMatchLoading(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = receipts.filter(r =>
    search === '' || String(r.po_id)?.includes(search) || r.receiver?.includes(search)
  )

  const pendingInspection = filtered.filter(r => r.status === '待驗收').length
  const inspected = filtered.filter(r => r.status === '已驗收').length

  const now = new Date()
  const monthCount = filtered.filter(r => {
    const d = new Date(r.received_date || r.created_at)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).length

  // Three-way match stats
  const totalMatched = Object.values(matchResults).filter(s => s === '已比對').length
  const totalUnmatched = Object.values(matchResults).filter(s => s === '有差異').length
  const autoApprovedCount = Object.values(matchResults).filter(s => s === '已比對').length

  const statusBadge = (status) => {
    const cls = status === '已驗收' ? 'badge-success' : status === '異常' ? 'badge-danger' : 'badge-warning'
    return <span className={`badge ${cls}`}><span className="badge-dot"></span>{status}</span>
  }

  const matchStatusBadge = (grId) => {
    const status = matchResults[grId]
    if (!status) return <span className="badge badge-warning" style={{ fontSize: 11 }}><span className="badge-dot"></span>未比對</span>
    if (status === '已比對') return <span className="badge badge-success" style={{ fontSize: 11 }}><span className="badge-dot"></span>已比對</span>
    return <span className="badge badge-danger" style={{ fontSize: 11 }}><span className="badge-dot"></span>有差異</span>
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📥</span> 進貨驗收</h2>
            <p>進貨驗收記錄與管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增驗收單</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待驗收</div>
          <div className="stat-card-value">{pendingInspection}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已驗收</div>
          <div className="stat-card-value">{inspected}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">本月驗收數</div>
          <div className="stat-card-value">{monthCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">三方比對</div>
          <div className="stat-card-value" style={{ fontSize: 16 }}>
            <span style={{ color: 'var(--accent-green)' }}>{totalMatched} 通過</span>
            {totalUnmatched > 0 && <span style={{ color: 'var(--accent-red)', marginLeft: 8 }}>{totalUnmatched} 差異</span>}
            {totalMatched === 0 && totalUnmatched === 0 && <span style={{ color: 'var(--text-muted)' }}>--</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>自動核准: {autoApprovedCount}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 驗收單列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋PO編號/驗收人..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>驗收單號</th><th>對應 PO</th><th>驗收人</th><th>驗收日期</th><th>備註</th><th>狀態</th><th>比對狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無驗收記錄</td></tr>}
              {filtered.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>GR-{String(r.id).padStart(3, '0')}</td>
                  <td><span className="badge badge-info"><span className="badge-dot"></span>PO-{String(r.po_id).padStart(3, '0')}</span></td>
                  <td>{r.receiver}</td>
                  <td>{r.received_date}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.notes || '-'}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td>{matchStatusBadge(r.id)}</td>
                  <td>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => handleThreeWayMatch(r)}
                    >
                      <ArrowRightLeft size={12} /> 三方比對
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auto-match alert after GR save */}
      {autoMatchAlert && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
          maxWidth: 420, padding: 16, borderRadius: 12,
          background: autoMatchAlert.status === 'mismatch' ? 'var(--accent-red-dim)' : 'var(--accent-orange-dim)',
          border: `1px solid ${autoMatchAlert.status === 'mismatch' ? 'var(--accent-red)' : 'var(--accent-orange)'}40`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={18} style={{ color: autoMatchAlert.status === 'mismatch' ? 'var(--accent-red)' : 'var(--accent-orange)' }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: autoMatchAlert.status === 'mismatch' ? 'var(--accent-red)' : 'var(--accent-orange)' }}>
              三方比對{autoMatchAlert.status === 'mismatch' ? '不符' : '部分比對'}
            </span>
            <button
              onClick={() => setAutoMatchAlert(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
            >
              <XCircle size={16} />
            </button>
          </div>
          {autoMatchAlert.discrepancies.slice(0, 3).map((d, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, paddingLeft: 26 }}>
              {d}
            </div>
          ))}
          {autoMatchAlert.discrepancies.length > 3 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 26 }}>
              ...還有 {autoMatchAlert.discrepancies.length - 3} 項差異
            </div>
          )}
        </div>
      )}

      {/* New GR Modal */}
      {showModal && (
        <Modal title="新增驗收單" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="對應 PO ID" required>
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="PO ID" value={form.po_id} onChange={e => set('po_id', e.target.value)} />
            </Field>
            <Field label="驗收人" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="驗收人姓名" value={form.receiver} onChange={e => set('receiver', e.target.value)} />
            </Field>
          </div>
          <Field label="驗收日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.received_date} onChange={e => set('received_date', e.target.value)} />
          </Field>
          <Field label="備註">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="驗收備註說明" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* Three-Way Match Result Modal */}
      {showMatchModal && (
        <Modal
          title={`三方比對結果 — GR-${String(showMatchModal.id).padStart(3, '0')}`}
          onClose={() => { setShowMatchModal(null); setCurrentMatchResult(null) }}
          onSubmit={() => { setShowMatchModal(null); setCurrentMatchResult(null) }}
          submitLabel="關閉"
        >
          {matchLoading && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <LoadingSpinner />
              <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>正在比對中...</p>
            </div>
          )}

          {currentMatchResult?.error && (
            <div style={{ padding: 16, background: 'var(--accent-red-dim)', borderRadius: 8, color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <XCircle size={18} />
              <span>{currentMatchResult.error}</span>
            </div>
          )}

          {currentMatchResult && !currentMatchResult.error && !matchLoading && (
            <div>
              {/* Overall status banner */}
              <div style={{
                padding: 16,
                borderRadius: 8,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: currentMatchResult.matched ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
                color: currentMatchResult.matched ? 'var(--accent-green)' : 'var(--accent-red)',
                fontWeight: 600,
              }}>
                {currentMatchResult.matched ? <CheckCircle size={22} /> : <AlertTriangle size={22} />}
                <div>
                  <div style={{ fontSize: 16 }}>{currentMatchResult.matched ? '三方比對通過' : '三方比對有差異'}</div>
                  <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.85, marginTop: 2 }}>
                    {currentMatchResult.autoApprove ? '已自動核准付款' : '需人工審核'}
                  </div>
                </div>
              </div>

              {/* Document summary */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div style={{ padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent-cyan)' }}>採購單 (PO)</div>
                  <div>{currentMatchResult.po?.po_number}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt(currentMatchResult.purchaseOrder?.total)}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent-green)' }}>收貨單 (GR)</div>
                  <div>{currentMatchResult.goodsReceipt?.grNumber}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{showMatchModal.received_date}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent-purple)' }}>發票 (Invoice)</div>
                  <div>{currentMatchResult.invoice?.invoiceNumber}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt(currentMatchResult.invoice?.total)}</div>
                </div>
              </div>

              {/* Matched items */}
              {currentMatchResult.purchaseOrder?.items?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>比對明細</div>
                  <table className="data-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>品項</th>
                        <th>PO 數量</th>
                        <th>GR 數量</th>
                        <th>發票數量</th>
                        <th>PO 單價</th>
                        <th>發票單價</th>
                        <th>狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentMatchResult.purchaseOrder.items.map((item, i) => {
                        const grItem = currentMatchResult.goodsReceipt?.items?.find(g => g.itemCode === item.itemCode)
                        const invItem = currentMatchResult.invoice?.items?.find(inv => inv.itemCode === item.itemCode)
                        const hasDiscrepancy = currentMatchResult.discrepancies?.some(d =>
                          d.field?.includes(item.itemCode)
                        )
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{item.itemCode}</td>
                            <td>{item.qty}</td>
                            <td>{grItem?.receivedQty ?? '-'}</td>
                            <td>{invItem?.qty ?? '-'}</td>
                            <td>{fmt(item.unitPrice)}</td>
                            <td>{fmt(invItem?.unitPrice)}</td>
                            <td>
                              {hasDiscrepancy
                                ? <span style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={14} /> 差異</span>
                                : <span style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> 一致</span>
                              }
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Discrepancies detail */}
              {currentMatchResult.discrepancies?.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: 'var(--accent-red)' }}>差異明細</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {currentMatchResult.discrepancies.map((d, i) => (
                      <div key={i} style={{
                        padding: 10,
                        background: 'var(--accent-red-dim)',
                        borderRadius: 8,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <XCircle size={14} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{d.field}</div>
                          <div style={{ color: 'var(--text-secondary)' }}>
                            PO: {d.po_value} | GR: {d.gr_value} | 發票: {d.inv_value}
                            {d.variance !== 'missing_item' && (
                              <span style={{ marginLeft: 8, color: 'var(--accent-red)' }}>
                                (差異: {(d.variance * 100).toFixed(1)}%)
                              </span>
                            )}
                            {d.variance === 'missing_item' && (
                              <span style={{ marginLeft: 8, color: 'var(--accent-red)' }}>(品項缺少)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tolerance info */}
              <div style={{ marginTop: 16, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                容差設定 — 數量: {(currentMatchResult.toleranceUsed?.qty * 100)}% | 單價: {(currentMatchResult.toleranceUsed?.price * 100)}% | 總額: {(currentMatchResult.toleranceUsed?.total * 100)}%
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
