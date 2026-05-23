import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { ModalOverlay } from '../../components/Modal'
import { Plus, X, Check, Upload, FileText, Image, Send, Settings, Search } from 'lucide-react'
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
import { safeStorageName } from '../../lib/storageSanitize'

import ExpenseFormModal from './components/ExpenseFormModal'
import SettleModal from './components/SettleModal'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const STATUS_COLORS = {
  '申請中': { bg: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' },
  '已核准': { bg: 'var(--accent-green-dim)', color: 'var(--accent-green)' },
  '未送核銷': { bg: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' },  // 視覺提醒：已核准但還沒按「送核銷」
  '待核銷': { bg: 'var(--accent-yellow-dim)', color: 'var(--accent-yellow)' },
  '已核銷': { bg: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' },
  '已駁回': { bg: 'var(--accent-red-dim)', color: 'var(--accent-red)' },
  '核銷已退回': { bg: 'var(--accent-red-dim)', color: 'var(--accent-red)' },
}

const CURRENCY_SYMBOL = { TWD: 'NT$', USD: 'US$', JPY: '¥', CNY: '¥', EUR: '€' }
const fmtCur = (n, cur) => {
  if (n == null) return '-'
  const sym = CURRENCY_SYMBOL[cur] || (cur ?? 'NT$')
  return `${sym} ${Number(n).toLocaleString()}`
}

const emptyForm = {
  employee: '', account_code: '', title: '', description: '',
  estimated_amount: '', store: '', supplier: '', currency: 'TWD',
}

const emptyItem = () => ({ name: '', qty: '', unit_price: '', subtotal: 0 })

export default function ExpenseRequests() {
  const { profile, isAdmin, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
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
  const [search, setSearch] = useState('')
  const [isExpense, setIsExpense] = useState(true)
  const [errors, setErrors] = useState({})
  const [editingId, setEditingId] = useState(null)  // null = 新增, 數字 = 編輯重送
  const [files, setFiles] = useState([])
  const [settleFiles, setSettleFiles] = useState([])
  const [attachments, setAttachments] = useState({})
  const [lineItems, setLineItems] = useState([emptyItem()])
  // 加簽（P3a）：pending extras 索引 by source_id → 用來判斷當前狀態 + 撤銷
  const [pendingExtras, setPendingExtras] = useState({})
  // 加簽 modal 狀態
  const [showExtraModal, setShowExtraModal] = useState(null) // null or { row }
  const [extraForm, setExtraForm] = useState({ assignee_id: null, reason: '' })
  const fileRef = useRef(null)
  const settleFileRef = useRef(null)
  const csvRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const updateItem = (i, k, v) => setLineItems(items => {
    const n = [...items]
    n[i] = { ...n[i], [k]: v }
    if (k === 'qty' || k === 'unit_price') n[i].subtotal = (Number(n[i].qty) || 0) * (Number(n[i].unit_price) || 0)
    return n
  })
  const lineTotal = lineItems.reduce((s, li) => s + (li.subtotal || 0), 0)

  const handleCsvImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      // skip header row if first cell matches known header
      const start = /^(品名|name)/i.test(lines[0]) ? 1 : 0
      const parsed = lines.slice(start).map(line => {
        const cols = line.split(',')
        const name = (cols[0] || '').trim()
        const qty = Number((cols[1] || '').trim()) || 0
        const unit_price = Number((cols[2] || '').trim()) || 0
        return { name, qty, unit_price, subtotal: qty * unit_price }
      }).filter(li => li.name)
      if (parsed.length === 0) { toast.error('CSV 沒有有效資料'); return }
      setLineItems(prev => {
        const cleaned = prev.filter(li => li.name || li.qty || li.unit_price)
        return [...cleaned, ...parsed]
      })
      toast.success(`已匯入 ${parsed.length} 筆品項`)
    }
    reader.readAsText(file, 'UTF-8')
  }

  const load = async () => {
    setLoading(true)
    const orgId = profile?.organization_id
    let reqQuery = supabase.from('expense_requests').select('*').is('deleted_at', null).order('created_at', { ascending: false })
    if (orgId) reqQuery = reqQuery.eq('organization_id', orgId)
    const [reqRes, accRes, empRes, orgRes, extraRes] = await Promise.all([
      reqQuery,
      getAccounts(orgId),
      getEmployees(orgId),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
      // 加簽（P3a）：撈 pending extras 給 UI 顯示 / 撤銷判斷
      supabase.from('approval_extra_steps')
        .select('id, source_id, insert_before_step, assignee_id, requested_by_id, reason, status, created_at')
        .eq('source_table', 'expense_requests')
        .eq('status', 'pending'),
    ])
    setRequests(reqRes.data || [])
    setAccounts(accRes.data || [])
    setEmployees((empRes.data || []).filter(e => e.status === '在職'))
    setOrganization(orgRes?.data || null)
    // 把 extras 索引化：{ [source_id]: extra_row }（每張單同一 step 只會有一筆 pending）
    const idx = {}
    for (const e of (extraRes?.data || [])) idx[e.source_id] = e
    setPendingExtras(idx)
    setLoading(false)
  }

  useEffect(() => { load() }, [profile?.organization_id])

  // 從 Dashboard ApprovalCenter 跳過來時，URL 帶 ?focus=ID → 自動開 detail modal
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !requests.length) return
    const row = requests.find(r => r.id === Number(focus))
    if (row) {
      openDetail(row)
      // 清掉 URL param 避免重整時又跳出來
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [requests, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

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
      currency: req.currency || 'TWD',
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

    // 非費用：只驗 申請人 + 主旨；費用：驗會計科目 + 品項合計
    if (isExpense) {
      const validateForm = { ...form, _total: total }
      if (!validateRequired(validateForm, ['employee', 'account_code', 'title', '_total'], setErrors, { zeroInvalid: true })) return
    } else {
      if (!validateRequired(form, ['employee', 'title'], setErrors)) return
    }

    if (files.length === 0) {
      const proceed = await confirm('尚未附上任何附件（訂購單、報價單等），確定要直接提交？')
      if (!proceed) return
    }

    setSaving(true)
    const emp = employees.find(e => e.name === form.employee)
    const acc = isExpense ? accounts.find(a => a.code === form.account_code) : null
    const payload = {
      employee: form.employee,
      employee_id: emp?.id || null,
      department: emp?.dept || null,
      is_expense: isExpense,
      account_code: isExpense ? form.account_code : null,
      account_name: isExpense ? (acc?.name || '') : null,
      title: form.title,
      description: form.description || null,
      estimated_amount: isExpense ? total : null,
      supplier: isExpense ? (form.supplier || null) : null,
      items: isExpense ? validItems : null,
      store: isExpense ? (form.store || null) : null,
      currency: isExpense ? (form.currency || 'TWD') : 'TWD',
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
    // 從 URL 取 binding_id（任務頁帶過來的）
    const bindingId = searchParams.get('binding_id')
    if (bindingId) payload.linked_binding_id = Number(bindingId)
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
        PENDING_EXTRA_SIGNER: data?.message || '此單據有加簽請求進行中，請等加簽人完成後再簽核',
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

  // 加簽（P3a）— 開 modal
  const openExtraModal = (req) => {
    setShowExtraModal({ row: req })
    setExtraForm({ assignee_id: null, reason: '' })
  }

  // 加簽 — 送出
  const handleSubmitExtra = async () => {
    if (!showExtraModal?.row) return
    if (!extraForm.assignee_id) { toast.error('請選擇加簽人'); return }
    const req = showExtraModal.row
    const { data, error } = await supabase.rpc('request_extra_signer', {
      p_source_table: 'expense_requests',
      p_source_id: req.id,
      p_insert_before_step: req.current_step ?? 0,
      p_assignee_id: extraForm.assignee_id,
      p_requested_by_id: profile?.id,
      p_reason: extraForm.reason?.trim() || null,
    })
    if (error) {
      // 解 friendly message — Postgres error 碼跟訊息直出
      const msg = error.message?.includes('不能對自己加簽') ? '不能對自己加簽'
                : error.message?.includes('已有 pending 加簽') ? '此步驟已有加簽進行中'
                : error.message?.includes('不支援此單據類型') ? '此單據類型不支援加簽'
                : `加簽失敗：${error.message}`
      toast.error(msg)
      return
    }
    toast.success(`已送出加簽請求給 ${employees.find(e => e.id === extraForm.assignee_id)?.name || '加簽人'}`)
    setShowExtraModal(null)
    load()
  }

  // 加簽 — 撤銷
  const handleCancelExtra = async (extraId) => {
    if (!extraId) return
    const ok = await confirm('確定要撤銷加簽？加簽人會收到通知')
    if (!ok) return
    const { error } = await supabase.rpc('cancel_extra_signer', {
      p_extra_step_id: extraId,
      p_canceller_id: profile?.id,
    })
    if (error) {
      const msg = error.message?.includes('只有發起人') ? '只有加簽發起人可以撤銷'
                : error.message?.includes('狀態非 pending') ? '此加簽已被處理或撤銷'
                : `撤銷失敗：${error.message}`
      toast.error(msg)
      return
    }
    toast.success('已撤銷加簽')
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
      id: req.id,  // ★ buildChainBasedSteps 用來查 approval_extra_steps（加簽 merge）
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
        sourceTable: 'expense_requests',  // ★ P3b 加簽 merge
      })
    } catch (e) {
      console.error('buildChainBasedSteps failed:', e)
    }

    // 合併簽核時間軸（每關完成時間）：approval_step_history 由 trigger 自動寫入
    try {
      const { data: timeline } = await supabase.rpc('get_approval_timeline', {
        p_request_type: 'expense_request',
        p_request_id: req.id,
      })
      const tlByStep = {}
      ;(timeline || []).forEach(t => { tlByStep[t.step_order] = t })
      // mergeExtraSteps 後 baseSteps = [申請人, ...可能含加簽..., chain_step_0, chain_step_1, ...]
      // 用獨立 chainStepIdx 對齊 timeline.step_order，跳過 applicant 跟加簽 step
      let chainStepIdx = 0
      baseSteps = baseSteps.map(s => {
        if (s.isApplicant) return s
        if (s.kind === 'extra') return s
        const tl = tlByStep[chainStepIdx]
        chainStepIdx += 1
        if (!tl || !tl.exited_at) return s
        if (s.status !== 'completed' && s.status !== 'rejected') return s
        return { ...s, completedAt: tl.exited_at, durationText: tl.duration_text }
      })
    } catch (e) {
      console.warn('[get_approval_timeline] failed:', e)
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

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '移至最近刪除？可在 60 天內復原。' }))) return
    const { error } = await supabase.rpc('soft_delete_request', { p_table: 'expense_requests', p_id: row.id, p_deleted_by: profile?.id ?? null })
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已移至最近刪除')
    load()
  }

  // Filter
  //   '未送核銷' (虛擬) → DB status='已核准'
  //   '已核准' 卡片數字 = 累計 → 點下去要顯示 4 種狀態
  const APPROVED_GROUP = ['已核准', '待核銷', '已核銷', '核銷已退回']
  const q = search.trim()
  const filtered = requests.filter(r => {
    if (tab !== 'all') {
      if (tab === '未送核銷') {
        if (r.status !== '已核准') return false
      } else if (tab === '已核准') {
        if (!APPROVED_GROUP.includes(r.status)) return false
      } else {
        if (r.status !== tab) return false
      }
    }
    if (!q) return true
    return String(r.id).includes(q)
  })

  const counts = {}
  requests.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1 })
  // 「未送核銷」= DB 內 status='已核准' 還沒按送核銷的
  counts['未送核銷'] = counts['已核准'] || 0
  // 「已核准」總數 = 已通過簽核累計（含後續核銷階段）= 未送 + 待核銷 + 已核銷 + 核銷已退回
  counts['已核准'] = (counts['未送核銷'] || 0) + (counts['待核銷'] || 0) + (counts['已核銷'] || 0) + (counts['核銷已退回'] || 0)

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
                <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=non_expense_request&label=非費用申請')} title="設定非費用申請的簽核流程">
                  <Settings size={14} /> 非費用簽核
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
        {['申請中', '已核准', '未送核銷', '待核銷', '已核銷', '已駁回', '核銷已退回'].map(s => (
          <div key={s} className="card" style={{ padding: '12px 16px', cursor: 'pointer', border: tab === s ? `2px solid ${STATUS_COLORS[s].color}` : undefined }}
            onClick={() => setTab(tab === s ? 'all' : s)}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: STATUS_COLORS[s].color }}>{counts[s] || 0}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginBottom: 12 }}>
        <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋單號"
          style={{ paddingLeft: 26, paddingRight: search ? 26 : 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 140 }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 55 }}>單號</th>
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
            {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>無資料</td></tr>}
            {filtered.map(r => {
              const sc = STATUS_COLORS[r.status] || {}
              return (
                <tr key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細">
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>#{r.id}</td>
                  <td style={{ fontWeight: 600 }}>{r.employee}</td>
                  <td>
                    {r.is_expense === false
                      ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', fontWeight: 600 }}>非費用</span>
                      : <><span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.account_code}</span> {r.account_name}</>}
                  </td>
                  <td style={{ fontWeight: 500 }}>{r.title}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {r.is_expense === false ? '—' : (
                      <span>
                        {fmtCur(r.estimated_amount, r.currency)}
                        {r.currency && r.currency !== 'TWD' && (
                          <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4, padding: '1px 5px', borderRadius: 3,
                            color: 'var(--accent-orange)', background: 'var(--accent-orange-dim)' }}>{r.currency}</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {r.is_expense === false ? '—' : (r.actual_amount != null ? fmtCur(r.actual_amount, r.currency) : '-')}
                    {r.difference != null && r.difference !== 0 && (
                      <span style={{ fontSize: 11, color: r.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)', marginLeft: 4 }}>
                        ({r.difference > 0 ? '+' : ''}{fmtCur(r.difference, r.currency)})
                      </span>
                    )}
                  </td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>{r.status}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.created_at?.slice(0, 10)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {r.status === '申請中' && canApprove('expense_requests', r.id) && (() => {
                        const extra = pendingExtras[r.id]
                        // 有 pending 加簽顯示提示，否則顯示「點開簽核」提示
                        if (extra) {
                          const assigneeName = employees.find(e => e.id === extra.assignee_id)?.name || '加簽人'
                          return (
                            <span style={{ fontSize: 11, color: 'var(--accent-orange)', fontWeight: 600 }}>
                              🪶 加簽中：{assigneeName}
                            </span>
                          )
                        }
                        return (
                          <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>
                            點明細簽核
                          </span>
                        )
                      })()}
                      {r.is_expense !== false && r.status === '已核准' && r.employee_id === profile?.id && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => openSettle(r)}>
                          <Send size={12} /> 核銷
                        </button>
                      )}
                      {r.status === '待核銷' && canApprove('expense_settles', r.id) && (
                        <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>點明細核銷</span>
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
                      {canDeleteAll && (
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(r)} title="永久刪除">
                          刪除
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
      <ExpenseFormModal
        open={showModal}
        onClose={() => { setShowModal(false); setErrors({}) }}
        form={form}
        setForm={setForm}
        lineItems={lineItems}
        setLineItems={setLineItems}
        files={files}
        setFiles={setFiles}
        employees={employees}
        accounts={accounts}
        editingId={editingId}
        isExpense={isExpense}
        setIsExpense={setIsExpense}
        onSubmit={handleSubmit}
        saving={saving}
        errors={errors}
        setErrors={setErrors}
        currency={form.currency}
        onCurrencyChange={v => setForm(f => ({ ...f, currency: v }))}
      />

      {/* Settlement Modal */}
      <SettleModal
        open={showSettleModal && !!showDetail}
        onClose={() => { setShowSettleModal(false); setErrors({}); setSettleFiles([]) }}
        request={showDetail}
        settleForm={settleForm}
        setSettleForm={setSettleForm}
        settleFiles={settleFiles}
        setSettleFiles={setSettleFiles}
        onSubmit={handleSettle}
        saving={saving}
        errors={errors}
        setErrors={setErrors}
      />

      {/* Detail Modal — split layout 與其他簽核表單一致 */}
      {showDetail && !showSettleModal && (() => {
        const empRow = employees.find(e => e.name === showDetail.employee)
        const isNonExpense = showDetail.is_expense === false
        const fields = isNonExpense
          ? [
              { label: '類型', value: '非費用申請' },
              { label: '部門', value: showDetail.department || '—' },
              { label: '主旨', value: showDetail.title || '—' },
              ...(showDetail.description ? [{ label: '說明', value: showDetail.description, multiline: true }] : []),
            ]
          : [
              { label: '部門', value: showDetail.department || '—' },
              { label: '科目', value: `${showDetail.account_code || ''} ${showDetail.account_name || ''}`.trim() || '—' },
              { label: '門市', value: showDetail.store || '—' },
              { label: '供應商', value: showDetail.supplier || '—' },
              { label: '項目', value: showDetail.title || '—' },
              ...(showDetail.description ? [{ label: '說明', value: showDetail.description, multiline: true }] : []),
            ]

        // 明細表格 — 始終顯示，無品項時顯示空白提示（非費用整段隱藏）
        if (!isNonExpense) fields.push({
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
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtCur(li.unit_price, showDetail.currency)}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmtCur(li.subtotal, showDetail.currency)}</td>
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

        // 三欄金額卡片（非費用隱藏）
        if (!isNonExpense) fields.push({
          label: '金額',
          value: (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  預估金額
                  {showDetail.currency && showDetail.currency !== 'TWD' && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      color: 'var(--accent-orange)', background: 'var(--accent-orange-dim)' }}>{showDetail.currency}</span>
                  )}
                </div>
                <div style={{ fontWeight: 700 }}>{fmtCur(showDetail.estimated_amount, showDetail.currency)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>實際金額</div>
                <div style={{ fontWeight: 700 }}>{showDetail.actual_amount != null ? fmtCur(showDetail.actual_amount, showDetail.currency) : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>差異</div>
                <div style={{ fontWeight: 700, color: showDetail.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                  {showDetail.difference != null ? fmtCur(showDetail.difference, showDetail.currency) : '—'}
                </div>
              </div>
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
            actions={(() => {
              // 申請中：走 expense_request_step_advance（支援加簽）
              // 加簽 / 核准 / 退回 後重抓 row 跟 chainSteps，不關 modal
              // 讓加簽成功時時間軸馬上顯示加簽人那一關（不用使用者自己重開 modal）
              const refreshDetail = async () => {
                await load()
                const { data: fresh } = await supabase
                  .from('expense_requests')
                  .select('*')
                  .eq('id', showDetail.id)
                  .maybeSingle()
                if (fresh) openDetail(fresh)
                else setShowDetail(null)
              }
              if (showDetail.status === '申請中' && canApprove('expense_requests', showDetail.id)) {
                return {
                  sourceTable: 'expense_requests',
                  row: showDetail,
                  onApprove: async (r) => handleApprove(r),
                  onReject: async (r, reason) => {
                    const { data, error } = await supabase.rpc('expense_request_step_advance', {
                      p_id: r.id, p_action: 'reject', p_reason: reason,
                    })
                    if (error) { toast.error(error.message); return }
                    if (!data?.ok) { toast.error(`退回失敗：${data?.error || 'unknown'}`); return }
                  },
                  onChanged: refreshDetail,
                }
              }
              // 待核銷：走 liff_approve_request type=expense_settle（不支援加簽）
              if (showDetail.status === '待核銷' && canApprove('expense_settles', showDetail.id)) {
                return {
                  sourceTable: 'expense_requests',
                  row: showDetail,
                  onApprove: async (r) => handleConfirmSettle(r),
                  onReject: async (_r, reason) => {
                    // handleRejectSettle 內部會 prompt — 但我們已經有 reason，要繞過
                    const { data, error } = await supabase.rpc('liff_approve_request', {
                      p_line_user_id: null, p_type: 'expense_settle', p_id: showDetail.id,
                      p_action: 'reject', p_reason: reason,
                    })
                    if (error) { toast.error('退回失敗：' + error.message); return }
                    if (!data?.ok) { toast.error('退回失敗：' + (data?.error || 'unknown')); return }
                  },
                  onChanged: refreshDetail,
                  approveLabel: '核准核銷',
                  rejectLabel: '核銷退回',
                  hideExtra: true,
                }
              }
              return null
            })()}
          />
        )
      })()}

    </div>
  )
}
