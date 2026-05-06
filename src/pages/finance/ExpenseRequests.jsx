import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { ModalOverlay } from '../../components/Modal'
import { Plus, X, Check, Upload, FileText, Image, Trash2, Eye, Send, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getAccounts, getEmployees } from '../../lib/db'
import { exportExpenseRequestPdf } from '../../lib/exportPdf'
import { createApprovalWorkflow, advanceWorkflow } from '../../lib/workflowIntegration'
import { buildWorkflowChainSteps } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'

const STATUS_COLORS = {
  '申請中': { bg: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' },
  '已核准': { bg: 'var(--accent-green-dim)', color: 'var(--accent-green)' },
  '待核銷': { bg: 'var(--accent-yellow-dim)', color: 'var(--accent-yellow)' },
  '已核銷': { bg: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' },
  '已駁回': { bg: 'var(--accent-red-dim)', color: 'var(--accent-red)' },
}

const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '-'

const emptyForm = {
  employee: '', account_code: '', title: '', description: '',
  estimated_amount: '', store: '', supplier: '',
}

const emptyItem = () => ({ name: '', qty: '', unit_price: '', subtotal: 0 })

export default function ExpenseRequests() {
  const { profile } = useAuth()
  const [requests, setRequests] = useState([])
  const [accounts, setAccounts] = useState([])
  const [employees, setEmployees] = useState([])
  const [organization, setOrganization] = useState(null)  // { name, logo_url } — 印簽呈用
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showSettleModal, setShowSettleModal] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [settleForm, setSettleForm] = useState({ actual_amount: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('all')
  const [isExpense, setIsExpense] = useState(true)
  const [errors, setErrors] = useState({})
  const [editingId, setEditingId] = useState(null)  // null = 新增, 數字 = 編輯重送
  const [files, setFiles] = useState([])
  const [settleFiles, setSettleFiles] = useState([])
  const [attachments, setAttachments] = useState({})
  const [lineItems, setLineItems] = useState([emptyItem()])
  const fileRef = useRef(null)
  const settleFileRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const updateItem = (i, k, v) => setLineItems(items => {
    const n = [...items]
    n[i] = { ...n[i], [k]: v }
    if (k === 'qty' || k === 'unit_price') n[i].subtotal = (Number(n[i].qty) || 0) * (Number(n[i].unit_price) || 0)
    return n
  })
  const lineTotal = lineItems.reduce((s, li) => s + (li.subtotal || 0), 0)

  const load = async () => {
    setLoading(true)
    const orgId = profile?.organization_id
    const [reqRes, accRes, empRes, orgRes] = await Promise.all([
      supabase.from('expense_requests').select('*').order('created_at', { ascending: false }),
      getAccounts(),
      getEmployees(),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setRequests(reqRes.data || [])
    setAccounts(accRes.data || [])
    setEmployees((empRes.data || []).filter(e => e.status === '在職'))
    setOrganization(orgRes?.data || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Load attachments for detail view
  const loadAttachments = async (requestId) => {
    const { data } = await supabase.from('expense_request_attachments')
      .select('*').eq('request_id', requestId).order('created_at')
    setAttachments(prev => ({ ...prev, [requestId]: data || [] }))
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  const MAX_SIZE = 10 * 1024 * 1024 // 10MB

  // Upload files to Supabase Storage
  const uploadFiles = async (requestId, fileList, stage = 'request') => {
    const results = []
    for (const file of fileList) {
      if (!ALLOWED_TYPES.includes(file.type)) { alert('不支援此檔案類型'); continue }
      if (file.size > MAX_SIZE) { alert('檔案大小不可超過 10MB'); continue }
      const path = `expense-requests/${requestId}/${stage}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
      if (upErr) continue
      const { data } = await supabase.from('expense_request_attachments').insert({
        request_id: requestId,
        file_name: file.name,
        storage_path: path,
        file_size: file.size,
        file_type: file.type,
        stage,
        uploaded_by: form.employee || '系統',
      }).select().single()
      if (data) results.push(data)
    }
    return results
  }

  // 進入「編輯重送」模式（駁回後申請人想改內容再送出）
  const openEditResubmit = (req) => {
    setEditingId(req.id)
    setForm({
      employee: req.employee || '',
      account_code: req.account_code || '',
      title: req.title || '',
      description: req.description || '',
      estimated_amount: req.estimated_amount?.toString() || '',
      store: req.store || '',
      supplier: req.supplier || '',
    })
    const items = Array.isArray(req.items) && req.items.length > 0
      ? req.items.map(it => ({
          name: it.name || '',
          qty: it.qty?.toString() || '',
          unit_price: it.unit_price?.toString() || '',
          subtotal: Number(it.subtotal) || (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
        }))
      : [emptyItem()]
    setLineItems(items)
    setIsExpense(true)
    setFiles([])
    setShowModal(true)
  }

  // Submit new request OR re-submit edited request
  const handleSubmit = async () => {
    const validItems = lineItems.filter(li => li.name && li.qty > 0)
    const total = validItems.length > 0 ? validItems.reduce((s, li) => s + (li.subtotal || 0), 0) : Number(form.estimated_amount)
    // 把 total（合計金額）也納入驗證
    const validateForm = { ...form, _total: total }
    if (!validateRequired(validateForm, ['employee', 'account_code', 'title', '_total'], setErrors)) return
    setSaving(true)
    const emp = employees.find(e => e.name === form.employee)
    const acc = accounts.find(a => a.code === form.account_code)
    const payload = {
      employee: form.employee,
      employee_id: emp?.id || null,
      department: emp?.dept || null,
      account_code: form.account_code,
      account_name: acc?.name || '',
      title: form.title,
      description: form.description || null,
      estimated_amount: total,
      supplier: form.supplier || null,
      items: validItems,
      store: form.store || null,
      organization_id: profile?.organization_id ?? null,
    }
    if (!payload.organization_id) {
      setError('身份未載入完成，請重新登入再操作')
      setSaving(false)
      return
    }

    // ── 編輯重送路徑 ──
    if (editingId) {
      const { error: updErr } = await supabase.from('expense_requests')
        .update({ ...payload, status: '申請中', reject_reason: null })
        .eq('id', editingId)
      if (updErr) { setError(updErr.message); setSaving(false); return }

      if (files.length > 0) {
        await uploadFiles(editingId, files, 'request')
      }

      // 重啟對應 workflow_instance 的駁回那關 → DB trigger 自動推 LINE
      try {
        const { data: rpcResult, error: rpcErr } = await supabase.rpc('resume_workflow_for_request', {
          p_type: 'expense_request',
          p_id: editingId,
        })
        if (rpcErr) console.error('[resume_workflow] error:', rpcErr)
        else console.log('[resume_workflow] result:', rpcResult)
      } catch (e) { console.error('[resume_workflow] failed:', e) }

      setSaving(false)
      setShowModal(false)
      setForm(emptyForm)
      setLineItems([emptyItem()])
      setFiles([])
      setEditingId(null)
      load()
      return
    }

    // ── 新增路徑（原邏輯）──
    payload.status = '申請中'
    const { data, error: insertErr } = await supabase.from('expense_requests').insert(payload).select().single()
    if (insertErr) { setError(insertErr.message); setSaving(false); return }

    // Upload attachments
    if (files.length > 0 && data) {
      await uploadFiles(data.id, files, 'request')
    }

    // Create approval workflow + 把 instance.id 寫回 expense_request 建立雙向 link
    if (data) {
      try {
        const wfResult = await createApprovalWorkflow('expense_request', data, form.employee)
        if (wfResult?.error) console.error('[createApprovalWorkflow] error:', wfResult.error)
        if (wfResult?.instance?.id) {
          await supabase.from('expense_requests')
            .update({ workflow_instance_id: wfResult.instance.id })
            .eq('id', data.id)
        }
      } catch (e) { console.error('[createApprovalWorkflow] failed:', e) }
    }

    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setLineItems([emptyItem()])
    setFiles([])
    load()
  }

  // ★ 直接用 expense_request.workflow_instance_id FK（剛加的 schema），精準對應
  //   舊資料 (workflow_instance_id 為 NULL) fallback 到「最近一筆同人進行中」模糊匹配
  const resolveLinkedInstanceId = async (req) => {
    if (req.workflow_instance_id) return req.workflow_instance_id
    if (!profile?.organization_id) return null
    const { data } = await supabase.from('workflow_instances')
      .select('id, started_at')
      .eq('organization_id', profile.organization_id)
      .eq('template_name', '費用申請簽核')
      .eq('started_by', req.employee)
      .eq('status', '進行中')
      .order('started_at', { ascending: false })
      .limit(1)
    return data?.[0]?.id || null
  }

  const handleApprove = async (req) => {
    const instId = await resolveLinkedInstanceId(req)
    if (instId) {
      const { data: pendingSteps } = await supabase.from('tasks')
        .select('*').eq('workflow_instance_id', instId).eq('status', '待處理')
        .order('step_order').limit(1)
      const pendingStep = pendingSteps?.[0]
      if (pendingStep) {
        const result = await advanceWorkflow(pendingStep.id, profile?.name || '管理員', '核准')
        if (result?.error) { setError(result.error); return }
        // advanceWorkflow handles writeBackStatus (expense approved) and workflow_instance update
        load()
        return
      }
    }
    // Fallback: no linked workflow — direct approve
    const { error } = await supabase.from('expense_requests')
      .update({ status: '已核准', approved_by: profile?.name || '管理員', approved_at: new Date().toISOString() })
      .eq('id', req.id)
    if (error) { setError(error.message); return }
    load()
  }

  const handleReject = async (req) => {
    const reason = prompt('駁回原因：')
    if (!reason) return
    const instId = await resolveLinkedInstanceId(req)
    if (instId) {
      const { data: pendingSteps } = await supabase.from('tasks')
        .select('*').eq('workflow_instance_id', instId).eq('status', '待處理')
        .order('step_order').limit(1)
      const pendingStep = pendingSteps?.[0]
      if (pendingStep) {
        const result = await advanceWorkflow(pendingStep.id, profile?.name || '管理員', '退回', reason)
        if (result?.error) { setError(result.error); return }
        load()
        return
      }
    }
    // Fallback: no linked workflow — direct reject
    const { error } = await supabase.from('expense_requests')
      .update({ status: '已駁回', reject_reason: reason })
      .eq('id', req.id)
    if (error) { setError(error.message); return }
    load()
  }

  // Open settle modal
  const openSettle = (req) => {
    setShowDetail(req)
    setSettleForm({ actual_amount: req.estimated_amount, notes: '' })
    setSettleFiles([])
    setShowSettleModal(true)
  }

  // Submit settlement
  const handleSettle = async () => {
    if (!settleForm.actual_amount) return
    setSaving(true)
    const req = showDetail
    const { error: upErr } = await supabase.from('expense_requests')
      .update({
        actual_amount: Number(settleForm.actual_amount),
        notes: settleForm.notes || null,
        status: '待核銷',
      }).eq('id', req.id)
    if (upErr) { setError(upErr.message); setSaving(false); return }

    // Upload settlement attachments (receipts)
    if (settleFiles.length > 0) {
      await uploadFiles(req.id, settleFiles, 'settlement')
    }

    setSaving(false)
    setShowSettleModal(false)
    load()
  }

  // Finance confirms settlement
  const handleConfirmSettle = async (req) => {
    // Create journal entry
    try {
      const amount = req.actual_amount || req.estimated_amount
      await supabase.rpc('secure_create_journal_entry', {
        p_entry_date: new Date().toISOString().slice(0, 10),
        p_description: `費用申請核銷 - ${req.employee} (${req.title})`,
        p_lines: [
          { account_code: req.account_code, account_name: req.account_name, debit: amount, credit: 0, memo: `申請單 #${req.id}` },
          { account_code: '1100', account_name: '現金', debit: 0, credit: amount, memo: '' },
        ],
        p_source: '費用申請',
        p_source_id: req.id,
        p_created_by: profile?.name || '財務',
      })
    } catch { /* journal entry is optional */ }

    const { error } = await supabase.from('expense_requests')
      .update({ status: '已核銷', settled_by: profile?.name || '財務', settled_at: new Date().toISOString() })
      .eq('id', req.id)
    if (error) setError(error.message)
    else load()
  }

  // View attachment
  const viewFile = (att) => {
    const { data } = supabase.storage.from('attachments').getPublicUrl(att.storage_path)
    if (data?.publicUrl) window.open(data.publicUrl, '_blank')
  }

  const deleteFile = async (att) => {
    if (profile?.role !== 'admin' && profile?.role !== 'super_admin' && att.uploaded_by !== profile?.name) {
      alert('僅能刪除自己上傳的檔案')
      return
    }
    if (!confirm(`刪除 ${att.file_name}？`)) return
    await supabase.storage.from('attachments').remove([att.storage_path])
    await supabase.from('expense_request_attachments').delete().eq('id', att.id)
    setAttachments(prev => ({
      ...prev,
      [att.request_id]: (prev[att.request_id] || []).filter(a => a.id !== att.id),
    }))
  }

  // Filter
  const filtered = requests.filter(r => {
    if (tab === 'all') return true
    return r.status === tab
  })

  const counts = {}
  requests.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1 })

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📝</span> 申請（申請與核銷）</h2>
            <p>事項 / 採購 / 預算申請：先申請核准，發生費用後再核銷入帳</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm(emptyForm); setLineItems([emptyItem()]); setIsExpense(true); setFiles([]); setShowModal(true) }}>
            <Plus size={14} /> 新增申請
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
        {['申請中', '已核准', '待核銷', '已核銷', '已駁回'].map(s => (
          <div key={s} className="card" style={{ padding: '12px 16px', cursor: 'pointer', border: tab === s ? `2px solid ${STATUS_COLORS[s].color}` : undefined }}
            onClick={() => setTab(tab === s ? 'all' : s)}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: STATUS_COLORS[s].color }}>{counts[s] || 0}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>申請人</th>
              <th>科目</th>
              <th>項目</th>
              <th style={{ textAlign: 'right' }}>預估金額</th>
              <th style={{ textAlign: 'right' }}>實際金額</th>
              <th>狀態</th>
              <th>日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>無資料</td></tr>}
            {filtered.map(r => {
              const sc = STATUS_COLORS[r.status] || {}
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.employee}</td>
                  <td><span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.account_code}</span> {r.account_name}</td>
                  <td style={{ fontWeight: 500 }}>{r.title}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.estimated_amount)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {r.actual_amount != null ? fmt(r.actual_amount) : '-'}
                    {r.difference != null && r.difference !== 0 && (
                      <span style={{ fontSize: 11, color: r.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)', marginLeft: 4 }}>
                        ({r.difference > 0 ? '+' : ''}{fmt(r.difference)})
                      </span>
                    )}
                  </td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>{r.status}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.created_at?.slice(0, 10)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => { setShowDetail(r); loadAttachments(r.id) }}>
                        <Eye size={12} />
                      </button>
                      {r.status === '申請中' && (
                        <>
                          <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => handleApprove(r)}>
                            <Check size={12} /> 核准
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => handleReject(r)}>
                            <X size={12} />
                          </button>
                        </>
                      )}
                      {r.status === '已核准' && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => openSettle(r)}>
                          <Send size={12} /> 核銷
                        </button>
                      )}
                      {r.status === '待核銷' && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-cyan)' }} onClick={() => handleConfirmSettle(r)}>
                          <Check size={12} /> 確認
                        </button>
                      )}
                      {(r.status === '已駁回' || r.status === '已退回') && r.employee === profile?.name && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-orange)' }} onClick={() => openEditResubmit(r)}>
                          ✏️ 編輯重送
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* New Request Modal */}
      {showModal && (
        <ModalOverlay onClose={() => { setShowModal(false); setErrors({}) }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 520, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '✏️ 編輯重送（駁回後修改）' : '新增申請（事項 / 採購 / 預算）'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => { setShowModal(false); setErrors({}) }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className={errors.employee ? 'field-error' : undefined}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>申請人 *</label>
                <SearchableSelect
                  value={form.employee}
                  onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
                  options={empOptions(employees, { keyBy: 'name' })}
                  placeholder="搜尋申請人姓名/部門/門市..."
                />
                {errors.employee && <div className="field-error-msg">⚠ 請選擇申請人</div>}
              </div>
              {/* Expense / Non-expense toggle */}
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>申請類型</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[{ val: true, label: '費用' }, { val: false, label: '非費用' }].map(opt => (
                    <button key={String(opt.val)} type="button"
                      onClick={() => { setIsExpense(opt.val); set('account_code', '') }}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        background: isExpense === opt.val ? 'var(--accent-blue)' : 'var(--bg-main)',
                        color: isExpense === opt.val ? '#fff' : 'var(--text-secondary)',
                        border: isExpense === opt.val ? 'none' : '1px solid var(--border)',
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={errors.account_code ? 'field-error' : undefined}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>會計科目 *</label>
                <select value={form.account_code} onChange={e => { set('account_code', e.target.value); clearError('account_code', setErrors) }}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">請選擇科目</option>
                  {Object.entries(
                    accounts.filter(a => isExpense ? a.type === '費用' : a.type !== '費用')
                      .reduce((groups, a) => {
                        const group = a.parent_code ? `${a.type} ─ 子科目` : a.type || '其他'
                        if (!groups[group]) groups[group] = []
                        groups[group].push(a)
                        return groups
                      }, {})
                  ).map(([group, items]) => (
                    <optgroup key={group} label={`── ${group} ──`}>
                      {items.map(a => (
                        <option key={a.id} value={a.code}>
                          {a.parent_code ? '  └ ' : ''}{a.code}  {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {errors.account_code && <div className="field-error-msg">⚠ 請選擇會計科目</div>}
              </div>
              <div className={errors.title ? 'field-error' : undefined}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>項目名稱 *</label>
                <input type="text" value={form.title} onChange={e => { set('title', e.target.value); clearError('title', setErrors) }} placeholder="例：採購辦公椅 x5"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                {errors.title && <div className="field-error-msg">⚠ 請填寫項目名稱</div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>供應商/廠商</label>
                  <input type="text" value={form.supplier} onChange={e => set('supplier', e.target.value)} placeholder="選填"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>門市</label>
                  <input type="text" value={form.store} onChange={e => set('store', e.target.value)} placeholder="選填"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>

              {/* Line items */}
              <div className={errors._total ? 'field-error' : undefined}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>品項明細 *</label>
                {errors._total && <div className="field-error-msg" style={{ marginBottom: 4 }}>⚠ 請至少填一個品項（含數量 &gt; 0）</div>}
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-main)' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>品名</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 70 }}>數量</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 90 }}>單價</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 90 }}>小計</th>
                        <th style={{ width: 32 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((li, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 4 }}><input type="text" value={li.name} onChange={e => updateItem(i, 'name', e.target.value)} placeholder="品名" style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-main)', fontSize: 12 }} /></td>
                          <td style={{ padding: 4 }}><input type="number" value={li.qty} onChange={e => updateItem(i, 'qty', e.target.value)} placeholder="0" style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-main)', fontSize: 12, textAlign: 'right' }} /></td>
                          <td style={{ padding: 4 }}><input type="number" value={li.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} placeholder="0" style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-main)', fontSize: 12, textAlign: 'right' }} /></td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{li.subtotal ? fmt(li.subtotal) : '-'}</td>
                          <td style={{ padding: 4 }}>
                            {lineItems.length > 1 && <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }} onClick={() => setLineItems(items => items.filter((_, j) => j !== i))}><X size={14} /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td colSpan={3} style={{ padding: '6px 8px' }}>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setLineItems(items => [...items, emptyItem()])}><Plus size={11} /> 新增品項</button>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', fontSize: 14, color: 'var(--accent-blue)' }}>{fmt(lineTotal)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>說明</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="用途、規格..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 50, resize: 'vertical' }} />
              </div>
              {/* File upload */}
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>附件（訂購單、報價單...）</label>
                <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])}
                  style={{ display: 'none' }} />
                <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} style={{ fontSize: 12 }}>
                  <Upload size={12} /> 選擇檔案
                </button>
                {files.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                        {f.type?.startsWith('image') ? <Image size={12} /> : <FileText size={12} />}
                        {f.name}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}
                          onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => { setShowModal(false); setErrors({}) }}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '提交中...' : '提交申請'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Settlement Modal */}
      {showSettleModal && showDetail && (
        <ModalOverlay onClose={() => setShowSettleModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 480, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>核銷：{showDetail.title}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowSettleModal(false)}><X size={20} /></button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              預估金額：<strong>{fmt(showDetail.estimated_amount)}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>實際金額 *</label>
                <input type="number" value={settleForm.actual_amount} onChange={e => setSettleForm(f => ({ ...f, actual_amount: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>備註</label>
                <textarea value={settleForm.notes} onChange={e => setSettleForm(f => ({ ...f, notes: e.target.value }))} placeholder="選填"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 60, resize: 'vertical' }} />
              </div>
              {/* Receipt upload */}
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>收據/發票附件</label>
                <input ref={settleFileRef} type="file" multiple accept="image/*,.pdf"
                  onChange={e => setSettleFiles(prev => [...prev, ...Array.from(e.target.files)])}
                  style={{ display: 'none' }} />
                <button className="btn btn-secondary" onClick={() => settleFileRef.current?.click()} style={{ fontSize: 12 }}>
                  <Upload size={12} /> 上傳收據
                </button>
                {settleFiles.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {settleFiles.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                        {f.type?.startsWith('image') ? <Image size={12} /> : <FileText size={12} />}
                        {f.name}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}
                          onClick={() => setSettleFiles(prev => prev.filter((_, j) => j !== i))}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowSettleModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSettle} disabled={saving}>{saving ? '提交中...' : '提交核銷'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Detail Modal */}
      {showDetail && !showSettleModal && (
        <ModalOverlay onClose={() => setShowDetail(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 520, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>申請詳情 #{showDetail.id}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowDetail(null)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>申請人：</span><strong>{showDetail.employee}</strong></div>
                <div><span style={{ color: 'var(--text-muted)' }}>部門：</span>{showDetail.department || '-'}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>科目：</span>{showDetail.account_code} {showDetail.account_name}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>門市：</span>{showDetail.store || '-'}</div>
                {showDetail.supplier && <div><span style={{ color: 'var(--text-muted)' }}>供應商：</span><strong>{showDetail.supplier}</strong></div>}
              </div>
              <div><span style={{ color: 'var(--text-muted)' }}>項目：</span><strong>{showDetail.title}</strong></div>
              {showDetail.description && <div><span style={{ color: 'var(--text-muted)' }}>說明：</span>{showDetail.description}</div>}

              {/* Line items table */}
              {showDetail.items?.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-main)' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>品名</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>數量</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>單價</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>小計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {showDetail.items.map((li, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 8px' }}>{li.name}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}>{li.qty}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(li.unit_price)}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(li.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td colSpan={3} style={{ padding: '6px 8px', fontWeight: 700 }}>合計</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent-blue)' }}>{fmt(showDetail.estimated_amount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, background: 'var(--bg-main)', padding: 12, borderRadius: 8 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>預估金額</div><div style={{ fontWeight: 700 }}>{fmt(showDetail.estimated_amount)}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>實際金額</div><div style={{ fontWeight: 700 }}>{showDetail.actual_amount != null ? fmt(showDetail.actual_amount) : '-'}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>差異</div><div style={{ fontWeight: 700, color: showDetail.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{showDetail.difference != null ? fmt(showDetail.difference) : '-'}</div></div>
              </div>
              {showDetail.reject_reason && <div style={{ color: 'var(--accent-red)' }}>駁回原因：{showDetail.reject_reason}</div>}
              {showDetail.notes && <div><span style={{ color: 'var(--text-muted)' }}>核銷備註：</span>{showDetail.notes}</div>}

              {/* Attachments */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>附件</div>
                {(attachments[showDetail.id] || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>無附件</div>
                ) : (attachments[showDetail.id] || []).map(att => (
                  <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                    {att.file_type?.startsWith('image') ? <Image size={14} color="var(--accent-blue)" /> : <FileText size={14} color="var(--accent-yellow)" />}
                    <span style={{ flex: 1 }}>{att.file_name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{att.stage === 'settlement' ? '核銷' : '申請'}</span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-blue)' }} onClick={() => viewFile(att)}><Eye size={13} /></button>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }} onClick={() => deleteFile(att)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={async () => {
                // 把附件即時撈一份（圖檔會內嵌進簽呈 PDF）
                const { data: atts } = await supabase.from('expense_request_attachments')
                  .select('file_name, storage_path, file_type')
                  .eq('request_id', showDetail.id)
                  .order('created_at')
                const attachments = (atts || []).map(a => ({
                  url: supabase.storage.from('attachments').getPublicUrl(a.storage_path).data?.publicUrl,
                  name: a.file_name,
                  type: a.file_type,
                }))
                // 簽章 map：所有有上傳簽章的員工
                const signatures = Object.fromEntries(
                  employees.filter(e => e.signature_url).map(e => [e.name, e.signature_url])
                )
                // chain：抓該單實際 workflow 步驟
                const empRow = employees.find(e => e.name === showDetail.employee)
                const chainSteps = await buildWorkflowChainSteps({
                  templateName: '費用申請簽核',
                  applicantName: showDetail.employee,
                  applicantId: empRow?.id,
                  applicantCreatedAt: showDetail.created_at,
                  recordStatus: showDetail.status,
                  approverName: showDetail.approved_by,
                  approvedAt: showDetail.approved_at,
                  rejectReason: showDetail.reject_reason,
                  fallbackTail: ['財務核章'],
                })
                const approverMap = {}
                chainSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
                exportExpenseRequestPdf(showDetail, {
                  companyName: organization?.name,
                  logoUrl: organization?.logo_url,
                  attachments,
                  signatures,
                  chainSteps,
                  approverMap,
                })
              }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Download size={13} /> 下載簽呈
              </button>
              <button className="btn btn-secondary" onClick={() => setShowDetail(null)}>關閉</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
