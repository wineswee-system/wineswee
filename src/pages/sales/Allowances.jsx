import { useState, useEffect, useMemo } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { getSalesOrders } from '../../lib/db'
import { getSalesAllowances, cancelSalesAllowanceDraft } from '../../lib/db/allowances'
import {
  createSalesAllowance, confirmSalesAllowance,
  computeAllowanceTotals, remainingAllowable, ALLOWANCE_STATUS_LABELS,
} from '../../lib/allowances'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useOrgId } from '../../contexts/AuthContext'
import { confirm } from '../../lib/confirm'
import { toast } from '../../lib/toast'

// F-C3.2 銷貨折讓單：獨立單據（非退貨、不動庫存）。
// 確認時：傳票（借 4200+2170／貸 1130）+ 銷項折讓憑證（格式 33）+ 連動發票時 D0401。
const STATUS_BADGE = { draft: 'badge-info', confirmed: 'badge-success', cancelled: 'badge-danger' }
const EMPTY_LINE = { description: '', quantity: 1, unit_price: 0 }
const EMPTY_FORM = {
  originalDocType: 'manual', originalDocId: '', customerName: '',
  invoiceNumber: '', reason: '', lines: [{ ...EMPTY_LINE }],
}

export default function Allowances() {
  const orgId = useOrgId()
  const [items, setItems] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    Promise.all([getSalesAllowances(orgId), getSalesOrders(orgId)])
      .then(([a, o]) => { setItems(a.data || []); setOrders(o.data || []) })
      .catch((err) => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') })
      .finally(() => setLoading(false))
  }, [orgId])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setLine = (i, k, v) => setForm((f) => ({
    ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)),
  }))
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }))
  const removeLine = (i) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))

  const totals = useMemo(() => computeAllowanceTotals(form.lines), [form.lines])

  // AL-03：連動訂單時顯示剩餘可折讓額（已確認折讓累計）
  const selectedOrder = useMemo(
    () => (form.originalDocType === 'sales_order'
      ? orders.find((o) => String(o.id) === String(form.originalDocId)) : null),
    [orders, form.originalDocType, form.originalDocId]
  )
  const remaining = useMemo(() => {
    if (!selectedOrder) return null
    const confirmed = items.filter((a) =>
      a.original_doc_type === 'sales_order' &&
      String(a.original_doc_id) === String(selectedOrder.id) &&
      a.status === 'confirmed')
    return remainingAllowable(Number(selectedOrder.total) || 0, confirmed)
  }, [selectedOrder, items])

  // 選訂單 → 帶入客戶 + 明細行
  const pickOrder = (orderId) => {
    const o = orders.find((x) => String(x.id) === String(orderId))
    if (!o) { set('originalDocId', orderId); return }
    const lines = (Array.isArray(o.items) ? o.items : []).map((it) => ({
      description: it.name ?? it.description ?? '',
      quantity: Number(it.qty ?? it.quantity) || 1,
      unit_price: Number(it.price ?? it.unit_price) || 0,
    }))
    setForm((f) => ({
      ...f, originalDocId: String(orderId), customerName: o.customer || '',
      lines: lines.length ? lines : [{ ...EMPTY_LINE }],
    }))
  }

  // 輸入發票號碼 → 帶入發票金額（全額折讓一行）
  const pickInvoice = async () => {
    if (!form.invoiceNumber) { toast.error('請先輸入發票號碼'); return }
    const { data: inv, error: err } = await supabase
      .from('pos_invoices')
      .select('id, invoice_number, sales_amount, tax_amount, buyer_company, status')
      .eq('invoice_number', form.invoiceNumber.trim())
      .maybeSingle()
    if (err || !inv) { toast.error('查無此發票，請確認號碼'); return }
    if (inv.status !== 'issued') { toast.error(`發票狀態為 ${inv.status}，無法折讓`); return }
    setForm((f) => ({
      ...f,
      originalDocId: String(inv.id),
      invoiceNumber: inv.invoice_number,
      customerName: inv.buyer_company || f.customerName,
      lines: [{ description: `發票 ${inv.invoice_number} 折讓`, quantity: 1, unit_price: Number(inv.sales_amount) || 0 }],
    }))
  }

  const handleSubmit = async () => {
    if (!(totals.total > 0)) { toast.error('折讓金額必須大於 0'); return false }
    if (remaining != null && totals.total > remaining) {
      toast.error(`折讓總額 NT$${totals.total.toLocaleString()} 超過原訂單剩餘可折讓額 NT$${remaining.toLocaleString()}`)
      return false
    }
    try {
      const row = await createSalesAllowance({
        orgId,
        originalDocType: form.originalDocType,
        originalDocId: form.originalDocId || null,
        customerName: form.customerName,
        invoiceNumber: form.invoiceNumber || null,
        lines: form.lines,
        reason: form.reason,
      })
      setItems((prev) => [row, ...prev])
      setShowModal(false)
      setForm(EMPTY_FORM)
      toast.success(`已建立折讓草稿 ${row.allowance_number}`)
    } catch (e) {
      toast.error(e.message)
      return false
    }
  }

  // 確認：說明將發生的三件事（傳票 + 折讓發票 + 憑證檔）
  const handleConfirm = async (a) => {
    const ok = await confirm({
      title: `確認折讓單 ${a.allowance_number}？`,
      message: `確認後將自動執行：\n・拋轉折讓傳票（借 銷貨退回及折讓/銷項稅額、貸 應收帳款）\n・寫入銷項折讓憑證檔（401 申報，格式 33）\n${a.invoice_number ? `・對發票 ${a.invoice_number} 開立折讓證明單（D0401）` : '・未連動發票 — 不開立 D0401'}\n\n折讓總額 NT$${((Number(a.amount) || 0) + (Number(a.tax_amount) || 0)).toLocaleString()}。確認後不可取消。`,
      confirmLabel: '確認折讓',
      cancelLabel: '再想想',
    })
    if (!ok) return
    setBusyId(a.id)
    try {
      const { allowance, einvoice } = await confirmSalesAllowance(a.id)
      setItems((prev) => prev.map((x) => (x.id === a.id ? allowance : x)))
      if (einvoice.mode === 'd0401' && einvoice.ok) toast.success('折讓已確認，發票折讓（D0401）已送出')
      else if (einvoice.mode === 'd0401') toast.error(`折讓已確認，但發票折讓未成功：${einvoice.error || '可稍後由發票查詢頁重試'}`)
      else if (einvoice.mode === 'manual') toast.info('折讓已確認（部分折讓 — D0401 請至加值中心以部分金額開立）')
      else toast.success('折讓已確認，傳票與憑證檔已產生')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const handleCancel = async (a) => {
    const ok = await confirm({
      title: `取消草稿 ${a.allowance_number}？`,
      message: '取消後此折讓單將作廢，不會產生任何傳票或憑證。',
      confirmLabel: '取消草稿', cancelLabel: '返回', danger: true,
    })
    if (!ok) return
    const { data, error: err } = await cancelSalesAllowanceDraft(a.id)
    if (err) { toast.error(`取消失敗：${err.message}`); return }
    setItems((prev) => prev.map((x) => (x.id === a.id ? data : x)))
    toast.success('已取消草稿')
  }

  if (loading) return <LoadingSpinner />
  if (error) {
    return (
      <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
        <h3>{error}</h3>
        <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
      </div>
    )
  }

  const filtered = items.filter((a) =>
    (statusFilter === '' || a.status === statusFilter) &&
    (search === '' || a.allowance_number?.includes(search) || a.customer_name?.includes(search) || a.invoice_number?.includes(search))
  )
  const draftCount = items.filter((a) => a.status === 'draft').length
  const now = new Date()
  const monthTotal = items
    .filter((a) => {
      if (a.status !== 'confirmed' || !a.confirmed_at) return false
      const d = new Date(a.confirmed_at)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    .reduce((s, a) => s + (Number(a.amount) || 0) + (Number(a.tax_amount) || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧾</span> 銷貨折讓單</h2>
            <p>獨立折讓單據（不動庫存）— 確認時自動拋傳票、寫銷項憑證檔、連動發票開立 D0401</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增折讓</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">草稿</div>
          <div className="stat-card-value">{draftCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已確認</div>
          <div className="stat-card-value">{items.filter((a) => a.status === 'confirmed').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">本月折讓額（含稅）</div>
          <div className="stat-card-value">NT$ {monthTotal.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 折讓單列表</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">全部狀態</option>
              <option value="draft">草稿</option>
              <option value="confirmed">已確認</option>
              <option value="cancelled">已取消</option>
            </select>
            <div className="search-bar">
              <Search className="search-icon" />
              <input type="text" placeholder="搜尋折讓單/客戶/發票…" className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>折讓單號</th><th>原單</th><th>客戶</th><th>連動發票</th><th>未稅金額</th><th>稅額</th><th>原因</th><th>狀態</th><th>建立日</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無折讓單</td></tr>}
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.allowance_number}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {a.original_doc_type === 'sales_order' ? `訂單 ${a.original_doc_id ?? ''}`
                      : a.original_doc_type === 'pos_invoice' ? '發票' : '手動'}
                  </td>
                  <td>{a.customer_name}</td>
                  <td style={{ fontSize: 12 }}>{a.invoice_number || '—'}</td>
                  <td>NT$ {(Number(a.amount) || 0).toLocaleString()}</td>
                  <td>NT$ {(Number(a.tax_amount) || 0).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{a.reason}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[a.status] || 'badge-info'}`}>
                      <span className="badge-dot"></span>{ALLOWANCE_STATUS_LABELS[a.status] || a.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{a.created_at ? new Date(a.created_at).toLocaleDateString('zh-TW') : ''}</td>
                  <td>
                    {a.status === 'draft' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" disabled={busyId === a.id} onClick={() => handleConfirm(a)}>
                          {busyId === a.id ? '處理中…' : '確認'}
                        </button>
                        <button className="btn btn-secondary btn-sm" disabled={busyId === a.id} onClick={() => handleCancel(a)}>取消</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增銷貨折讓" maxWidth="lg" onClose={() => { setShowModal(false); setForm(EMPTY_FORM) }} onSubmit={handleSubmit} submitLabel="建立草稿">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="原單類型" required>
              <select className="form-input" style={{ width: '100%' }} value={form.originalDocType}
                onChange={(e) => setForm({ ...EMPTY_FORM, originalDocType: e.target.value })}>
                <option value="manual">手動（無原單）</option>
                <option value="sales_order">銷貨訂單</option>
                <option value="pos_invoice">POS 發票</option>
              </select>
            </Field>
            {form.originalDocType === 'sales_order' && (
              <Field label="原始訂單" required hint={remaining != null ? `剩餘可折讓 NT$${remaining.toLocaleString()}` : undefined}>
                <select className="form-input" style={{ width: '100%' }} value={form.originalDocId} onChange={(e) => pickOrder(e.target.value)}>
                  <option value="">選擇訂單…</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>{o.order_number} — {o.customer}（NT${(Number(o.total) || 0).toLocaleString()}）</option>
                  ))}
                </select>
              </Field>
            )}
            {form.originalDocType === 'pos_invoice' && (
              <Field label="發票號碼" required hint="輸入後按「帶入」">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="form-input" type="text" style={{ flex: 1 }} placeholder="AB12345678" value={form.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} />
                  <button type="button" className="btn btn-secondary" onClick={pickInvoice}>帶入</button>
                </div>
              </Field>
            )}
            {form.originalDocType === 'manual' && (
              <Field label="連動發票號碼" hint="選填 — 全額折讓將自動開 D0401">
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="AB12345678" value={form.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} />
              </Field>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="客戶" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="客戶名稱" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
            </Field>
            <Field label="折讓原因">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：瑕疵議價、數量短少" value={form.reason} onChange={(e) => set('reason', e.target.value)} />
            </Field>
          </div>

          <Field label="折讓明細" required hint="金額/稅額自動計算（5%）">
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr><th>品名/說明</th><th style={{ width: 80 }}>數量</th><th style={{ width: 110 }}>單價</th><th style={{ width: 100 }}>未稅</th><th style={{ width: 80 }}>稅額</th><th style={{ width: 40 }}></th></tr>
              </thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i}>
                    <td><input className="form-input" type="text" style={{ width: '100%' }} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></td>
                    <td><input className="form-input" type="number" min="0" style={{ width: '100%' }} value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                    <td><input className="form-input" type="number" min="0" style={{ width: '100%' }} value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} /></td>
                    <td style={{ textAlign: 'right' }}>{(totals.lines[i]?.amount ?? 0).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{(totals.lines[i]?.tax ?? 0).toLocaleString()}</td>
                    <td>
                      {form.lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(i)} aria-label="刪除明細行"
                          style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: 2 }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addLine}><Plus size={12} /> 加一行</button>
          </Field>

          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 16, padding: '10px 12px',
            background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>未稅 NT$ {totals.amount.toLocaleString()}</span>
            <span style={{ color: 'var(--text-secondary)' }}>稅額 NT$ {totals.taxAmount.toLocaleString()}</span>
            <span style={{ fontWeight: 700 }}>合計 NT$ {totals.total.toLocaleString()}</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            建立後為草稿；按列表「確認」才會拋轉傳票、寫入銷項憑證檔並（連動發票時）開立折讓證明單。折讓不會異動庫存。
          </p>
        </Modal>
      )}
    </div>
  )
}
