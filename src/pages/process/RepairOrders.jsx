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
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('open')       // open | done | all
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [detail, setDetail] = useState(null)   // 目前開的維修單

  const load = async () => {
    setLoading(true)
    const { data: emp } = await supabase.from('employees')
      .select('id, name, department_id').eq('auth_user_id', profile?.auth_user_id || '').maybeSingle()
    setMe(emp || { id: profile?.id, department_id: profile?.department_id })
    let q = supabase.from('repair_orders').select('*').is('deleted_at', null).order('created_at', { ascending: false })
    if (orgId) q = q.eq('organization_id', orgId)
    const [{ data: ros }, { data: st }, { data: wos }] = await Promise.all([
      q,
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('work_orders').select('id, title, status').is('deleted_at', null).in('status', ['待受理', '處理中']).order('created_at', { ascending: false }),
    ])
    const list = ros || []
    setOrders(list)
    setStores(st || [])
    setWorkOrders(wos || [])
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

  const filtered = useMemo(() => orders.filter(o => {
    if (tab === 'open' && !['進行中', '待費用核准'].includes(o.status)) return false
    if (tab === 'done' && o.status !== '已完工') return false
    if (search) {
      const s = search.toLowerCase()
      if (!(`${o.title || ''} ${o.description || ''} ${o.location || ''} ${o.supplier || ''}`.toLowerCase().includes(s))) return false
    }
    return true
  }), [orders, tab, search])

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
          <Wrench size={20} /> 維修單
        </h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> 開維修單
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {[{ k: 'open', l: '進行中' }, { k: 'done', l: '已完工' }, { k: 'all', l: '全部' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${tab === t.k ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
            background: tab === t.k ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.k ? '#fff' : 'var(--text-secondary)',
          }}>{t.l}</button>
        ))}
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
            return (
              <div key={o.id} onClick={() => setDetail(o)} style={{
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
                  {o.location && <span>📍 {o.location} · </span>}
                  {o.requester_name} · {new Date(o.created_at).toLocaleDateString('zh-TW')}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <CreateModal orgId={orgId} stores={stores} workOrders={workOrders}
          onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load() }} />
      )}
      {detailRow && (
        <DetailModal ro={detailRow} me={me} profile={profile}
          expenses={expensesByRO[detailRow.id] || []}
          onClose={() => setDetail(null)} onChanged={load} />
      )}
    </div>
  )
}

// ── 開單 ──
function CreateModal({ orgId, stores, workOrders, onClose, onDone }) {
  const [handlerType, setHandlerType] = useState('self')
  const [f, setF] = useState({
    occur_time: new Date().toISOString().slice(0, 16), location: '', store_id: '', title: '',
    description: '', need_purchase: false, supplier: '', quote_amount: '', linked_work_order_id: '',
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!f.description.trim()) { toast.error('請填「怎麼處理 / 問題描述」'); return }
    const { data, error } = await supabase.rpc('create_repair_order', {
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
    })
    if (error || !data?.ok) { toast.error('開單失敗：' + (data?.error || error?.message || '')); return }
    toast.success('維修單已建立')
    onDone()
  }

  return (
    <Modal title="🔧 開維修單" onClose={onClose} onSubmit={submit}>
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
      <Field label="標題（可選）"><input className="form-input" value={f.title} onChange={e => set('title', e.target.value)} style={{ width: '100%' }} /></Field>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="廠商"><input className="form-input" value={f.supplier} onChange={e => set('supplier', e.target.value)} style={{ width: '100%' }} /></Field>
          <Field label="報價金額"><input className="form-input" type="number" value={f.quote_amount} onChange={e => set('quote_amount', e.target.value)} style={{ width: '100%' }} /></Field>
        </div>
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
    </Modal>
  )
}

// ── 詳情 + 動作 ──
function DetailModal({ ro, me, profile, expenses, onClose, onChanged }) {
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
        <DetailRow label="地點" value={ro.location || '—'} />
        <DetailRow label="怎麼處理 / 描述" value={ro.description} />
        {ro.handler_type === 'vendor' && <DetailRow label="廠商 / 報價" value={`${ro.supplier || '—'}${ro.quote_amount != null ? ` / $${ro.quote_amount}` : ''}`} />}
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
