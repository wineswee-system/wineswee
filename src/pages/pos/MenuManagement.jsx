import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, UtensilsCrossed, ChevronDown } from 'lucide-react'
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

export default function MenuManagement() {
  const orgId = useOrgId()
  const [tab, setTab]         = useState('cats')  // 'cats' | 'items'
  const [stores, setStores]   = useState([])
  const [storeId, setStoreId] = useState(null)
  const [cats, setCats]       = useState([])
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(null)  // null | { kind: 'cat'|'item', row: null|{} }
  const [form, setForm]       = useState({})
  const [dragIdx, setDragIdx] = useState(null)

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

  // ── Data loaders ─────────────────────────────────────────────────────────────
  const loadCats = useCallback(async () => {
    if (!storeId) return
    const { data } = await supabase
      .from('pos_menu_categories')
      .select('id, name, display_order, is_active')
      .eq('store_id', storeId)
      .order('display_order')
    setCats(data ?? [])
  }, [storeId])

  const loadItems = useCallback(async () => {
    if (!storeId) return
    const { data } = await supabase
      .from('pos_menu_items')
      .select('id, name, description, unit_price, tax_rate, image_url, is_available, display_order, category_id, pos_menu_categories(name)')
      .eq('store_id', storeId)
      .order('display_order')
    setItems(data ?? [])
  }, [storeId])

  useEffect(() => {
    if (!storeId) return
    setLoading(true)
    const loads = tab === 'items'
      ? Promise.all([loadCats(), loadItems()])
      : loadCats()
    Promise.resolve(loads).finally(() => setLoading(false))
  }, [storeId, tab, loadCats, loadItems])

  // ── Category CRUD ─────────────────────────────────────────────────────────────
  function openAddCat()  { setForm({ name: '', display_order: cats.length, is_active: true }); setModal({ kind: 'cat', row: null }) }
  function openEditCat(r){ setForm({ ...r }); setModal({ kind: 'cat', row: r }) }

  async function saveCat() {
    if (!form.name?.trim()) { toast.error('請填寫分類名稱'); return false }
    const payload = {
      organization_id: orgId, store_id: storeId,
      name: form.name.trim(), display_order: Number(form.display_order ?? 0),
      is_active: form.is_active !== false,
    }
    const { error } = modal.row
      ? await supabase.from('pos_menu_categories').update(payload).eq('id', modal.row.id)
      : await supabase.from('pos_menu_categories').insert(payload)
    if (error) { toast.error('儲存失敗：' + error.message); return false }
    await loadCats()
    toast.success(modal.row ? '已更新分類' : '已新增分類')
  }

  async function deleteCat(id) {
    const { count } = await supabase
      .from('pos_menu_items').select('id', { count: 'exact', head: true }).eq('category_id', id)
    if (count > 0) { toast.error(`尚有 ${count} 個品項使用此分類，請先移除`); return }
    await supabase.from('pos_menu_categories').delete().eq('id', id)
    setCats(c => c.filter(x => x.id !== id))
    toast.success('已刪除分類')
  }

  // ── Category drag-to-reorder ──────────────────────────────────────────────────
  async function handleCatDrop(dropIdx) {
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); return }
    const reordered = [...cats]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(dropIdx, 0, moved)
    const withOrder = reordered.map((c, i) => ({ ...c, display_order: i }))
    setCats(withOrder)
    setDragIdx(null)
    // Persist all updated display_orders
    for (const c of withOrder) {
      await supabase.from('pos_menu_categories').update({ display_order: c.display_order }).eq('id', c.id)
    }
  }

  // ── Item CRUD ─────────────────────────────────────────────────────────────────
  function openAddItem()  {
    setForm({ name: '', unit_price: '', tax_rate: '0.05', display_order: items.length, is_available: true, category_id: '', description: '', image_url: '' })
    setModal({ kind: 'item', row: null })
  }
  function openEditItem(r){
    setForm({ ...r, tax_rate: String(r.tax_rate), unit_price: String(r.unit_price) })
    setModal({ kind: 'item', row: r })
  }

  async function saveItem() {
    if (!form.name?.trim()) { toast.error('請填寫品項名稱'); return false }
    if (!form.unit_price || isNaN(Number(form.unit_price))) { toast.error('請填寫有效售價'); return false }
    const payload = {
      organization_id: orgId, store_id: storeId,
      name: form.name.trim(), description: form.description || null,
      unit_price: Number(form.unit_price), tax_rate: Number(form.tax_rate ?? 0.05),
      image_url: form.image_url || null, is_available: form.is_available !== false,
      category_id: form.category_id || null, display_order: Number(form.display_order ?? 0),
      updated_at: new Date().toISOString(),
    }
    const { error } = modal.row
      ? await supabase.from('pos_menu_items').update(payload).eq('id', modal.row.id)
      : await supabase.from('pos_menu_items').insert(payload)
    if (error) { toast.error('儲存失敗：' + error.message); return false }
    await loadItems()
    toast.success(modal.row ? '已更新品項' : '已新增品項')
  }

  async function deleteItem(id) {
    await supabase.from('pos_menu_items').delete().eq('id', id)
    setItems(i => i.filter(x => x.id !== id))
    toast.success('已刪除品項')
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      <PageHeader
        icon={UtensilsCrossed}
        title="菜單管理"
        description="管理各店家的菜單分類與品項"
        accentColor="var(--accent-cyan)"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <select value={storeId ?? ''} onChange={e => setStoreId(e.target.value)} style={{ ...sel, width: 160, paddingRight: 32 }}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            </div>
            <button className="btn btn-primary" onClick={tab === 'cats' ? openAddCat : openAddItem} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <Plus size={15} />
              {tab === 'cats' ? '新增分類' : '新增品項'}
            </button>
          </div>
        }
      />

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--bg-tertiary)', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 24 }}>
        {[['cats', '分類'], ['items', '品項']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: tab === key ? 'var(--bg-card)' : 'transparent',
            color: tab === key ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            border: 'none', borderRadius: 6, padding: '6px 20px',
            fontSize: 14, fontWeight: tab === key ? 700 : 400, cursor: 'pointer',
            transition: 'all 0.15s',
          }}>
            {label}
          </button>
        ))}
      </div>

      {loading && <LoadingSpinner />}

      {/* Categories table */}
      {!loading && tab === 'cats' && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          {cats.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              尚未設定分類，點擊「新增分類」開始
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['排序', '分類名稱', '狀態', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cats.map((cat, idx) => (
                  <tr
                    key={cat.id}
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleCatDrop(idx)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      opacity: dragIdx === idx ? 0.45 : 1,
                      cursor: 'grab',
                    }}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', width: 60, userSelect: 'none', fontSize: 18 }}>⠿</td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 600 }}>{cat.name}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge color={cat.is_active ? 'green' : 'gray'} size="sm">{cat.is_active ? '啟用' : '停用'}</Badge>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <IconBtn icon={Pencil} onClick={() => openEditCat(cat)} title="編輯" />
                        <IconBtn icon={Trash2} onClick={() => deleteCat(cat.id)} title="刪除" danger />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Items table */}
      {!loading && tab === 'items' && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          {items.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              尚未設定品項，點擊「新增品項」開始
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['排序', '品項名稱', '分類', '售價', '稅率', '狀態', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', width: 60 }}>{item.display_order}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{item.name}</div>
                      {item.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.description}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                      {item.pos_menu_categories?.name ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                      ${Number(item.unit_price).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                      {(Number(item.tax_rate) * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge color={item.is_available ? 'green' : 'gray'} size="sm">{item.is_available ? '供應中' : '已下架'}</Badge>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <IconBtn icon={Pencil} onClick={() => openEditItem(item)} title="編輯" />
                        <IconBtn icon={Trash2} onClick={() => deleteItem(item.id)} title="刪除" danger />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Category modal */}
      {modal?.kind === 'cat' && (
        <Modal
          title={modal.row ? '編輯分類' : '新增分類'}
          onClose={() => setModal(null)}
          onSubmit={saveCat}
          submitLabel="儲存"
          maxWidth="sm"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px' }}>
            <Field label="分類名稱" required>
              <input style={inp} value={form.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="例：主食、飲料、甜點" autoFocus />
            </Field>
            <Field label="顯示排序" hint="數字越小越前面">
              <input style={inp} type="number" value={form.display_order ?? 0} onChange={e => set('display_order', e.target.value)} min={0} />
            </Field>
            <Field label="狀態">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14 }}>
                <input type="checkbox" checked={form.is_active !== false} onChange={e => set('is_active', e.target.checked)} />
                啟用此分類
              </label>
            </Field>
          </div>
        </Modal>
      )}

      {/* Item modal */}
      {modal?.kind === 'item' && (
        <Modal
          title={modal.row ? '編輯品項' : '新增品項'}
          onClose={() => setModal(null)}
          onSubmit={saveItem}
          submitLabel="儲存"
          maxWidth="md"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="品項名稱" required>
                <input style={inp} value={form.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="例：牛肉麵" autoFocus />
              </Field>
              <Field label="所屬分類">
                <div style={{ position: 'relative' }}>
                  <select style={{ ...sel, paddingRight: 32 }} value={form.category_id ?? ''} onChange={e => set('category_id', e.target.value)}>
                    <option value="">— 不分類 —</option>
                    {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                </div>
              </Field>
            </div>
            <Field label="簡短描述" hint="選填">
              <input style={inp} value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="例：手工熬製湯頭，配上嫩滑牛肉" />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <Field label="售價 (NT$)" required>
                <input style={inp} type="number" min={0} step={1} value={form.unit_price ?? ''} onChange={e => set('unit_price', e.target.value)} placeholder="180" />
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
              <Field label="顯示排序">
                <input style={inp} type="number" min={0} value={form.display_order ?? 0} onChange={e => set('display_order', e.target.value)} />
              </Field>
            </div>
            <Field label="圖片網址" hint="選填">
              <input style={inp} value={form.image_url ?? ''} onChange={e => set('image_url', e.target.value)} placeholder="https://..." />
            </Field>
            <Field label="狀態">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14 }}>
                <input type="checkbox" checked={form.is_available !== false} onChange={e => set('is_available', e.target.checked)} />
                供應中（取消勾選 = 暫停供應）
              </label>
            </Field>
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
