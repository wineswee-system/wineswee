import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { ModalOverlay } from '../../components/Modal'
import { Plus, X, Check, Upload, FileText, Image, Send, Settings } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getAccounts, getEmployees } from '../../lib/db'
import { exportExpenseRequestPdf } from '../../lib/exportPdf'
import { createApprovalWorkflow, advanceWorkflow } from '../../lib/workflowIntegration'
import { buildChainBasedSteps } from '../../lib/buildChainSteps'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { validateRequired, clearError } from '../../lib/formValidation'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { usePendingApprovals } from '../../lib/usePendingApprovals'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const STATUS_COLORS = {
  '申請中': { bg: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' },
  '已核准': { bg: 'var(--accent-green-dim)', color: 'var(--accent-green)' },
  '待核銷': { bg: 'var(--accent-yellow-dim)', color: 'var(--accent-yellow)' },
  '已核銷': { bg: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' },
  '已駁回': { bg: 'var(--accent-red-dim)', color: 'var(--accent-red)' },
  '核銷已退回': { bg: 'var(--accent-red-dim)', color: 'var(--accent-red)' },
}

const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '-'

const emptyForm = {
  employee: '', account_code: '', title: '', description: '',
  estimated_amount: '', store: '', supplier: '',
}

const emptyItem = () => ({ name: '', qty: '', unit_price: '', subtotal: 0 })

export default function ExpenseRequests() {
  const { profile, isAdmin } = useAuth()
  const { canApprove } = usePendingApprovals()
  const navigate = useNavigate()
  const [requests, setRequests] = useState([])
  const [accounts, setAccounts] = useState([])
  const [employees, setEmployees] = useState([])
  const [organization, setOrganization] = useState(null)  // { name, logo_url } — 印簽呈用
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showSettleModal, setShowSettleModal] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)
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
    let reqQuery = supabase.from('expense_requests').select('*').order('created_at', { ascending: false })
    if (orgId) reqQuery = reqQuery.eq('organization_id', orgId)
    const [reqRes, accRes, empRes, orgRes] = await Promise.all([
      reqQuery,
      getAccounts(orgId),
      getEmployees(orgId),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setRequests(reqRes.data || [])
    setAccounts(accRes.data || [])
    setEmployees((empRes.data || []).filter(e => e.status === '在職'))
    setOrganization(orgRes?.data || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [profile?.organization_id])

  // Load attachments for detail view
  const loadAttachments = async (requestId) => {
    const { data } = await supabase.from('expense_request_attachments')
      .select('*').eq('request_id', requestId).order('created_at')
    setAttachments(prev => ({ ...prev, [requestId]: data || [] }))
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  const MAX_SIZE = 10 * 1024 * 1024 // 10MB

  // 把檔名清成 storage 接受的 ASCII 安全格式（保留原檔名給 DB / UI 顯示）
  // Supabase Storage 不接受中文 / 空格 / 全形符號當 key
  const safeStorageName = (name) => {
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '') : 'bin'
    const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'file'
    return `${safe}.${ext}`
  }

  // Upload files to Supabase Storage
  const uploadFiles = async (requestId, fileList, stage = 'request') => {
    const results = []
    for (const file of fileList) {
      if (!ALLOWED_TYPES.includes(file.type)) { toast.error(`「${file.name}」不支援此檔案類型`); continue }
      if (file.size > MAX_SIZE) { toast.error(`「${file.name}」檔案大小超過 10MB`); continue }
      const path = `expense-requests/${requestId}/${stage}/${Date.now()}_${safeStorageName(file.name)}`
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
      if (upErr) {
        toast.error(`「${file.name}」上傳失敗：${upErr.message || '未知錯誤'}`)
        console.error('[uploadFiles] storage upload error:', upErr)
        continue
      }
      const { data, error: insertErr } = await supabase.from('expense_request_attachments').insert({
        request_id: requestId,
        file_name: file.name,
        storage_path: path,
        file_size: file.size,
        file_type: file.type,
        stage,
        uploaded_by: form.employee || '系統',
      }).select().single()
      if (insertErr) {
        toast.error(`「${file.name}」寫入失敗：${insertErr.message || '未知錯誤'}`)
        console.error('[uploadFiles] db insert error:', insertErr)
        continue
      }
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
    // 把 total（合計金額）也納入驗證 — _total 必須 > 0，所以用 zeroInvalid: true
    const validateForm = { ...form, _total: total }
    if (!validateRequired(validateForm, ['employee', 'account_code', 'title', '_total'], setErrors, { zeroInvalid: true })) return
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

  // ★ 走 chain step-by-step 推進（呼 expense_request_step_advance RPC）
  // RPC 會驗證 caller 是否對應目前 chain step，通過才推進；最後一關才標 '已核准'
  // 沒綁 chain → RPC 自動 fallback 到舊單關行為
  const handleApprove = async (req) => {
    const { data, error } = await supabase.rpc('expense_request_step_advance', {
      p_id: req.id, p_action: 'approve', p_reason: null,
    })
    if (error) { setError(error.message); return }
    if (!data?.ok) {
      const msg = {
        NOT_AUTHENTICATED: '尚未登入',
        EMPLOYEE_NOT_FOUND: '找不到員工資料（auth_user_id 沒綁）',
        NOT_FOUND: '找不到此申請',
        NOT_PENDING: `此申請目前狀態 ${data.current_status}，無法核准`,
        STEP_NOT_FOUND: `chain 第 ${data.current_step + 1} 關沒設定`,
        NOT_AUTHORIZED_FOR_STEP: `你不是目前這關的簽核者（第 ${data.current_step + 1} 關需要 ${data.expected_role}）`,
      }[data?.error] || `核准失敗：${data?.error || 'unknown'}`
      toast.error(msg); return
    }
    if (data.fully_approved) {
      toast.success('已通過全部簽核關卡')
    } else {
      toast.success(`已通過第 ${data.advanced_to_step} 關，等下一關簽核`)
    }
    load()
  }

  const handleReject = async (req) => {
    const reason = prompt('駁回原因：')
    if (!reason || !reason.trim()) return
    const { data, error } = await supabase.rpc('expense_request_step_advance', {
      p_id: req.id, p_action: 'reject', p_reason: reason.trim(),
    })
    if (error) { setError(error.message); return }
    if (!data?.ok) {
      toast.error(`退回失敗：${data?.error || 'unknown'}`)
      return
    }
    load()
  }

  // Open settle modal
  const openSettle = (req) => {
    setShowDetail(req)
    // 重新核銷：保留原本填的金額；首次核銷：以申請金額為預設值
    setSettleForm({
      actual_amount: req.actual_amount ?? req.estimated_amount,
      notes: req.notes || '',
    })
    setSettleFiles([])
    setShowSettleModal(true)
  }

  // Open detail modal: load attachments + build 2-stage chain steps
  const openDetail = async (req) => {
    detailRowIdRef.current = req.id
    setShowDetail(req)
    loadAttachments(req.id)
    setLoadingChain(true)
    setDetailChainSteps([])

    const isPending  = req.status === '待核銷'
    const isSettled  = req.status === '已核銷'
    const inSettleStage = isPending || isSettled

    // 預抓 chain steps 對應的 employee 名字 → approverMap，傳給 buildChainBasedSteps
    let approverMap = {}
    if (req.approval_chain_id) {
      const { data: rawSteps } = await supabase
        .from('approval_chain_steps')
        .select('target_emp_id')
        .eq('chain_id', req.approval_chain_id)
      const empIds = [...new Set((rawSteps || []).map(s => s.target_emp_id).filter(Boolean))]
      if (empIds.length > 0) {
        const { data: emps } = await supabase.from('employees').select('id, name').in('id', empIds)
        approverMap = Object.fromEntries((emps || []).map(e => [e.id, e.name]))
      }
    }

    // 餵 buildChainBasedSteps：用 row.current_step（新加的欄位）真實推進度
    // 沒 chain → buildChainBasedSteps 自己 fallback 給「主管核示」單關
    const fakeRow = {
      approval_chain_id: req.approval_chain_id || null,
      current_step: req.current_step || 0,
      // ★ 必須帶 employee_id 給 get_chain_step_display_names 解動態 target（applicant_dept_manager 等）
      employee_id: req.employee_id,
      // 待核銷 視為 chain 全完，讓 buildChainBasedSteps 把所有 chain step 標 completed
      status: req.status === '待核銷' ? '已核准' : req.status,
      approved_at: req.approved_at,
      reject_reason: req.reject_reason,
      approver: req.approved_by ? { name: req.approved_by } : null,
    }

    let baseSteps = []
    try {
      baseSteps = await buildChainBasedSteps({
        row: fakeRow,
        applicantName: req.employee,
        applicantCreatedAt: req.created_at,
        approverMap,
      })
    } catch (e) {
      console.error('buildChainBasedSteps failed:', e)
    }

    // 「財務核章」只在實際進入核銷階段（待核銷/已核銷）才顯示。
    // 沒設核銷需求 / chain 是最終決定的流程，不顯示這關。
    let finalSteps = baseSteps
    if (inSettleStage) {
      finalSteps = [...baseSteps, {
        label: '財務核章',
        name: isSettled ? (req.settled_by || '') : '',
        status: isSettled ? 'completed' : 'current',
        completedAt: isSettled ? req.settled_at : undefined,
        archival: false,
      }]
    }

    if (detailRowIdRef.current !== req.id) return
    setDetailChainSteps(finalSteps)
    setLoadingChain(false)
  }

  // Submit settlement
  const handleSettle = async () => {
    if (!validateRequired(settleForm, ['actual_amount'], setErrors)) return
    setSaving(true)
    const req = showDetail
    // 重新核銷：清掉 settle_chain_id + reject_reason，讓 trigger 依新金額重抓 chain
    const isResubmit = req.status === '核銷已退回'
    const { error: upErr } = await supabase.from('expense_requests')
      .update({
        actual_amount: Number(settleForm.actual_amount),
        notes: settleForm.notes || null,
        status: '待核銷',
        ...(isResubmit && {
          settle_chain_id: null,
          settle_current_step: 0,
          settle_reject_reason: null,
          settled_by: null,
          settled_at: null,
        }),
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

  // 核銷簽核：呼叫 RPC 推 settle chain 一步；最後一關通過 → 開分錄 + 已核銷
  // 沒掛 settle_chain_id 時 RPC 內 fallback：直接 confirm（舊行為，admin 一鍵）
  const handleConfirmSettle = async (req) => {
    const { data, error } = await supabase.rpc('expense_settle_step_advance', {
      p_id: req.id,
      p_action: 'approve',
      p_reason: null,
    })
    if (error) { toast.error(error.message); return }
    if (!data?.ok) {
      const map = {
        NOT_AUTHENTICATED: '尚未登入',
        EMPLOYEE_NOT_FOUND: '找不到對應員工',
        NOT_FOUND: '找不到此申請單',
        NOT_PENDING_SETTLE: `狀態不是待核銷（${data?.current_status}）`,
        NOT_AUTHORIZED_FOR_STEP: '此關不是你負責',
        STEP_NOT_FOUND: 'chain step 設定異常',
      }
      toast.error(map[data?.error] || data?.error || '核銷失敗')
      return
    }
    toast.success(data.fully_settled ? '核銷完成' : `推進到下一關（第 ${data.advanced_to_step + 1} 關）`)
    load()
  }

  // 核銷簽核：駁回
  const handleRejectSettle = async (req) => {
    const reason = window.prompt('退回原因？')
    if (!reason || !reason.trim()) return
    const { data, error } = await supabase.rpc('expense_settle_step_advance', {
      p_id: req.id,
      p_action: 'reject',
      p_reason: reason.trim(),
    })
    if (error) { toast.error(error.message); return }
    if (!data?.ok) { toast.error(data?.error || '駁回失敗'); return }
    toast.success('已退回')
    load()
  }

  // View attachment
  const viewFile = (att) => {
    const { data } = supabase.storage.from('attachments').getPublicUrl(att.storage_path)
    if (data?.publicUrl) window.open(data.publicUrl, '_blank')
  }

  const deleteFile = async (att) => {
    if (!isAdmin && att.uploaded_by !== profile?.name) {
      toast.error('僅能刪除自己上傳的檔案')
      return
    }
    if (!(await confirm({ message: `刪除 ${att.file_name}？` }))) return
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
          <div style={{ display: 'flex', gap: 8 }}>
            {isAdmin && (
              <>
                <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=expense_request&label=費用申請&mode=amount_grouped')} title="設定費用申請的金額分組簽核流程">
                  <Settings size={14} /> 申請簽核
                </button>
                <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=expense_settle&label=費用核銷&mode=amount_grouped')} title="設定費用核銷的金額分組簽核流程">
                  <Settings size={14} /> 核銷簽核
                </button>
              </>
            )}
            <button className="btn btn-primary" onClick={() => {
              setEditingId(null)
              setForm({ ...emptyForm, employee: profile?.name || '' })
              setLineItems([emptyItem()])
              setIsExpense(true)
              setFiles([])
              setErrors({})
              setShowModal(true)
            }}>
              <Plus size={14} /> 新增申請
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
        {['申請中', '已核准', '待核銷', '已核銷', '已駁回', '核銷已退回'].map(s => (
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
                <tr key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細">
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
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {r.status === '申請中' && canApprove('expense_requests', r.id) && (
                        <>
                          <AsyncButton className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => handleApprove(r)} busyLabel="處理中…">
                            <Check size={12} /> 核准
                          </AsyncButton>
                          <AsyncButton className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => handleReject(r)} busyLabel="…">
                            <X size={12} />
                          </AsyncButton>
                        </>
                      )}
                      {r.status === '已核准' && r.employee_id === profile?.id && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => openSettle(r)}>
                          <Send size={12} /> 核銷
                        </button>
                      )}
                      {r.status === '待核銷' && canApprove('expense_settles', r.id) && (
                        <>
                          <AsyncButton className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-cyan)' }} onClick={() => handleConfirmSettle(r)} busyLabel="…">
                            <Check size={12} /> 核准
                          </AsyncButton>
                          <AsyncButton className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => handleRejectSettle(r)} busyLabel="…">
                            <X size={12} />
                          </AsyncButton>
                        </>
                      )}
                      {r.status === '核銷已退回' && r.employee === profile?.name && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-orange)' }} onClick={() => openSettle(r)}>
                          ✏️ 重新核銷
                        </button>
                      )}
                      {['申請中','待審','已駁回','已退回'].includes(r.status) && r.employee === profile?.name && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-orange)' }} onClick={() => openEditResubmit(r)}>
                          ✏️ {(r.status === '已駁回' || r.status === '已退回') ? '編輯重送' : '編輯'}
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
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, width: 520, maxHeight: '80vh', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
              <h3 style={{ margin: 0 }}>{editingId ? '✏️ 編輯重送（駁回後修改）' : '新增申請（事項 / 採購 / 預算）'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => { setShowModal(false); setErrors({}) }}><X size={20} /></button>
            </div>
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className={errors.employee ? 'field-error' : undefined}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>申請人 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
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
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>會計科目 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
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
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>項目名稱 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
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
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>品項明細 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
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
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
              <button className="btn btn-secondary" onClick={() => { setShowModal(false); setErrors({}) }}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '提交中...' : '提交申請'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Settlement Modal */}
      {showSettleModal && showDetail && (
        <ModalOverlay onClose={() => { setShowSettleModal(false); setErrors({}); setSettleFiles([]) }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, width: 480, maxHeight: '80vh', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
              <h3 style={{ margin: 0 }}>核銷：{showDetail.title}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => { setShowSettleModal(false); setErrors({}); setSettleFiles([]) }}><X size={20} /></button>
            </div>
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              預估金額：<strong>{fmt(showDetail.estimated_amount)}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className={errors.actual_amount ? 'field-error' : undefined}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>實際金額 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
                <input type="number" value={settleForm.actual_amount} onChange={e => { setSettleForm(f => ({ ...f, actual_amount: e.target.value })); clearError('actual_amount', setErrors) }}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                {errors.actual_amount && <div className="field-error-msg">⚠ 請填寫實際金額</div>}
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
            </div>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
              <button className="btn btn-secondary" onClick={() => { setShowSettleModal(false); setErrors({}); setSettleFiles([]) }}>取消</button>
              <button className="btn btn-primary" onClick={handleSettle} disabled={saving}>{saving ? '提交中...' : '提交核銷'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Detail Modal — split layout 與其他簽核表單一致 */}
      {showDetail && !showSettleModal && (() => {
        const empRow = employees.find(e => e.name === showDetail.employee)
        const fields = [
          { label: '部門', value: showDetail.department || '—' },
          { label: '科目', value: `${showDetail.account_code || ''} ${showDetail.account_name || ''}`.trim() || '—' },
          { label: '門市', value: showDetail.store || '—' },
          { label: '供應商', value: showDetail.supplier || '—' },
          { label: '項目', value: showDetail.title || '—' },
          ...(showDetail.description ? [{ label: '說明', value: showDetail.description, multiline: true }] : []),
        ]

        // 明細表格 — 始終顯示，無品項時顯示空白提示
        fields.push({
          label: '品項明細',
          value: (
            <div style={{ border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>品名</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>數量</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>單價</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>小計</th>
                  </tr>
                </thead>
                <tbody>
                  {showDetail.items?.length > 0
                    ? showDetail.items.map((li, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '4px 8px' }}>{li.name}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}>{li.qty}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(li.unit_price)}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(li.subtotal)}</td>
                        </tr>
                      ))
                    : (
                        <tr>
                          <td colSpan={4} style={{ padding: '8px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>無品項明細</td>
                        </tr>
                      )
                  }
                </tbody>
              </table>
            </div>
          ),
        })

        // 三欄金額卡片
        fields.push({
          label: '金額',
          value: (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>預估金額</div><div style={{ fontWeight: 700 }}>{fmt(showDetail.estimated_amount)}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>實際金額</div><div style={{ fontWeight: 700 }}>{showDetail.actual_amount != null ? fmt(showDetail.actual_amount) : '—'}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>差異</div><div style={{ fontWeight: 700, color: showDetail.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{showDetail.difference != null ? fmt(showDetail.difference) : '—'}</div></div>
            </div>
          ),
        })

        if (showDetail.reject_reason) fields.push({ label: '駁回原因', value: showDetail.reject_reason, multiline: true })
        if (showDetail.notes) fields.push({ label: '核銷備註', value: showDetail.notes, multiline: true })

        const atts = (attachments[showDetail.id] || []).map(a => ({
          url: supabase.storage.from('attachments').getPublicUrl(a.storage_path).data?.publicUrl,
          name: `${a.file_name}${a.stage === 'settlement' ? '（核銷）' : '（申請）'}`,
          type: a.file_type,
        }))

        const handlePrintSignOff = async () => {
          if (!employees.length) { toast.error('員工清單載入中，請稍候'); return }
          const win = window.open('', '_blank', 'width=900,height=1100')
          if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
          try {
            const { data: rawAtts } = await supabase.from('expense_request_attachments')
              .select('file_name, storage_path, file_type')
              .eq('request_id', showDetail.id)
              .order('created_at')
            const pdfAtts = (rawAtts || []).map(a => ({
              url: supabase.storage.from('attachments').getPublicUrl(a.storage_path).data?.publicUrl,
              name: a.file_name,
              type: a.file_type,
            }))
            const signatures = Object.fromEntries(
              employees.filter(e => e.signature_url).map(e => [e.name, e.signature_url])
            )
            const approverMap = {}
            detailChainSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
            exportExpenseRequestPdf(showDetail, {
              companyName: organization?.name,
              logoUrl: organization?.logo_url,
              attachments: pdfAtts,
              signatures,
              chainSteps: detailChainSteps,
              approverMap,
              _win: win,
            })
          } catch (e) {
            win.close()
            toast.error('產生簽呈失敗：' + (e.message || '未知錯誤'))
          }
        }

        return (
          <ApprovalDetailModal
            open={!!showDetail}
            onClose={() => { setShowDetail(null); setDetailChainSteps([]) }}
            docTitle={`費用申請 #${showDetail.id}`}
            docNo={showDetail.id}
            status={showDetail.status}
            applicant={{
              name: showDetail.employee,
              name_en: empRow?.name_en,
              position: empRow?.position,
              dept: showDetail.department,
              status: empRow?.status,
              employee_no: empRow?.employee_number,
            }}
            fields={fields}
            attachments={atts}
            createdAt={showDetail.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            onPrint={handlePrintSignOff}
          />
        )
      })()}

    </div>
  )
}
