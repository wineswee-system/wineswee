import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Trash2, Pencil, CheckCircle2, XCircle, FileCheck, Paperclip, X, Settings, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { uploadFormAttachments, listFormAttachments, getAttachmentSignedUrl, cloneFormAttachments, loadCarriedFormAttachments } from '../../lib/formAttachments'
import CarriedAttachments from '../../components/CarriedAttachments'
import { printGoodsTransferSignOff } from '../../lib/signOffAdapters'
import { postBindingFillDone } from '../../lib/embeddedBinding'

// 商品調撥申請單 — 兩階段流程（申請審核 + 驗收審核）

const TRANSFER_TYPE_OPTS = [
  { value: 'warehouse_to_store', label: '總倉 → 門市' },
  { value: 'store_to_store',     label: '門市 → 門市' },
  { value: 'store_to_warehouse', label: '門市 → 總倉' },
]

const REASON_OPTS = [
  '銷售需求', '活動檔期', '新品上市', '客戶預訂',
  '庫存不足', '即將缺貨', '門市調整', '商品損耗補充',
]

const STATUS_COLORS = {
  '草稿':       { bg: 'var(--bg-tertiary)',       fg: 'var(--text-muted)' },
  '申請審核中': { bg: 'var(--accent-orange-dim)', fg: 'var(--accent-orange)' },
  '待驗收':     { bg: 'var(--accent-cyan-dim)',   fg: 'var(--accent-cyan)' },
  '驗收審核中': { bg: 'var(--accent-purple-dim)', fg: 'var(--accent-purple)' },
  '已完成':     { bg: 'var(--accent-green-dim)',  fg: 'var(--accent-green)' },
  '已駁回':     { bg: 'var(--accent-red-dim)',    fg: 'var(--accent-red)' },
  '已撤回':     { bg: 'var(--bg-tertiary)',       fg: 'var(--text-muted)' },
}

const emptyForm = () => ({
  transfer_type: 'warehouse_to_store',
  from_store_id: null,
  to_store_id: null,
  needed_date: '',
  reasons: [],
  reason_other: '',
  attachments: [],
  attachFiles: [],  // [{ file, preview }] 新選的檔案，submit 後再 upload
  items: [{ line_no: 1, product_code: '', product_name: '', spec: '', unit: '', requested_qty: '', notes: '' }],
})

export default function TransferRequests() {
  const { profile, hasPermission } = useAuth()
  const navigate = useNavigate()

  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [cloneSourceId, setCloneSourceId] = useState(null)  // 複製重送：來源單 id（送出後複製附件）
  const [carriedAtts, setCarriedAtts] = useState([])  // 複製重送帶入的舊附件（彈窗內可看/可刪）
  const removeCarriedAtt = (idx) => setCarriedAtts(prev => prev.filter((_, i) => i !== idx))
  const [form, setForm] = useState(emptyForm())
  const [detailRow, setDetailRow] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) return
    Promise.all([
      supabase.from('goods_transfer_requests').select('*, items:goods_transfer_items(*)').eq('organization_id', orgId).is('deleted_at', null).order('id', { ascending: false }),
      supabase.from('employees').select('id, name, store_id, position').eq('organization_id', orgId).eq('status', '在職'),
      supabase.from('stores').select('id, name, manager_id').eq('organization_id', orgId),
    ]).then(([r, e, s]) => {
      setRecords(r.data || [])
      setEmployees(e.data || [])
      setStores(s.data || [])
    }).finally(() => setLoading(false))
  }, [profile?.organization_id])

  // 從 Dashboard / LINE 卡片連過來時 ?focus=ID → 自動開該單詳情
  useEffect(() => {
    const focusId = searchParams.get('focus')
    if (!focusId || !records.length || detailRow) return
    const target = records.find(r => String(r.id) === String(focusId))
    if (target) setDetailRow(target)
  }, [searchParams, records, detailRow])

  // 從任務綁定跳過來 ?new=1&binding_id=N → 自動開新建 modal
  // 開完就把 new=1 拿掉，避免關 modal 又彈出（binding_id 留著給 submit 用）
  useEffect(() => {
    if (searchParams.get('new') === '1' && !showFormModal) {
      setEditingId(null)
      setForm(emptyForm())
      setShowFormModal(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, showFormModal, setSearchParams])

  const storeMap = useMemo(() => Object.fromEntries(stores.map(s => [s.id, s])), [stores])
  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees])

  const filtered = useMemo(() => records.filter(r =>
    (statusFilter === '' || r.status === statusFilter)
    && (search === '' || r.document_no?.includes(search) || r.applicant_name?.includes(search))
  ), [records, statusFilter, search])

  const reload = () => {
    const orgId = profile?.organization_id
    supabase.from('goods_transfer_requests').select('*, items:goods_transfer_items(*)').eq('organization_id', orgId).is('deleted_at', null).order('id', { ascending: false })
      .then(({ data }) => setRecords(data || []))
  }

  const isStoreToStore = form.transfer_type === 'store_to_store'

  // 門市↔門市：選好調入門市 → 自動填申請人為該店店長
  const autoApplicantId = useMemo(() => {
    if (!isStoreToStore || !form.to_store_id) return null
    const store = storeMap[form.to_store_id]
    return store?.manager_id || null
  }, [isStoreToStore, form.to_store_id, storeMap])

  const handleSubmit = async () => {
    if (!form.transfer_type) { toast.error('請選調撥類型'); return }
    if (isStoreToStore && (!form.from_store_id || !form.to_store_id)) { toast.error('請選調出/調入門市'); return }
    if (!form.items.length || form.items.some(it => !it.product_code || !it.product_name || !it.requested_qty)) {
      toast.error('商品明細必填：商品編號 / 名稱 / 申請數量'); return
    }
    if (!form.reasons.length && !form.reason_other) { toast.error('請至少選一個申請原因'); return }

    // FT 員工 store↔store 必須是調入店長
    if (isStoreToStore) {
      if (!autoApplicantId) { toast.error('調入門市未設店長，無法用門市↔門市'); return }
      if (autoApplicantId !== profile?.id) {
        toast.error(`門市↔門市調撥必須由「調入門市店長」發起。目前店長為員工 #${autoApplicantId}`); return
      }
    }

    const applicantId = isStoreToStore ? autoApplicantId : profile?.id
    const applicant = empMap[applicantId]

    const fromStore = storeMap[form.from_store_id]
    const toStore = storeMap[form.to_store_id]
    const fromLabel = form.transfer_type === 'warehouse_to_store' ? '總倉' : (fromStore?.name || '')
    const toLabel   = form.transfer_type === 'store_to_warehouse' ? '總倉' : (toStore?.name || '')

    // 任務綁定跳過來時帶 binding_id（讓 trigger 自動 sync task_form_bindings）
    const bindingIdParam = searchParams.get('binding_id')
    const linkedBindingId = bindingIdParam ? Number(bindingIdParam) : null

    const payload = {
      organization_id: profile?.organization_id,
      applicant_id: applicantId,
      applicant_name: applicant?.name || profile?.name,
      applicant_dept: profile?.dept || '',
      applicant_store: applicant?.store_id ? storeMap[applicant.store_id]?.name : '',
      transfer_type: form.transfer_type,
      from_store_id: form.transfer_type === 'warehouse_to_store' ? null : form.from_store_id,
      to_store_id:   form.transfer_type === 'store_to_warehouse' ? null : form.to_store_id,
      from_label: fromLabel,
      to_label:   toLabel,
      reasons: form.reasons,
      reason_other: form.reason_other,
      attachments: form.attachments,
      request_date: new Date().toISOString().slice(0, 10),
      needed_date: form.needed_date || null,
      linked_binding_id: linkedBindingId,
    }

    try {
      let targetId = editingId
      if (editingId) {
        const { error } = await supabase.from('goods_transfer_requests').update({
          ...payload,
          status: '申請審核中',
          reject_reason: null,
          rejected_at: null,
        }).eq('id', editingId)
        if (error) throw error
        await supabase.from('goods_transfer_items').delete().eq('transfer_request_id', editingId)
        await supabase.from('goods_transfer_items').insert(form.items.map((it, i) => ({
          transfer_request_id: editingId, line_no: i + 1,
          product_code: it.product_code, product_name: it.product_name,
          spec: it.spec, unit: it.unit, requested_qty: Number(it.requested_qty), notes: it.notes,
        })))
        toast.success('已重送審核')
      } else {
        const { data, error } = await supabase.from('goods_transfer_requests').insert(payload).select().single()
        if (error) throw error
        targetId = data.id
        await supabase.from('goods_transfer_items').insert(form.items.map((it, i) => ({
          transfer_request_id: data.id, line_no: i + 1,
          product_code: it.product_code, product_name: it.product_name,
          spec: it.spec, unit: it.unit, requested_qty: Number(it.requested_qty), notes: it.notes,
        })))
        toast.success(`已送出申請 ${data.document_no}`)
      }
      // 上傳附件（如果有選）
      if (form.attachFiles?.length > 0 && targetId) {
        const res = await uploadFormAttachments({
          formType: 'goods_transfer_apply',
          formId: targetId,
          files: form.attachFiles,
          organizationId: profile?.organization_id,
          uploaderEmpId: profile?.id,
          uploaderName: profile?.name,
        })
        if (res.errors?.length) toast.error(`部分附件上傳失敗：${res.errors.length} 筆`)
      }
      // 複製重送：把來源單的附件複製到新單（含 storage 檔，獨立，不動原單）
      if (cloneSourceId && !editingId && targetId) {
        if (carriedAtts.length) {
          await cloneFormAttachments({ formType: 'goods_transfer_apply', toFormId: targetId, organizationId: profile?.organization_id, uploaderEmpId: profile?.id, uploaderName: profile?.name, atts: carriedAtts })
        }
        setCloneSourceId(null)
        setCarriedAtts([])
      }
      setShowFormModal(false)
      setEditingId(null)
      setForm(emptyForm())
      postBindingFillDone(linkedBindingId || null)  // 任務 iframe inline：通知父視窗完成
      // 任務綁定跳過來的，送出成功後把 binding_id 清掉
      if (linkedBindingId) {
        const next = new URLSearchParams(searchParams)
        next.delete('binding_id')
        setSearchParams(next, { replace: true })
      }
      reload()
    } catch (e) {
      toast.error('送出失敗：' + e.message)
    }
  }

  const handleEdit = (row) => {
    if (row.status !== '已駁回') return
    setEditingId(row.id)
    setForm({
      transfer_type: row.transfer_type,
      from_store_id: row.from_store_id,
      to_store_id: row.to_store_id,
      needed_date: row.needed_date || '',
      reasons: row.reasons || [],
      reason_other: row.reason_other || '',
      attachments: row.attachments || [],
      items: (row.items || []).sort((a, b) => a.line_no - b.line_no).map(it => ({
        line_no: it.line_no, product_code: it.product_code, product_name: it.product_name,
        spec: it.spec || '', unit: it.unit || '', requested_qty: it.requested_qty, notes: it.notes || '',
      })),
    })
    setShowFormModal(true)
  }

  // 複製：以舊單為範本開全新單（含品項與附件，不動原單，任何狀態都可）
  const handleClone = (row) => {
    setEditingId(null)
    setCloneSourceId(row.id)
    loadCarriedFormAttachments('goods_transfer_apply', row.id).then(setCarriedAtts)
    setForm({
      transfer_type: row.transfer_type,
      from_store_id: row.from_store_id,
      to_store_id: row.to_store_id,
      needed_date: row.needed_date || '',
      reasons: row.reasons || [],
      reason_other: row.reason_other || '',
      attachments: [],
      attachFiles: [],
      items: (row.items || []).sort((a, b) => a.line_no - b.line_no).map(it => ({
        line_no: it.line_no, product_code: it.product_code, product_name: it.product_name,
        spec: it.spec || '', unit: it.unit || '', requested_qty: it.requested_qty, notes: it.notes || '',
      })),
    })
    setShowFormModal(true)
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: `確定撤回單號 ${row.document_no}？` }))) return
    await supabase.from('goods_transfer_requests').update({
      status: '已撤回', deleted_at: new Date().toISOString(), deleted_by: profile?.id,
    }).eq('id', row.id)
    reload()
  }

  // 一鍵重送：不改內容，直接 reset chain 回申請審核中（重建 snapshot）
  const handleResubmit = async (row) => {
    if (!(await confirm({ message: `確定一鍵重送單號 ${row.document_no}？（內容不變，重跑申請鏈）` }))) return
    const { data, error } = await supabase.rpc('goods_transfer_resubmit', {
      p_id: row.id, p_applicant_id: profile?.id,
    })
    if (error) { toast.error('重送失敗：' + error.message); return }
    if (!data?.ok) { toast.error('重送失敗：' + (data?.error || '未知錯誤')); return }
    toast.success('已重送，狀態回到申請審核中')
    reload()
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📦</span> 商品調撥申請</h2>
            <p>跨門市 / 總倉↔門市商品調撥 — 申請 + 驗收兩階段</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasPermission('approval_chain.edit') && (
              <>
                <button className="btn btn-secondary" onClick={() => navigate('/process/settings/transfer-apply-chains')} title="管理「商品調撥-申請」簽核鏈（倉↔門市、門市↔門市）">
                  <Settings size={14} /> 申請簽核設定
                </button>
                <button className="btn btn-secondary" onClick={() => navigate('/process/settings/transfer-receipt-chains')} title="管理「商品調撥-驗收」簽核鏈">
                  <Settings size={14} /> 驗收簽核設定
                </button>
              </>
            )}
            <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm(emptyForm()); setShowFormModal(true) }}>
              <Plus size={14} /> 新增調撥
            </button>
          </div>
        </div>
      </div>

      {/* Stats / Filter cards — 點卡片切換 status filter */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
        {['申請審核中', '待驗收', '驗收審核中', '已完成', '已駁回', '已撤回'].map(s => {
          const sc = STATUS_COLORS[s]
          const count = records.filter(r => r.status === s).length
          const selected = statusFilter === s
          return (
            <div key={s} className="card" style={{ padding: '12px 16px', cursor: 'pointer', border: selected ? `2px solid ${sc.fg}` : '1px solid var(--border-medium)' }}
              onClick={() => setStatusFilter(selected ? '' : s)}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: sc.fg }}>{count}</div>
            </div>
          )
        })}
      </div>

      {/* Search inline */}
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginBottom: 12 }}>
        <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋單號 / 申請人"
          style={{ paddingLeft: 26, paddingRight: search ? 26 : 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 200 }} />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* 列表 */}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '140px 100px 110px 130px 130px 80px 1fr 100px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
          {['單號', '申請人', '類型', '調出', '調入', '項數', '狀態 / 階段', '操作'].map(h => <div key={h} style={{ padding: '10px 8px' }}>{h}</div>)}
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>沒有資料</div>
        )}
        {filtered.map(r => {
          const sc = STATUS_COLORS[r.status] || {}
          return (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '140px 100px 110px 130px 130px 80px 1fr 100px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
              onClick={() => setDetailRow(r)}>
              <div style={{ padding: '10px 8px', fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{r.document_no}</div>
              <div style={{ padding: '10px 8px', fontSize: 13 }}>{r.applicant_name}</div>
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-secondary)' }}>{TRANSFER_TYPE_OPTS.find(o => o.value === r.transfer_type)?.label}</div>
              <div style={{ padding: '10px 8px', fontSize: 12 }}>{r.from_label}</div>
              <div style={{ padding: '10px 8px', fontSize: 12 }}>{r.to_label}</div>
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)' }}>{(r.items || []).length} 項</div>
              <div style={{ padding: '10px 8px' }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.fg }}>
                  {r.status}
                </span>
                {r.status === '已駁回' && r.reject_reason && (
                  <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{r.reject_reason.slice(0, 30)}</div>
                )}
              </div>
              <div style={{ padding: '10px 8px' }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {r.status === '已駁回' && r.applicant_id === profile?.id && (
                    <>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleResubmit(r)} title="一鍵重送（內容不變）">
                        🔁
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(r)} title="編輯重送">
                        <Pencil size={11} />
                      </button>
                    </>
                  )}
                  {r.applicant_id === profile?.id && (
                    <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-cyan)' }} onClick={() => handleClone(r)} title="以這張為範本開一張全新調撥（含品項與附件，不動原單）">
                      📋
                    </button>
                  )}
                  {['草稿','申請審核中'].includes(r.status) && r.applicant_id === profile?.id && (
                    <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(r)} title="撤回" style={{ color: 'var(--accent-red)' }}>
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 新增 / 編輯 Modal */}
      {showFormModal && (
        <TransferFormModal
          form={form} setForm={setForm}
          editingId={editingId}
          stores={stores}
          autoApplicantId={autoApplicantId}
          empMap={empMap}
          profileId={profile?.id}
          onClose={() => { setShowFormModal(false); setEditingId(null); setCloneSourceId(null); setCarriedAtts([]) }}
          carriedAtts={carriedAtts}
          onRemoveCarried={removeCarriedAtt}
          onSubmit={handleSubmit}
        />
      )}

      {/* Detail / 驗收 / 簽核 Modal */}
      {detailRow && (
        <TransferDetailModal
          row={detailRow}
          stores={stores}
          empMap={empMap}
          profile={profile}
          userRole={userRole}
          onClose={() => setDetailRow(null)}
          onChanged={() => { reload(); setDetailRow(null) }}
        />
      )}
    </div>
  )
}

// ── 表單 Modal ─────────────────────────────────────────────────────────────
function TransferFormModal({ form, setForm, editingId, stores, autoApplicantId, empMap, profileId, onClose, onSubmit, carriedAtts = [], onRemoveCarried }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const isStoreToStore = form.transfer_type === 'store_to_store'

  const storeOpts = stores.map(s => ({ value: s.id, label: s.name }))

  const updateItem = (idx, field, value) => {
    setForm(f => ({
      ...f,
      items: f.items.map((it, i) => i === idx ? { ...it, [field]: value } : it),
    }))
  }
  const addItem = () => setForm(f => ({
    ...f,
    items: [...f.items, { line_no: f.items.length + 1, product_code: '', product_name: '', spec: '', unit: '', requested_qty: '', notes: '' }],
  }))
  const removeItem = (idx) => setForm(f => ({
    ...f,
    items: f.items.filter((_, i) => i !== idx),
  }))

  const toggleReason = (r) => setForm(f => ({
    ...f,
    reasons: f.reasons.includes(r) ? f.reasons.filter(x => x !== r) : [...f.reasons, r],
  }))

  return (
    <Modal title={editingId ? '✏️ 編輯重送調撥單' : '📦 新增調撥申請'} onClose={onClose} onSubmit={onSubmit}>
      <Field label="調撥類型" required>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TRANSFER_TYPE_OPTS.map(opt => {
            const selected = form.transfer_type === opt.value
            return (
              <label key={opt.value} style={{
                flex: '1 1 140px', cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
                background: selected ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                border: `2px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
              }}>
                <input type="radio" name="transfer_type" checked={selected}
                  onChange={() => set('transfer_type', opt.value)} style={{ marginRight: 8, accentColor: 'var(--accent-cyan)' }} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{opt.label}</span>
              </label>
            )
          })}
        </div>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {form.transfer_type !== 'store_to_warehouse' && (
          <Field label="調入門市" required>
            <SearchableSelect value={form.to_store_id || ''} onChange={(v) => set('to_store_id', Number(v) || null)}
              options={storeOpts} placeholder="選調入門市" />
          </Field>
        )}
        {form.transfer_type !== 'warehouse_to_store' && (
          <Field label="調出門市" required>
            <SearchableSelect value={form.from_store_id || ''} onChange={(v) => set('from_store_id', Number(v) || null)}
              options={storeOpts} placeholder="選調出門市" />
          </Field>
        )}
      </div>

      {isStoreToStore && form.to_store_id && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-cyan-dim)', fontSize: 12, color: 'var(--accent-cyan)', marginBottom: 12 }}>
          🔒 申請人自動設為調入門市店長：<b>{empMap[autoApplicantId]?.name || `（門市未設店長）`}</b>
          {autoApplicantId !== profileId && (
            <div style={{ color: 'var(--accent-red)', marginTop: 4 }}>
              ⚠️ 你不是該門市店長，無法發起此調撥
            </div>
          )}
        </div>
      )}

      <Field label="需求日期">
        <input type="date" className="form-input" value={form.needed_date} onChange={e => set('needed_date', e.target.value)} />
      </Field>

      <Field label="商品明細" required>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 90px 70px 90px 32px', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            <div>商品編號</div><div>商品名稱</div><div>規格</div><div>單位</div><div>申請數量</div><div></div>
          </div>
          {form.items.map((it, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 90px 70px 90px 32px', gap: 6 }}>
              <input className="form-input" style={{ fontSize: 12, padding: '6px' }} value={it.product_code} onChange={e => updateItem(i, 'product_code', e.target.value)} placeholder="編號" />
              <input className="form-input" style={{ fontSize: 12, padding: '6px' }} value={it.product_name} onChange={e => updateItem(i, 'product_name', e.target.value)} placeholder="名稱" />
              <input className="form-input" style={{ fontSize: 12, padding: '6px' }} value={it.spec} onChange={e => updateItem(i, 'spec', e.target.value)} placeholder="規格" />
              <input className="form-input" style={{ fontSize: 12, padding: '6px' }} value={it.unit} onChange={e => updateItem(i, 'unit', e.target.value)} placeholder="單位" />
              <input className="form-input" type="number" style={{ fontSize: 12, padding: '6px' }} value={it.requested_qty} onChange={e => updateItem(i, 'requested_qty', e.target.value)} placeholder="數量" />
              <button onClick={() => removeItem(i)} style={{ border: 'none', background: 'transparent', color: 'var(--accent-red)', cursor: 'pointer' }}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addItem}>
            <Plus size={11} /> 加一行
          </button>
        </div>
      </Field>

      <Field label="申請原因（可複選）" required>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {REASON_OPTS.map(r => {
            const selected = form.reasons.includes(r)
            return (
              <label key={r} style={{
                cursor: 'pointer', padding: '5px 10px', borderRadius: 999, fontSize: 12,
                background: selected ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                color: selected ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                border: `1px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
              }}>
                <input type="checkbox" checked={selected} onChange={() => toggleReason(r)} style={{ display: 'none' }} />
                {selected ? '✓ ' : ''}{r}
              </label>
            )
          })}
        </div>
        <input className="form-input" placeholder="其他原因（補充說明）" style={{ marginTop: 8, fontSize: 13 }}
          value={form.reason_other} onChange={e => set('reason_other', e.target.value)} />
      </Field>

      <Field label="附件（截圖 / PDF，最多 5 個）">
        <CarriedAttachments atts={carriedAtts} onRemove={onRemoveCarried} />
        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '10px', borderRadius: 8, border: '2px dashed var(--border-medium)',
          color: 'var(--accent-cyan)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          <Paperclip size={14} /> 選擇檔案
          <input type="file" multiple accept="image/*,application/pdf" hidden
            onChange={e => {
              const files = Array.from(e.target.files || [])
              const newOnes = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
              setForm(f => ({ ...f, attachFiles: [...(f.attachFiles || []), ...newOnes].slice(0, 5) }))
              e.target.value = ''
            }} />
        </label>
        {form.attachFiles?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {form.attachFiles.map((a, i) => (
              <div key={i} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-medium)' }}>
                {a.file.type.startsWith('image/') ? (
                  <img src={a.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', fontSize: 10, color: 'var(--text-muted)' }}>
                    {(a.file.name.split('.').pop() || '?').toUpperCase()}
                  </div>
                )}
                <button onClick={() => setForm(f => ({ ...f, attachFiles: f.attachFiles.filter((_, j) => j !== i) }))}
                  style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Field>
    </Modal>
  )
}

// ── Detail / 驗收 / 簽核 Modal ──────────────────────────────────────────
function TransferDetailModal({ row, stores, empMap, profile, userRole, onClose, onChanged }) {
  const [receiptItems, setReceiptItems] = useState(
    (row.items || []).sort((a, b) => a.line_no - b.line_no).map(it => ({ ...it, received_qty: it.received_qty ?? it.requested_qty }))
  )
  const [submitting, setSubmitting] = useState(false)
  const [approverStep, setApproverStep] = useState(null)
  const [applyAttachments, setApplyAttachments] = useState([])
  const [receiptAttachments, setReceiptAttachments] = useState([])
  const [receiptFiles, setReceiptFiles] = useState([])  // 員工驗收時新上傳的

  useEffect(() => {
    if (!['申請審核中', '驗收審核中'].includes(row.status)) return
    const reqType = row.current_stage === 'apply' ? 'goods_transfer_apply' : 'goods_transfer_receipt'
    supabase.rpc('resolve_snapshot_step_approvers', {
      p_request_type: reqType,
      p_request_id: row.id,
      p_step_order: row.current_step,
      p_applicant_emp_id: row.applicant_id,
    }).then(({ data }) => {
      const ids = (data || []).map(r => r.emp_id)
      setApproverStep(ids.includes(profile?.id))
    })
  }, [row, profile?.id])

  // 載入兩階段附件
  useEffect(() => {
    listFormAttachments('goods_transfer_apply', row.id).then(setApplyAttachments)
    listFormAttachments('goods_transfer_receipt', row.id).then(setReceiptAttachments)
  }, [row.id])

  const canSubmitReceipt = row.status === '待驗收' && row.applicant_id === profile?.id

  const handleSubmitReceipt = async () => {
    setSubmitting(true)
    // 先上傳附件
    if (receiptFiles.length > 0) {
      const res = await uploadFormAttachments({
        formType: 'goods_transfer_receipt',
        formId: row.id,
        files: receiptFiles,
        organizationId: profile?.organization_id,
        uploaderEmpId: profile?.id,
        uploaderName: profile?.name,
      })
      if (res.errors?.length) toast.error(`部分附件上傳失敗：${res.errors.length} 筆`)
    }
    const { data, error } = await supabase.rpc('goods_transfer_submit_receipt', {
      p_id: row.id,
      p_items: receiptItems.map(it => ({ id: it.id, received_qty: it.received_qty })),
      p_attachments: [],
    })
    setSubmitting(false)
    if (error || !data?.ok) { toast.error('送驗收失敗：' + (error?.message || data?.error)); return }
    toast.success('已送驗收審核')
    onChanged()
    postBindingFillDone(null)  // 任務 iframe inline（驗收段）：通知父視窗完成
  }

  const openAttachment = async (att) => {
    const url = await getAttachmentSignedUrl({ bucket: att.storage_bucket || 'attachments', path: att.storage_path })
    if (url) window.open(url, '_blank')
  }

  const handleApprove = async (action) => {
    let reason = null
    if (action === 'reject') {
      reason = window.prompt('駁回原因：')
      if (!reason) return
    }
    setSubmitting(true)
    const { data, error } = await supabase.rpc('goods_transfer_approve', {
      p_id: row.id, p_approver_id: profile?.id, p_action: action, p_reason: reason,
    })
    setSubmitting(false)
    if (error || !data?.ok) { toast.error((action === 'approve' ? '核准' : '駁回') + '失敗：' + (error?.message || data?.error)); return }
    toast.success(action === 'approve' ? '已核准' : '已駁回')
    onChanged()
  }

  // 下載簽呈 — 從 request_chain_snapshots (兩階段) + approval_step_history 組 chainSteps
  const handlePrintSignOff = async () => {
    // popup blocker 規避：在 user click 同步開 window，後續 async 載入完再寫內容
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const [{ data: snaps }, { data: history }, { data: empsWithSig }, { data: org }] = await Promise.all([
        supabase.from('request_chain_snapshots')
          .select('request_type, step_order, label, target_type')
          .in('request_type', ['goods_transfer_apply', 'goods_transfer_receipt'])
          .eq('request_id', row.id)
          .order('step_order'),
        supabase.from('approval_step_history')
          .select('request_type, step_order, step_label, approver_id, approver_name, action, entered_at, exited_at, notes')
          .in('request_type', ['goods_transfer_apply', 'goods_transfer_receipt'])
          .eq('request_id', row.id)
          .order('exited_at'),
        supabase.from('employees').select('id, name, signature_url')
          .eq('organization_id', profile?.organization_id),
        supabase.from('organizations').select('name, logo_url').eq('id', profile?.organization_id).maybeSingle(),
      ])
      // 簽章 map：{ '姓名': signature_url }
      const signatures = Object.fromEntries(
        (empsWithSig || []).filter(e => e.signature_url).map(e => [e.name, e.signature_url])
      )
      // 組 chainSteps：申請人 → 申請鏈 steps → (若已驗收) 申請人填驗收 → 驗收鏈 steps
      const chainSteps = [
        {
          label: '申請人', name: row.applicant_name || '', status: 'completed',
          completedAt: row.created_at, isApplicant: true,
        },
      ]
      const applySnaps = (snaps || []).filter(s => s.request_type === 'goods_transfer_apply').sort((a, b) => a.step_order - b.step_order)
      const applyHist  = (history || []).filter(h => h.request_type === 'goods_transfer_apply')
      for (const snap of applySnaps) {
        const h = applyHist.find(x => x.step_order === snap.step_order)
        chainSteps.push({
          label: snap.label || `申請-第${snap.step_order + 1}關`,
          name: h?.approver_name || '',
          status: h?.action === 'approved' ? 'completed' : h?.action === 'rejected' ? 'rejected' : (row.current_stage === 'apply' && row.current_step === snap.step_order ? 'current' : 'pending'),
          completedAt: h?.exited_at,
          rejectReason: h?.action === 'rejected' ? h?.notes : undefined,
          target_emp_id: h?.approver_id,
        })
      }
      // 驗收段（如果有送驗收）
      if (row.receipt_submitted_at) {
        chainSteps.push({
          label: '驗收提交', name: row.applicant_name || '', status: 'completed',
          completedAt: row.receipt_submitted_at, isApplicant: true,
        })
        const recvSnaps = (snaps || []).filter(s => s.request_type === 'goods_transfer_receipt').sort((a, b) => a.step_order - b.step_order)
        const recvHist  = (history || []).filter(h => h.request_type === 'goods_transfer_receipt')
        for (const snap of recvSnaps) {
          const h = recvHist.find(x => x.step_order === snap.step_order)
          chainSteps.push({
            label: snap.label || `驗收-第${snap.step_order + 1}關`,
            name: h?.approver_name || '',
            status: h?.action === 'approved' ? 'completed' : h?.action === 'rejected' ? 'rejected' : (row.current_stage === 'receipt' && row.current_step === snap.step_order ? 'current' : 'pending'),
            completedAt: h?.exited_at,
            rejectReason: h?.action === 'rejected' ? h?.notes : undefined,
            target_emp_id: h?.approver_id,
          })
        }
      }
      printGoodsTransferSignOff(row, {
        companyName: org?.name, logoUrl: org?.logo_url,
        applicantDept: '',
        signatures, chainSteps,
        _win: win,
      })
    } catch (e) {
      win.close()
      toast.error('產生簽呈失敗：' + (e.message || '未知錯誤'))
    }
  }

  const sc = STATUS_COLORS[row.status] || {}

  return (
    <Modal title={`📦 ${row.document_no}`} onClose={onClose} submitLabel="關閉" onSubmit={onClose}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: sc.bg, color: sc.fg }}>
          {row.status}
        </span>
        {row.current_stage && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>階段：{row.current_stage === 'apply' ? '申請審核' : '驗收審核'} / step {row.current_step}</span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13, marginBottom: 12 }}>
        <div><b>申請人：</b>{row.applicant_name}</div>
        <div><b>類型：</b>{TRANSFER_TYPE_OPTS.find(o => o.value === row.transfer_type)?.label}</div>
        <div><b>調出：</b>{row.from_label}</div>
        <div><b>調入：</b>{row.to_label}</div>
        <div><b>申請日：</b>{row.request_date}</div>
        <div><b>需求日：</b>{row.needed_date || '-'}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <b style={{ fontSize: 13 }}>原因：</b>
        <span style={{ fontSize: 12 }}>{(row.reasons || []).join(', ')}{row.reason_other ? ` · ${row.reason_other}` : ''}</span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <b style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>商品明細{canSubmitReceipt ? '（請填實際收到數量）' : ''}：</b>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px 60px 80px 80px', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)' }}>
          <div>編號</div><div>名稱</div><div>規格</div><div>單位</div><div>申請</div><div>實收</div>
        </div>
        {receiptItems.map((it, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px 60px 80px 80px', gap: 6, fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontFamily: 'monospace' }}>{it.product_code}</div>
            <div>{it.product_name}</div>
            <div>{it.spec || '-'}</div>
            <div>{it.unit || '-'}</div>
            <div>{Number(it.requested_qty)}</div>
            <div>
              {canSubmitReceipt ? (
                <input type="number" className="form-input" style={{ padding: '4px 6px', fontSize: 12, width: 70 }}
                  value={it.received_qty}
                  onChange={e => setReceiptItems(prev => prev.map((x, j) => j === i ? { ...x, received_qty: e.target.value } : x))} />
              ) : (
                <span style={{ color: it.received_qty != null ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                  {it.received_qty != null ? Number(it.received_qty) : '-'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {row.reject_reason && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 12, marginBottom: 12 }}>
          <b>駁回原因：</b>{row.reject_reason}
        </div>
      )}

      {/* 申請附件 */}
      {applyAttachments.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <b style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>📎 申請附件：</b>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {applyAttachments.map((a, i) => (
              <button key={i} onClick={() => openAttachment(a)} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                <Paperclip size={11} /> {a.file_name || `附件 ${i+1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 驗收附件 */}
      {receiptAttachments.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <b style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>📎 驗收附件：</b>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {receiptAttachments.map((a, i) => (
              <button key={i} onClick={() => openAttachment(a)} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                <Paperclip size={11} /> {a.file_name || `附件 ${i+1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 驗收時可上傳新附件 */}
      {canSubmitReceipt && (
        <div style={{ marginBottom: 12 }}>
          <b style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>📎 上傳驗收附件（截圖 / PDF，最多 5 個）：</b>
          <label style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px', borderRadius: 8, border: '2px dashed var(--border-medium)',
            color: 'var(--accent-cyan)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <Paperclip size={12} /> 選擇檔案
            <input type="file" multiple accept="image/*,application/pdf" hidden
              onChange={e => {
                const files = Array.from(e.target.files || [])
                const newOnes = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
                setReceiptFiles(prev => [...prev, ...newOnes].slice(0, 5))
                e.target.value = ''
              }} />
          </label>
          {receiptFiles.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {receiptFiles.map((a, i) => (
                <div key={i} style={{ position: 'relative', width: 60, height: 60, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-medium)' }}>
                  {a.file.type.startsWith('image/')
                    ? <img src={a.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', fontSize: 9, color: 'var(--text-muted)' }}>
                        {(a.file.name.split('.').pop() || '?').toUpperCase()}
                      </div>}
                  <button onClick={() => setReceiptFiles(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: 1, right: 1, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 動作按鈕 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        {canSubmitReceipt && (
          <button className="btn btn-primary" onClick={handleSubmitReceipt} disabled={submitting}>
            <FileCheck size={14} /> 送驗收審核
          </button>
        )}
        {approverStep && (
          <>
            <button className="btn btn-success" onClick={() => handleApprove('approve')} disabled={submitting}>
              <CheckCircle2 size={14} /> 核准
            </button>
            <button className="btn btn-secondary" onClick={() => handleApprove('reject')} disabled={submitting} style={{ color: 'var(--accent-red)' }}>
              <XCircle size={14} /> 駁回
            </button>
          </>
        )}
        <button className="btn btn-secondary" onClick={handlePrintSignOff} disabled={submitting} style={{ marginLeft: 'auto' }}>
          <Printer size={14} /> 下載簽呈 PDF
        </button>
      </div>
    </Modal>
  )
}
