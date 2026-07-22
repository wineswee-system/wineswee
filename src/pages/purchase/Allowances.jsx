import { useState, useEffect, useMemo } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { getPurchaseOrders } from '../../lib/db'
import { getPurchaseAllowances, cancelPurchaseAllowanceDraft } from '../../lib/db/allowances'
import {
  createPurchaseAllowance, confirmPurchaseAllowance,
  computeAllowanceTotals, remainingAllowable, ALLOWANCE_STATUS_LABELS,
} from '../../lib/allowances'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useOrgId } from '../../contexts/AuthContext'
import { confirm } from '../../lib/confirm'
import { toast } from '../../lib/toast'

// F-C3.2 進貨折讓單：獨立單據（非退貨、不動庫存）。
// 確認時：傳票（借 2100／貸 1150+1170）+ 進項折讓憑證（格式 25、負額、扣抵別透傳）。
const STATUS_BADGE = { draft: 'badge-info', confirmed: 'badge-success', cancelled: 'badge-danger' }
const EMPTY_LINE = { description: '', quantity: 1, unit_price: 0 }
const EMPTY_FORM = {
  originalDocType: 'manual', originalDocId: '', supplierName: '', supplierUbn: '',
  invoiceNumber: '', deductionCode: '可扣抵', reason: '', lines: [{ ...EMPTY_LINE }],
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
    Promise.all([getPurchaseAllowances(orgId), getPurchaseOrders(orgId)])
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

  // AL-03 鏡像：連動採購單時顯示剩餘可折讓額（原單含稅含運 − 已確認折讓累計）
  const selectedOrder = useMemo(
    () => (form.originalDocType === 'purchase_order'
      ? orders.find((o) => String(o.id) === String(form.originalDocId)) : null),
    [orders, form.originalDocType, form.originalDocId]
  )
  const orderTotal = (o) =>
    (Number(o?.total_amount) || 0) + (Number(o?.tax) || 0) + (Number(o?.shipping) || 0)
  const remaining = useMemo(() => {
    if (!selectedOrder) return null
    const confirmed = items.filter((a) =>
      a.original_doc_type === 'purchase_order' &&
      String(a.original_doc_id) === String(selectedOrder.id) &&
      a.status === 'confirmed')
    return remainingAllowable(orderTotal(selectedOrder), confirmed)
  }, [selectedOrder, items])

  // 選採購單 → 帶入供應商 + 明細行
  const pickOrder = (orderId) => {
    const o = orders.find((x) => String(x.id) === String(orderId))
    if (!o) { set('originalDocId', orderId); return }
    const lines = (Array.isArray(o.items) ? o.items : []).map((it) => ({
      description: it.name ?? it.description ?? '',
      quantity: Number(it.qty ?? it.quantity) || 1,
      unit_price: Number(it.price ?? it.unit_price) || 0,
    }))
    setForm((f) => ({
      ...f, originalDocId: String(orderId), supplierName: o.supplier || '',
      lines: lines.length ? lines : [{ ...EMPTY_LINE }],
    }))
  }

  const handleSubmit = async () => {
    if (!(totals.total > 0)) { toast.error('折讓金額必須大於 0'); return false }
    if (remaining != null && totals.total > remaining) {
      toast.error(`折讓總額 NT$${totals.total.toLocaleString()} 超過原採購單剩餘可折讓額 NT$${remaining.toLocaleString()}`)
      return false
    }
    try {
      const row = await createPurchaseAllowance({
        orgId,
        originalDocType: form.originalDocType,
        originalDocId: form.originalDocId || null,
        supplierName: form.supplierName,
        supplierUbn: form.supplierUbn || null,
        invoiceNumber: form.invoiceNumber || null,
        deductionCode: form.deductionCode,
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

  // 確認：說明將發生的事（傳票 + 進項憑證檔）
  const handleConfirm = async (a) => {
    const ok = await confirm({
      title: `確認折讓單 ${a.allowance_number}？`,
      message: `確認後將自動執行：\n・拋轉折讓傳票（借 應付帳款、貸 存貨/進項稅額）\n・寫入進項折讓憑證檔（401 申報，格式 25、${a.deduction_code}）\n\n折讓總額 NT$${((Number(a.amount) || 0) + (Number(a.tax_amount) || 0)).toLocaleString()}。確認後不可取消。`,
      confirmLabel: '確認折讓',
      cancelLabel: '再想想',
    })
    if (!ok) return
    setBusyId(a.id)
    try {
      const row = await confirmPurchaseAllowance(a.id)
      setItems((prev) => prev.map((x) => (x.id === a.id ? row : x)))
      toast.success('折讓已確認，傳票與進項憑證檔已產生')
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
    const { data, error: err } = await cancelPurchaseAllowanceDraft(a.id)
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
    (search === '' || a.allowance_number?.includes(search) || a.supplier_name?.includes(search) || a.invoice_number?.includes(search))
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
            <h2><span className="header-icon">🧾</span> 進貨折讓單</h2>
            <p>獨立折讓單據（不動庫存）— 確認時自動拋傳票、寫進項折讓憑證檔（依扣抵別）</p>
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
              <input type="text" placeholder="搜尋折讓單/供應商/憑證…" className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>折讓單號</th><th>原單</th><th>供應商</th><th>憑證號碼</th><th>未稅金額</th><th>稅額</th><th>扣抵別</th><th>狀態</th><th>建立日</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無折讓單</td></tr>}
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.allowance_number}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {a.original_doc_type === 'purchase_order' ? `採購單 ${a.original_doc_id ?? ''}`
                      : a.original_doc_type === 'goods_receipt' ? `驗收單 ${a.original_doc_id ?? ''}` : '手動'}
                  </td>
                  <td>{a.supplier_name}</td>
                  <td style={{ fontSize: 12 }}>{a.invoice_number || '—'}</td>
                  <td>NT$ {(Number(a.amount) || 0).toLocaleString()}</td>
                  <td>NT$ {(Number(a.tax_amount) || 0).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{a.deduction_code}</td>
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
        <Modal title="新增進貨折讓" maxWidth="lg" onClose={() => { setShowModal(false); setForm(EMPTY_FORM) }} onSubmit={handleSubmit} submitLabel="建立草稿">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="原單類型" required>
              <select className="form-input" style={{ width: '100%' }} value={form.originalDocType}
                onChange={(e) => setForm({ ...EMPTY_FORM, originalDocType: e.target.value })}>
                <option value="manual">手動（無原單）</option>
                <option value="purchase_order">採購單</option>
                <option value="goods_receipt">進貨驗收單</option>
              </select>
            </Field>
            {form.originalDocType === 'purchase_order' && (
              <Field label="原始採購單" required hint={remaining != null ? `剩餘可折讓 NT$${remaining.toLocaleString()}` : undefined}>
                <select className="form-input" style={{ width: '100%' }} value={form.originalDocId} onChange={(e) => pickOrder(e.target.value)}>
                  <option value="">選擇採購單…</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>{o.po_number} — {o.supplier}（NT${orderTotal(o).toLocaleString()}）</option>
                  ))}
                </select>
              </Field>
            )}
            {form.originalDocType === 'goods_receipt' && (
              <Field label="驗收單編號">
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="GR-202607-0001" value={form.originalDocId} onChange={(e) => set('originalDocId', e.target.value)} />
              </Field>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="供應商" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="供應商名稱" value={form.supplierName} onChange={(e) => set('supplierName', e.target.value)} />
            </Field>
            <Field label="供應商統編" hint="進項憑證用">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="8 碼統編" value={form.supplierUbn} onChange={(e) => set('supplierUbn', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="折讓證明單/原發票號碼" hint="選填">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="AB12345678" value={form.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} />
            </Field>
            <Field label="扣抵別" required>
              <select className="form-input" style={{ width: '100%' }} value={form.deductionCode} onChange={(e) => set('deductionCode', e.target.value)}>
                <option value="可扣抵">可扣抵</option>
                <option value="不可扣抵">不可扣抵</option>
              </select>
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
            建立後為草稿；按列表「確認」才會拋轉傳票並寫入進項折讓憑證檔。折讓不會異動庫存。
          </p>
        </Modal>
      )}
    </div>
  )
}
