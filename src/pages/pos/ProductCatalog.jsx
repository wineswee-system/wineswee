import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, ShoppingBag, ChevronDown, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrgId } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import Modal, { Field } from '../../components/Modal'
import LoadingSpinner from '../../components/LoadingSpinner'

const inp = {
  width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-medium)',
  borderRadius: 8, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 14, outline: 'none',
}
const sel = { ...inp, cursor: 'pointer', appearance: 'none' }

export default function ProductCatalog() {
  const orgId = useOrgId()
  const [stores, setStores]     = useState([])
  const [storeId, setStoreId]   = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)  // null | { row: null|{} }
  const [form, setForm]         = useState({})
  const [skuInfo, setSkuInfo]   = useState(null)  // { name, stock_qty } after sku_id resolved

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── Stores ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return
    supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name')
      .then(({ data }) => {
        setStores(data ?? [])
        if (data?.length) setStoreId(id => id ?? data[0].id)
      })
  }, [orgId])

  // ── Products ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    const { data } = await supabase
      .from('pos_products')
      .select('id, name, barcode, retail_price, tax_rate, category, image_url, is_available, sku_id, skus(name, stock_qty)')
      .eq('store_id', storeId)
      .order('name')
    setProducts(data ?? [])
    setLoading(false)
  }, [storeId])

  useEffect(() => { load() }, [load])

  // ── Live SKU lookup when sku_id changes in modal form ────────────────────────
  useEffect(() => {
    const id = Number(form.sku_id)
    if (!id || isNaN(id)) { setSkuInfo(null); return }
    supabase.from('skus').select('name, stock_qty').eq('id', id).maybeSingle()
      .then(({ data }) => setSkuInfo(data))
  }, [form.sku_id])

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  function openAdd() {
    setForm({ name: '', barcode: '', retail_price: '', tax_rate: '0.05', category: '', image_url: '', is_available: true, sku_id: '' })
    setSkuInfo(null)
    setModal({ row: null })
  }

  function openEdit(r) {
    setForm({ ...r, retail_price: String(r.retail_price), tax_rate: String(r.tax_rate), sku_id: r.sku_id ? String(r.sku_id) : '' })
    setSkuInfo(r.skus ?? null)
    setModal({ row: r })
  }

  async function save() {
    if (!form.name?.trim()) { toast.error('請填寫商品名稱'); return false }
    if (!form.retail_price || isNaN(Number(form.retail_price))) { toast.error('請填寫有效零售價'); return false }
    const skuId = form.sku_id ? Number(form.sku_id) : null
    if (form.sku_id && isNaN(skuId)) { toast.error('SKU ID 必須是數字'); return false }
    const payload = {
      organization_id: orgId, store_id: storeId,
      name: form.name.trim(), barcode: form.barcode || null,
      retail_price: Number(form.retail_price), tax_rate: Number(form.tax_rate ?? 0.05),
      category: form.category || null, image_url: form.image_url || null,
      is_available: form.is_available !== false, sku_id: skuId,
      updated_at: new Date().toISOString(),
    }
    const { error } = modal.row
      ? await supabase.from('pos_products').update(payload).eq('id', modal.row.id)
      : await supabase.from('pos_products').insert(payload)
    if (error) { toast.error('儲存失敗：' + error.message); return false }
    await load()
    toast.success(modal.row ? '已更新商品' : '已新增商品')
  }

  async function remove(id) {
    await supabase.from('pos_products').delete().eq('id', id)
    setProducts(p => p.filter(x => x.id !== id))
    toast.success('已刪除商品')
  }

  async function toggleAvail(product) {
    const next = !product.is_available
    const { error } = await supabase
      .from('pos_products').update({ is_available: next }).eq('id', product.id)
    if (error) { toast.error('更新失敗'); return }
    setProducts(p => p.map(x => x.id === product.id ? { ...x, is_available: next } : x))
    toast.success(next ? '已上架' : '已下架')
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const outOfStock = products.filter(p => p.skus && p.skus.stock_qty <= 0 && p.is_available)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      <PageHeader
        icon={ShoppingBag}
        title="零售商品目錄"
        description="管理 POS 販售的實體商品，零售價與 WMS 採購成本分開設定"
        accentColor="var(--accent-purple)"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <select value={storeId ?? ''} onChange={e => setStoreId(e.target.value)} style={{ ...sel, width: 160, paddingRight: 32 }}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            </div>
            <button className="btn btn-primary" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <Plus size={15} />
              新增商品
            </button>
          </div>
        }
      />

      {/* Low stock warning */}
      {outOfStock.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
          padding: '10px 16px', borderRadius: 8,
          background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)',
          color: 'var(--accent-orange)', fontSize: 13,
        }}>
          <AlertCircle size={16} />
          {outOfStock.length} 個商品庫存歸零但仍顯示為上架，確認補貨後請手動上架
        </div>
      )}

      {loading && <LoadingSpinner />}

      {!loading && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          {products.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              尚未設定商品，點擊「新增商品」開始
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['商品名稱', '條碼', '分類', '零售價', '稅率', '庫存', '狀態', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const stock = p.skus?.stock_qty
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: p.is_available ? 1 : 0.6 }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{p.name}</div>
                        {p.skus?.name && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>SKU: {p.skus.name}</div>}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 13 }}>
                        {p.barcode ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {p.category ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--accent-purple)', fontWeight: 700 }}>
                        ${Number(p.retail_price).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {(Number(p.tax_rate) * 100).toFixed(0)}%
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {stock !== undefined
                          ? <Badge color={stock <= 0 ? 'red' : stock < 5 ? 'orange' : 'green'} size="sm">{stock} 件</Badge>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未連結</span>
                        }
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => toggleAvail(p)} style={{
                          background: p.is_available ? 'var(--accent-green-dim)' : 'var(--bg-tertiary)',
                          color: p.is_available ? 'var(--accent-green)' : 'var(--text-muted)',
                          border: `1px solid ${p.is_available ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                          borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>
                          {p.is_available ? '上架中' : '已下架'}
                        </button>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <IconBtn icon={Pencil} onClick={() => openEdit(p)} title="編輯" />
                          <IconBtn icon={Trash2} onClick={() => remove(p.id)} title="刪除" danger />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <Modal
          title={modal.row ? '編輯商品' : '新增商品'}
          onClose={() => { setModal(null); setSkuInfo(null) }}
          onSubmit={save}
          submitLabel="儲存"
          maxWidth="md"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="商品名稱" required>
                <input style={inp} value={form.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="例：招牌醬料" autoFocus />
              </Field>
              <Field label="商品分類" hint="自由輸入">
                <input style={inp} value={form.category ?? ''} onChange={e => set('category', e.target.value)} placeholder="例：調味品、紀念品" />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="條碼" hint="掃描槍使用">
                <input style={inp} value={form.barcode ?? ''} onChange={e => set('barcode', e.target.value)} placeholder="1234567890128" />
              </Field>
              <Field label="WMS SKU ID" hint="選填 — 連結庫存">
                <input style={inp} type="number" value={form.sku_id ?? ''} onChange={e => set('sku_id', e.target.value)} placeholder="在 WMS 查詢 SKU ID" />
                {skuInfo && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--accent-green)' }}>
                    ✓ {skuInfo.name}（庫存：{skuInfo.stock_qty}）
                  </div>
                )}
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <Field label="零售價 (NT$)" required>
                <input style={inp} type="number" min={0} step={1} value={form.retail_price ?? ''} onChange={e => set('retail_price', e.target.value)} placeholder="250" />
              </Field>
              <Field label="稅率">
                <div style={{ position: 'relative' }}>
                  <select style={{ ...sel, paddingRight: 32 }} value={form.tax_rate ?? '0.05'} onChange={e => set('tax_rate', e.target.value)}>
                    <option value="0.05">5%（含稅）</option>
                    <option value="0">0%（免稅）</option>
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                </div>
              </Field>
              <div style={{ paddingTop: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14 }}>
                  <input type="checkbox" checked={form.is_available !== false} onChange={e => set('is_available', e.target.checked)} />
                  上架中
                </label>
              </div>
            </div>
            <Field label="圖片網址" hint="選填">
              <input style={inp} value={form.image_url ?? ''} onChange={e => set('image_url', e.target.value)} placeholder="https://..." />
            </Field>
            <div style={{ padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              零售價（retail_price）與 WMS 採購成本（unit_cost）完全獨立。連結 SKU ID 後，庫存歸零時系統自動下架此商品。
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function IconBtn({ icon: Icon, onClick, title, danger }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'transparent', border: '1px solid var(--border-medium)',
      borderRadius: 6, color: danger ? 'var(--accent-red)' : 'var(--text-secondary)',
      width: 30, height: 30, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={14} />
    </button>
  )
}
