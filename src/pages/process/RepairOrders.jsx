import { useState, useEffect, useMemo } from 'react'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import { Plus, Search, Wrench, User, Building2, Paperclip, X as XIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import ExpenseFormDraft from '../workflow/components/ExpenseFormDraft'
import { commitExpenseDraft } from '../../lib/commitBindingDraft'
import { uploadFormAttachments, listFormAttachments, getAttachmentSignedUrl } from '../../lib/formAttachments'

// 完工/一般附件放寬吃常見文件+圖片
const ATTACH_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt'
const FORM_TYPE = 'repair_order'

const STATUS = {
  草稿:       { color: 'var(--text-muted)',    dim: 'var(--bg-secondary)' },
  進行中:     { color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  待費用核准: { color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  已完工:     { color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  已取消:     { color: 'var(--text-muted)',    dim: 'var(--bg-secondary)' },
}
const EXPENSE_STATUS_COLOR = {
  申請中: 'var(--accent-orange)', 已核准: 'var(--accent-green)', 待核銷: 'var(--accent-cyan)',
  已核銷: 'var(--accent-green)', 已駁回: 'var(--accent-red)', 核銷已退回: 'var(--accent-red)',
}

export default function RepairOrders() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id ?? getTenantOrgId()

  const [me, setMe] = useState(null)
  const [orders, setOrders] = useState([])
  const [expensesByRO, setExpensesByRO] = useState({})   // repair_order_id -> [expense]
  const [stores, setStores] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [vendors, setVendors] = useState([])           // 維修廠商庫
  const [categories, setCategories] = useState([])     // 維修類別
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('open')       // open | done | all
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')       // 類別篩選(category_id)
  const [showCreate, setShowCreate] = useState(false)
  const [showManage, setShowManage] = useState(false)  // 管理廠商/類別
  const [detail, setDetail] = useState(null)   // 目前開的維修單
  const [editDraft, setEditDraft] = useState(null)  // 正在編輯的草稿

  const load = async () => {
    setLoading(true)
    const { data: emp } = profile?.id
      ? await supabase.from('employees').select('id, name, department_id').eq('id', profile.id).maybeSingle()
      : { data: null }
    setMe(emp || { id: profile?.id, name: profile?.name, department_id: profile?.department_id })
    let q = supabase.from('repair_orders').select('*').is('deleted_at', null).order('created_at', { ascending: false })
    if (orgId) q = q.eq('organization_id', orgId)
    // 草稿只有申請人本人看得到(非草稿 or 自己的草稿)
    if (emp?.id) q = q.or(`status.neq.草稿,requester_id.eq.${emp.id}`)
    let vq = supabase.from('repair_vendors').select('id, name, category_id, contact_person, phone, note, status').order('name')
    let cq = supabase.from('repair_categories').select('id, name, sort_order').order('sort_order').order('id')
    if (orgId) { vq = vq.eq('organization_id', orgId); cq = cq.eq('organization_id', orgId) }
    const [{ data: ros }, { data: st }, { data: wos }, { data: vs }, { data: cs }] = await Promise.all([
      q,
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('work_orders').select('id, title, status').is('deleted_at', null).in('status', ['待受理', '處理中']).order('created_at', { ascending: false }),
      vq,
      cq,
    ])
    const list = ros || []
    setOrders(list)
    setStores(st || [])
    setWorkOrders(wos || [])
    setVendors(vs || [])
    setCategories(cs || [])
    // 連結費用單
    const ids = list.map(r => r.id)
    if (ids.length) {
      const { data: exps } = await supabase.from('expense_requests')
        .select('id, title, status, estimated_amount, repair_order_id').in('repair_order_id', ids).is('deleted_at', null)
      const map = {}
      ;(exps || []).forEach(e => { (map[e.repair_order_id] = map[e.repair_order_id] || []).push(e) })
      setExpensesByRO(map)
    } else setExpensesByRO({})
    setLoading(false)
  }
  useEffect(() => { if (profile) load() }, [profile?.id, orgId])

  // detail 開著時同步最新資料
  const detailRow = useMemo(() => (detail ? orders.find(o => o.id === detail.id) || detail : null), [detail, orders])

  const draftCount = useMemo(() => orders.filter(o => o.status === '草稿').length, [orders])
  const filtered = useMemo(() => orders.filter(o => {
    if (o.status === '草稿' && tab !== 'draft') return false   // 草稿只在「草稿」分頁出現
    if (tab === 'draft' && o.status !== '草稿') return false
    if (tab === 'open' && !['進行中', '待費用核准'].includes(o.status)) return false
    if (tab === 'done' && o.status !== '已完工') return false
    if (catFilter && o.category_id !== Number(catFilter)) return false
    if (search) {
      const s = search.toLowerCase()
      if (!(`${o.title || ''} ${o.description || ''} ${o.location || ''} ${o.supplier || ''}`.toLowerCase().includes(s))) return false
    }
    return true
  }), [orders, tab, search, catFilter])

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
          <Wrench size={20} /> 維修單
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowManage(true)}>
            <Building2 size={16} /> 管理廠商/類別
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> 開維修單
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {[{ k: 'open', l: '進行中' }, { k: 'done', l: '已完工' }, { k: 'all', l: '全部' }, { k: 'draft', l: draftCount ? `草稿 ${draftCount}` : '草稿' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${tab === t.k ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
            background: tab === t.k ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.k ? '#fff' : 'var(--text-secondary)',
          }}>{t.l}</button>
        ))}
        <select className="form-input" value={catFilter} onChange={e => setCatFilter(e.target.value)}
          style={{ width: 'auto', minWidth: 120 }}>
          <option value="">全部類別</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 180, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" placeholder="搜尋標題/地點/廠商…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 30 }} />
        </div>
      </div>

      {loading ? <LoadingSpinner /> : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>沒有維修單</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(o => {
            const stc = STATUS[o.status] || STATUS['進行中']
            const catName = categories.find(c => c.id === o.category_id)?.name
            return (
              <div key={o.id} onClick={() => o.status === '草稿' ? setEditDraft(o) : setDetail(o)} style={{
                padding: 14, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: stc.dim, color: stc.color }}>{o.status}</span>
                  <span style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
                    {o.handler_type === 'vendor' ? <><Building2 size={12} /> 找廠商</> : <><User size={12} /> 自己處理</>}
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.title || o.description?.slice(0, 30) || `維修單 #${o.id}`}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>#{o.id}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                  {catName && <span style={{ color: 'var(--accent-cyan)' }}>🏷 {catName} · </span>}
                  {o.location && <span>📍 {o.location} · </span>}
                  {o.requester_name} · {new Date(o.created_at).toLocaleDateString('zh-TW')}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(showCreate || editDraft) && (
        <CreateModal orgId={orgId} stores={stores} workOrders={workOrders}
          vendors={vendors} categories={categories} onVendorsChanged={load} editDraft={editDraft}
          onClose={() => { setShowCreate(false); setEditDraft(null) }}
          onDone={() => { setShowCreate(false); setEditDraft(null); load() }} />
      )}
      {showManage && (
        <ManageModal orgId={orgId} vendors={vendors} categories={categories}
          onClose={() => setShowManage(false)} onChanged={load} />
      )}
      {detailRow && (
        <DetailModal ro={detailRow} me={me} profile={profile} stores={stores}
          vendors={vendors} categories={categories}
          expenses={expensesByRO[detailRow.id] || []}
          onClose={() => setDetail(null)} onChanged={load} />
      )}
    </div>
  )
}

// ── 開單 / 編輯草稿 ──
function CreateModal({ orgId, stores, workOrders, vendors, categories, onVendorsChanged, onClose, onDone, editDraft }) {
  const [handlerType, setHandlerType] = useState(editDraft?.handler_type || 'self')
  const [f, setF] = useState({
    occur_time: editDraft?.occur_time ? new Date(editDraft.occur_time).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
    location: editDraft?.location || '', store_id: editDraft?.store_id ? String(editDraft.store_id) : '',
    title: editDraft?.title || '', description: editDraft?.description || '',
    need_purchase: !!editDraft?.need_purchase, supplier: editDraft?.supplier || '',
    quote_amount: editDraft?.quote_amount != null ? String(editDraft.quote_amount) : '',
    linked_work_order_id: editDraft?.linked_work_order_id ? String(editDraft.linked_work_order_id) : '',
    category_id: editDraft?.category_id ? String(editDraft.category_id) : '',
    repair_vendor_id: editDraft?.repair_vendor_id ? String(editDraft.repair_vendor_id) : '',
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const [addingVendor, setAddingVendor] = useState(false)
  const [newVendor, setNewVendor] = useState({ name: '', category_id: '', phone: '' })

  const saveNewVendor = async () => {
    if (!newVendor.name.trim()) { toast.error('請填廠商名稱'); return }
    const { data, error } = await supabase.from('repair_vendors')
      .insert({ name: newVendor.name.trim(), category_id: newVendor.category_id ? Number(newVendor.category_id) : null, phone: newVendor.phone || null, organization_id: orgId || null })
      .select().single()
    if (error || !data) { toast.error('新增廠商失敗：' + (error?.message || '')); return }
    toast.success('已新增廠商')
    set('repair_vendor_id', String(data.id))
    setAddingVendor(false); setNewVendor({ name: '', category_id: '', phone: '' })
    onVendorsChanged?.()
  }

  // 共用欄位 payload
  const payload = () => ({
    p_handler_type: handlerType,
    p_occur_time: f.occur_time ? new Date(f.occur_time).toISOString() : null,
    p_location: f.location || null,
    p_store_id: f.store_id ? Number(f.store_id) : null,
    p_title: f.title || null,
    p_description: f.description,
    p_need_purchase: handlerType === 'self' ? !!f.need_purchase : true, // 廠商一定要走報價/費用
    p_supplier: handlerType === 'vendor' ? (f.supplier || null) : null,
    p_quote_amount: handlerType === 'vendor' && f.quote_amount ? Number(f.quote_amount) : null,
    p_linked_work_order_id: f.linked_work_order_id ? Number(f.linked_work_order_id) : null,
    p_category_id: f.category_id ? Number(f.category_id) : null,
    p_repair_vendor_id: handlerType === 'vendor' && f.repair_vendor_id ? Number(f.repair_vendor_id) : null,
  })

  // 正式送出 / 建立(描述必填)
  const submit = async () => {
    if (!f.description.trim()) { toast.error('請填「怎麼處理 / 問題描述」'); return }
    const { data, error } = editDraft
      ? await supabase.rpc('update_repair_order_draft', { p_id: editDraft.id, ...payload(), p_submit: true })
      : await supabase.rpc('create_repair_order', { ...payload(), p_is_draft: false })
    if (error || !data?.ok) { toast.error((editDraft ? '送出' : '開單') + '失敗：' + (data?.error || error?.message || '')); return }
    toast.success(editDraft ? '維修單已送出' : '維修單已建立')
    onDone()
  }

  // 存草稿(描述可留白,純暫存)
  const saveDraft = async () => {
    const { data, error } = editDraft
      ? await supabase.rpc('update_repair_order_draft', { p_id: editDraft.id, ...payload(), p_submit: false })
      : await supabase.rpc('create_repair_order', { ...payload(), p_is_draft: true })
    if (error || !data?.ok) { toast.error('存草稿失敗：' + (data?.error || error?.message || '')); return }
    toast.success('已存草稿')
    onDone()
  }

  return (
    <Modal title={editDraft ? '📝 編輯草稿' : '🔧 開維修單'} onClose={onClose} onSubmit={submit} submitLabel={editDraft ? '送出' : '建立維修單'}>
      <Field label="處理方式" required>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ v: 'self', l: '自己處理', icon: <User size={14} /> }, { v: 'vendor', l: '找廠商', icon: <Building2 size={14} /> }].map(h => (
            <button key={h.v} type="button" onClick={() => setHandlerType(h.v)} style={{
              flex: 1, padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              border: `1.5px solid ${handlerType === h.v ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
              background: handlerType === h.v ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
              color: handlerType === h.v ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            }}>{h.icon}{h.l}</button>
          ))}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="時間"><input className="form-input" type="datetime-local" value={f.occur_time} onChange={e => set('occur_time', e.target.value)} style={{ width: '100%' }} /></Field>
        <Field label="門市（可選）">
          <select className="form-input" value={f.store_id} onChange={e => set('store_id', e.target.value)} style={{ width: '100%' }}>
            <option value="">— 不綁門市 —</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="地點"><input className="form-input" placeholder="例:一樓廁所、後場冰箱" value={f.location} onChange={e => set('location', e.target.value)} style={{ width: '100%' }} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="標題（可選）"><input className="form-input" value={f.title} onChange={e => set('title', e.target.value)} style={{ width: '100%' }} /></Field>
        <Field label="類別">
          <select className="form-input" value={f.category_id} onChange={e => set('category_id', e.target.value)} style={{ width: '100%' }}>
            <option value="">— 未分類 —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="怎麼處理 / 問題描述" required><textarea className="form-input" rows={3} value={f.description} onChange={e => set('description', e.target.value)} style={{ width: '100%' }} /></Field>

      {handlerType === 'self' && (
        <Field label="需要買東西嗎？">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={f.need_purchase} onChange={e => set('need_purchase', e.target.checked)} />
            需要採購（建立後可在單內「去申請費用」串非經常性費用申請）
          </label>
        </Field>
      )}
      {handlerType === 'vendor' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="廠商">
              {!addingVendor ? (
                <select className="form-input" value={f.repair_vendor_id}
                  onChange={e => e.target.value === '__add__' ? setAddingVendor(true) : set('repair_vendor_id', e.target.value)}
                  style={{ width: '100%' }}>
                  <option value="">— 選擇廠商 —</option>
                  {vendors.filter(v => v.status !== '停用').map(v => {
                    const vc = categories.find(c => c.id === v.category_id)?.name
                    return <option key={v.id} value={v.id}>{v.name}{vc ? `（${vc}）` : ''}</option>
                  })}
                  <option value="__add__">＋ 新增廠商…</option>
                </select>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                  <input className="form-input" placeholder="廠商名稱 *" value={newVendor.name} onChange={e => setNewVendor(v => ({ ...v, name: e.target.value }))} />
                  <select className="form-input" value={newVendor.category_id} onChange={e => setNewVendor(v => ({ ...v, category_id: e.target.value }))}>
                    <option value="">— 類別 —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input className="form-input" placeholder="電話" value={newVendor.phone} onChange={e => setNewVendor(v => ({ ...v, phone: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-primary" style={{ flex: 1, fontSize: 12 }} onClick={saveNewVendor}>儲存廠商</button>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAddingVendor(false)}>取消</button>
                  </div>
                </div>
              )}
            </Field>
            <Field label="報價金額"><input className="form-input" type="number" value={f.quote_amount} onChange={e => set('quote_amount', e.target.value)} style={{ width: '100%' }} /></Field>
          </div>
        </>
      )}
      {workOrders.length > 0 && (
        <Field label="關聯跨部門工單（可選）">
          <select className="form-input" value={f.linked_work_order_id} onChange={e => set('linked_work_order_id', e.target.value)} style={{ width: '100%' }}>
            <option value="">— 不關聯 —</option>
            {workOrders.map(w => <option key={w.id} value={w.id}>#{w.id} {w.title}（{w.status}）</option>)}
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>僅在維修單這邊記錄關聯,不會改動那張工單（工單仍由工單系統各自受理/完成）。</div>
        </Field>
      )}
      {handlerType === 'vendor' && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>找廠商:建立後在單內「去申請費用」送報價 → 費用核准後才能回報完工。</div>
      )}
      {/* 存草稿:純暫存,描述可留白,只有你自己看得到 */}
      <button type="button" className="btn btn-secondary" onClick={saveDraft}
        style={{ width: '100%', marginTop: 12 }}>
        💾 存草稿（先存不送，只有你看得到）
      </button>
    </Modal>
  )
}

// ── 管理廠商 / 類別 ──
function ManageModal({ orgId, vendors, categories, onClose, onChanged }) {
  const [seg, setSeg] = useState('vendor')   // vendor | category
  const [vForm, setVForm] = useState({ name: '', category_id: '', contact_person: '', phone: '', note: '' })
  const [cName, setCName] = useState('')
  const [busy, setBusy] = useState(false)
  const catName = (id) => categories.find(c => c.id === id)?.name

  const addVendor = async () => {
    if (!vForm.name.trim()) { toast.error('請填廠商名稱'); return }
    setBusy(true)
    const { error } = await supabase.from('repair_vendors').insert({
      name: vForm.name.trim(), category_id: vForm.category_id ? Number(vForm.category_id) : null, contact_person: vForm.contact_person || null,
      phone: vForm.phone || null, note: vForm.note || null, organization_id: orgId || null,
    })
    setBusy(false)
    if (error) { toast.error('新增失敗：' + error.message); return }
    setVForm({ name: '', category_id: '', contact_person: '', phone: '', note: '' })
    onChanged?.()
  }
  const toggleVendor = async (v) => {
    const next = v.status === '停用' ? '啟用' : '停用'
    const { error } = await supabase.from('repair_vendors').update({ status: next }).eq('id', v.id)
    if (error) { toast.error('更新失敗：' + error.message); return }
    onChanged?.()
  }
  const addCategory = async () => {
    if (!cName.trim()) { toast.error('請填類別名稱'); return }
    setBusy(true)
    const maxSort = Math.max(0, ...categories.map(c => c.sort_order || 0))
    const { error } = await supabase.from('repair_categories').insert({ name: cName.trim(), sort_order: maxSort + 1, organization_id: orgId || null })
    setBusy(false)
    if (error) { toast.error('新增失敗：' + error.message); return }
    setCName('')
    onChanged?.()
  }
  const delCategory = async (c) => {
    if (!await confirm({ message: `刪除類別「${c.name}」？（已使用此類別的維修單會變成未分類）` })) return
    const { error } = await supabase.from('repair_categories').delete().eq('id', c.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    onChanged?.()
  }

  const segBtn = (k, l) => (
    <button type="button" onClick={() => setSeg(k)} style={{
      flex: 1, padding: 8, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${seg === k ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
      background: seg === k ? 'var(--accent-cyan)' : 'var(--bg-card)',
      color: seg === k ? '#fff' : 'var(--text-secondary)',
    }}>{l}</button>
  )

  return (
    <Modal title="管理廠商 / 類別" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {segBtn('vendor', `維修廠商（${vendors.length}）`)}
        {segBtn('category', `類別（${categories.length}）`)}
      </div>

      {seg === 'vendor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="form-input" placeholder="廠商名稱 *" value={vForm.name} onChange={e => setVForm(v => ({ ...v, name: e.target.value }))} />
            <select className="form-input" value={vForm.category_id} onChange={e => setVForm(v => ({ ...v, category_id: e.target.value }))}>
              <option value="">— 類別 —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="form-input" placeholder="聯絡人" value={vForm.contact_person} onChange={e => setVForm(v => ({ ...v, contact_person: e.target.value }))} />
            <input className="form-input" placeholder="電話" value={vForm.phone} onChange={e => setVForm(v => ({ ...v, phone: e.target.value }))} />
          </div>
          <input className="form-input" placeholder="備註" value={vForm.note} onChange={e => setVForm(v => ({ ...v, note: e.target.value }))} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={addVendor}><Plus size={14} /> 新增廠商</button>
          <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 4, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {vendors.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 12 }}>還沒有廠商</div>}
            {vendors.map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--bg-card)', opacity: v.status === '停用' ? 0.5 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{v.name}{catName(v.category_id) ? <span style={{ color: 'var(--accent-cyan)', fontWeight: 400 }}>　{catName(v.category_id)}</span> : ''}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[v.contact_person, v.phone].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => toggleVendor(v)}>{v.status === '停用' ? '啟用' : '停用'}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {seg === 'category' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" placeholder="新類別名稱" value={cName} onChange={e => setCName(e.target.value)} style={{ flex: 1 }}
              onKeyDown={e => e.key === 'Enter' && addCategory()} />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={addCategory}><Plus size={14} /> 新增</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {categories.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>還沒有類別</div>}
            {categories.map(c => (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 13 }}>
                {c.name}
                <button type="button" onClick={() => delCategory(c)} style={{ display: 'inline-flex', border: 'none', background: 'transparent', color: 'var(--accent-cyan)', cursor: 'pointer', padding: 0 }} aria-label="刪除"><XIcon size={13} /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── 詳情 + 動作 ──
function DetailModal({ ro, me, profile, stores, vendors, categories, expenses, onClose, onChanged }) {
  const storeName = (stores || []).find(s => s.id === ro.store_id)?.name || null
  const catName = (categories || []).find(c => c.id === ro.category_id)?.name || null
  const vendor = (vendors || []).find(v => v.id === ro.repair_vendor_id) || null
  const [showExpense, setShowExpense] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [atts, setAtts] = useState([])
  const stc = STATUS[ro.status] || STATUS['進行中']
  const hasPendingExpense = expenses.some(e => e.status === '申請中')
  const needsExpense = ro.handler_type === 'vendor' || ro.need_purchase
  const canComplete = ro.status !== '已完工' && ro.status !== '已取消' && !hasPendingExpense

  useEffect(() => { listFormAttachments(FORM_TYPE, ro.id).then(setAtts).catch(() => setAtts([])) }, [ro.id])

  const openAttachment = async (a) => {
    const url = await getAttachmentSignedUrl({ bucket: a.storage_bucket || 'attachments', path: a.storage_path })
    if (url) window.open(url, '_blank')
  }

  const captureExpense = async (draft) => {
    try {
      await commitExpenseDraft(null, draft, profile, { repairOrderId: ro.id })
      toast.success('費用申請已送出並綁定此維修單')
      setShowExpense(false); onChanged()
    } catch (err) { toast.error('送出失敗：' + (err.message || '')) }
  }

  const cancel = async () => {
    if (!await confirm({ message: '確定作廢這張維修單？（保留紀錄，標記為已取消）' })) return
    const { data, error } = await supabase.rpc('cancel_repair_order', { p_id: ro.id })
    if (error || !data?.ok) { toast.error('作廢失敗：' + (data?.error || error?.message || '')); return }
    toast.success('已作廢'); onClose(); onChanged()
  }

  const remove = async () => {
    if (!await confirm({ message: `確定刪除維修單 #${ro.id}？會從清單移除（可由後台救回）。`, confirmLabel: '刪除', danger: true })) return
    const { data, error } = await supabase.rpc('delete_repair_order', { p_id: ro.id })
    if (error || !data?.ok) { toast.error('刪除失敗：' + (data?.error || error?.message || '')); return }
    toast.success('已刪除'); onClose(); onChanged()
  }

  return (
    <>
      <Modal title={`🔧 維修單 #${ro.id}`} onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: stc.dim, color: stc.color }}>{ro.status}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ro.handler_type === 'vendor' ? '找廠商' : '自己處理'}</span>
        </div>
        <DetailRow label="標題" value={ro.title || '—'} />
        <DetailRow label="時間" value={ro.occur_time ? new Date(ro.occur_time).toLocaleString('zh-TW') : '—'} />
        <DetailRow label="門市" value={storeName || '—'} />
        <DetailRow label="類別" value={catName || '—'} />
        <DetailRow label="地點" value={ro.location || '—'} />
        <DetailRow label="怎麼處理 / 描述" value={ro.description} />
        {ro.handler_type === 'vendor' && (
          <DetailRow label="廠商 / 報價" value={
            `${vendor?.name || ro.supplier || '—'}`
            + `${vendor?.phone ? `　☎ ${vendor.phone}` : ''}`
            + `${ro.quote_amount != null ? ` / $${ro.quote_amount}` : ''}`
          } />
        )}
        {ro.handler_type === 'self' && <DetailRow label="需要採購" value={ro.need_purchase ? '是' : '否'} />}
        {ro.completed_at && <DetailRow label="完工時間" value={new Date(ro.completed_at).toLocaleString('zh-TW')} />}
        {ro.completion_note && <DetailRow label="完工備註" value={ro.completion_note} />}

        {/* 連結費用單 */}
        {expenses.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>連結的費用申請</div>
            {expenses.map(e => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-secondary)' }}>#{e.id} {e.title}</span>
                {e.estimated_amount != null && <span style={{ color: 'var(--text-muted)' }}>${e.estimated_amount}</span>}
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: EXPENSE_STATUS_COLOR[e.status] || 'var(--text-muted)' }}>{e.status}</span>
              </div>
            ))}
          </div>
        )}

        {/* 附件 */}
        {atts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>完工/相關附件</div>
            {atts.map(a => (
              <button key={a.id} onClick={() => openAttachment(a)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 8px', background: 'var(--bg-secondary)', borderRadius: 6, border: 'none', cursor: 'pointer', color: 'var(--accent-cyan)', marginBottom: 4, width: '100%', textAlign: 'left' }}>
                <Paperclip size={12} /> {a.file_name}
              </button>
            ))}
          </div>
        )}

        {/* 動作 */}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          {ro.status !== '已完工' && ro.status !== '已取消' && needsExpense && (
            <button className="btn btn-secondary" onClick={() => setShowExpense(true)}>💳 去申請費用</button>
          )}
          {ro.status !== '已完工' && ro.status !== '已取消' && (
            <button className="btn btn-primary" disabled={!canComplete} onClick={() => setShowComplete(true)}
              title={hasPendingExpense ? '費用單尚未核准,無法回報完工' : ''}>✅ 回報完工</button>
          )}
          {ro.status !== '已完工' && ro.status !== '已取消' && (
            <button className="btn btn-ghost" onClick={cancel} style={{ marginLeft: 'auto', color: 'var(--text-secondary)' }}>作廢</button>
          )}
          <button className="btn btn-ghost" onClick={remove}
            style={{ marginLeft: (ro.status !== '已完工' && ro.status !== '已取消') ? 0 : 'auto', color: 'var(--accent-red)' }}>刪除</button>
        </div>
        {hasPendingExpense && <div style={{ fontSize: 12, color: 'var(--accent-orange)', marginTop: 8 }}>⚠ 有費用單還在「申請中」,核准後才能回報完工。</div>}
      </Modal>

      {showExpense && (
        <ExpenseFormDraft onCapture={captureExpense} onClose={() => setShowExpense(false)} />
      )}
      {showComplete && (
        <CompleteModal ro={ro} me={me} onClose={() => setShowComplete(false)} onDone={() => { setShowComplete(false); onClose(); onChanged() }} />
      )}
    </>
  )
}

function CompleteModal({ ro, me, onClose, onDone }) {
  const [completedAt, setCompletedAt] = useState(new Date().toISOString().slice(0, 16))
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])

  const submit = async () => {
    // 先上傳完工檔案(form_attachments),再標完工
    if (files.length) {
      try {
        await uploadFormAttachments({
          formType: FORM_TYPE, formId: ro.id, files: files.map(f => ({ file: f })), organizationId: ro.organization_id,
          uploaderEmpId: me?.id, uploaderName: me?.name || '系統',
        })
      } catch (err) { toast.error('附件上傳失敗：' + (err.message || '')); return }
    }
    const { data, error } = await supabase.rpc('complete_repair_order', {
      p_id: ro.id, p_completed_at: new Date(completedAt).toISOString(), p_completion_note: note || null,
    })
    if (error || !data?.ok) {
      toast.error(data?.error === 'EXPENSE_PENDING' ? '費用單尚未核准,無法回報完工' : '回報失敗：' + (data?.error || error?.message || ''))
      return
    }
    toast.success('已回報完工'); onDone()
  }

  return (
    <Modal title="✅ 回報完工" onClose={onClose} onSubmit={submit}>
      <Field label="完工時間" required>
        <input className="form-input" type="datetime-local" value={completedAt} onChange={e => setCompletedAt(e.target.value)} style={{ width: '100%' }} />
      </Field>
      <Field label="完工備註"><textarea className="form-input" rows={2} value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%' }} /></Field>
      <Field label="完工照片 / 檔案">
        <input type="file" multiple accept={ATTACH_ACCEPT} onChange={e => setFiles(Array.from(e.target.files || []))} style={{ fontSize: 12 }} />
        {files.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                <Paperclip size={11} /> {f.name}
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}><XIcon size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>可上傳照片、PDF、Word、Excel 等</div>
      </Field>
    </Modal>
  )
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', fontSize: 13, borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ minWidth: 96, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', flex: 1 }}>{value}</span>
    </div>
  )
}
