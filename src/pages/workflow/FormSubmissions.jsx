import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle, Printer, Building2, Settings, Plus, Paperclip, X, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import Modal, { Field, ModalOverlay } from '../../components/Modal'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import ChainConfigModal from '../../components/ChainConfigModal'
import CustomFormFill from './CustomFormFill'
import { printFormMemo } from '../../lib/printFormMemo'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { safeStorageName } from '../../lib/storageSanitize'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
// 公司名（給簽呈標題用）— 存 localStorage，每台電腦設一次
const COMPANY_KEY = 'sme_form_memo_company_name'
const loadCompanyName = () => localStorage.getItem(COMPANY_KEY) || '本公司'
const saveCompanyName = (n) => localStorage.setItem(COMPANY_KEY, n || '')

const STATUS_BADGE = {
  '申請中': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1' },
  '已核准': { bg: 'rgba(34,197,94,0.12)',  color: 'var(--accent-green)' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
  '已取消': { bg: 'rgba(156,163,175,0.12)', color: 'var(--text-muted)' },
}

export default function FormSubmissions() {
  const { profile, role, hasPermission } = useAuth()
  const isAdmin = ['super_admin','admin','manager'].includes(role?.name || profile?.role)
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const { canApprove: canApproveByRpc } = usePendingApprovals()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const templateFilter = searchParams.get('template')  // ?template=<id> filter 單一模板
  const [templateName, setTemplateName] = useState('')
  const [templateChain, setTemplateChain] = useState(null)  // { id, name } or null = 無 chain
  const [list, setList] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  // 從某張模板的「查看紀錄」按鈕跳進來時，預設顯示「所有」tab；其他情境照舊
  const [tab, setTab] = useState(templateFilter ? 'all' : (isAdmin ? 'review' : 'mine'))   // mine | review | all
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)
  const [reviewModal, setReviewModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectFiles, setRejectFiles] = useState([])  // 駁回時上傳的附件（File[]，最多 3 個）
  const [rejecting, setRejecting] = useState(false)   // 上傳+RPC busy state
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showChainModal, setShowChainModal] = useState(false)
  const [companyName, setCompanyName] = useState(loadCompanyName)
  const [logoUrl, setLogoUrl] = useState('')
  // task #3：每張單對應 chain 的所有 steps，給「第 X/Y 關 — label」用
  const [chainStepsMap, setChainStepsMap] = useState({})  // { submissionId: { totalSteps, steps: [orderedByStepOrder] } } — 走 snapshot
  // task #1：picker 類型把 ID 顯示成人名/部門名/門市名
  const [empMap, setEmpMap] = useState({})
  const [deptMap, setDeptMap] = useState({})
  const [storeMap, setStoreMap] = useState({})

  const load = async () => {
    setLoading(true)
    let q = supabase.from('form_submissions').select(`*,
      template:form_templates(id,name,category,fields,approval_chain_id),
      applicant:employees!applicant_id(id,name,name_en,position),
      approver:employees!approver_id(id,name,signature_url)`).is('deleted_at', null).order('id', { ascending: false })
    if (tab === 'mine') q = q.eq('applicant_id', profile?.id || 0)
    else if (tab === 'review') q = q.eq('status', '申請中')

    // ?template=<id> filter 單一模板（從 CustomFormFill「查看紀錄」進來）
    if (templateFilter) {
      q = q.eq('template_id', Number(templateFilter))
      // 順手抓模板名稱 + chain info 顯示在 header
      const { data: tmpl } = await supabase.from('form_templates')
        .select('name, approval_chain_id').eq('id', Number(templateFilter)).maybeSingle()
      setTemplateName(tmpl?.name || '')
      if (tmpl?.approval_chain_id) {
        const { data: ch } = await supabase.from('approval_chains')
          .select('id, name').eq('id', tmpl.approval_chain_id).maybeSingle()
        setTemplateChain(ch || null)
      } else {
        setTemplateChain(null)
      }
    } else {
      setTemplateName('')
      setTemplateChain(null)
    }

    const orgId = profile?.organization_id
    const [listRes, orgRes] = await Promise.all([
      q,
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const rows = listRes.data || []
    setList(rows)
    setLogoUrl(orgRes?.data?.logo_url || '')
    // 優先用 DB 的 organization.name 當公司名，沒設才 fallback localStorage
    if (orgRes?.data?.name) setCompanyName(orgRes.data.name)

    // 列表「第 X/N 關 · 標籤」顯示 — 走 snapshot batch RPC（key 是 submission_id）
    // 改 chain 不影響在飛單：每張單在送出當下已被快照鎖住自己的流程
    const subIds = rows.map(r => r.id)
    const m = {}
    if (subIds.length) {
      const { data: snapData } = await supabase.rpc('get_form_submission_chain_steps_batch', {
        p_submission_ids: subIds,
      })
      for (const row of (snapData || [])) {
        const entry = { totalSteps: row.total_steps || 0, steps: [] }
        for (const s of (row.steps || [])) entry.steps[s.step_order] = s
        m[row.submission_id] = entry
      }
      // 沒快照的舊單（理論上 backfill 已補齊，這是保險）→ fallback 讀 live chain
      const missingIds = subIds.filter(id => !m[id])
      if (missingIds.length) {
        const missingRows = rows.filter(r => missingIds.includes(r.id) && r.template?.approval_chain_id)
        const fallbackChainIds = [...new Set(missingRows.map(r => r.template.approval_chain_id))]
        if (fallbackChainIds.length) {
          const { data: liveSteps } = await supabase
            .from('approval_chain_steps')
            .select('chain_id, step_order, label, role_name')
            .in('chain_id', fallbackChainIds)
            .order('step_order', { ascending: true })
          const liveByChain = {}
          for (const step of (liveSteps || [])) {
            if (!liveByChain[step.chain_id]) liveByChain[step.chain_id] = { totalSteps: 0, steps: [] }
            liveByChain[step.chain_id].steps[step.step_order] = step
            liveByChain[step.chain_id].totalSteps = Math.max(liveByChain[step.chain_id].totalSteps, step.step_order + 1)
          }
          for (const r of missingRows) {
            m[r.id] = liveByChain[r.template.approval_chain_id] || { totalSteps: 0, steps: [] }
          }
        }
      }
    }
    setChainStepsMap(m)

    // task #1：偵測 list 內有沒有 picker 欄位 → 才打 DB 拿 employees/depts/stores
    const allFields = rows.flatMap(r => r.template?.fields || [])
    const needEmp = allFields.some(f => f.type === 'employee_picker')
    const needDept = allFields.some(f => f.type === 'department_picker')
    const needStore = allFields.some(f => f.type === 'store_picker')
    const pickerTasks = []
    if (orgId && needEmp) {
      pickerTasks.push(
        supabase.from('employees').select('id, name').eq('organization_id', orgId)
          .then(({ data }) => setEmpMap(Object.fromEntries((data || []).map(e => [e.id, e.name]))))
      )
    }
    if (orgId && needDept) {
      pickerTasks.push(
        supabase.from('departments').select('id, name').eq('organization_id', orgId)
          .then(({ data }) => setDeptMap(Object.fromEntries((data || []).map(d => [d.id, d.name]))))
      )
    }
    if (orgId && needStore) {
      pickerTasks.push(
        supabase.from('stores').select('id, name').eq('organization_id', orgId)
          .then(({ data }) => setStoreMap(Object.fromEntries((data || []).map(s => [s.id, s.name]))))
      )
    }
    if (pickerTasks.length) await Promise.all(pickerTasks)

    setLoading(false)
  }
  useEffect(() => { load() }, [tab, profile?.id, templateFilter])

  // 從簽核中心 ?focus=ID 跳進來時自動開明細
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !list.length) return
    const row = list.find(r => r.id === Number(focus))
    if (row) {
      setDetailRow(row)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [list, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = async (sub) => {
    if (!(await confirm({ message: `核准 ${sub.applicant?.name} 的「${sub.template?.name}」？` }))) return
    const { data, error } = await supabase.rpc('form_submission_chain_approve', {
      p_id: sub.id, p_approver_id: profile?.id, p_action: 'approve', p_reason: null,
    })
    if (error) { toast.error('核准失敗：' + error.message); return }
    if (!data?.ok) {
      const msg = {
        'NOT_YOUR_TURN': '這關不是你簽核',
        'PENDING_EXTRA_SIGNER': data.message || '此單有加簽進行中',
        'ALREADY_PROCESSED': '此單已處理過',
      }[data?.error] || `核准失敗：${data?.error}`
      toast.error(msg); return
    }
    toast.success(data.is_last_step ? '已核准（最終關）' : `已推進到第 ${(data.advanced_to_step ?? 0) + 1} 關`)
    load()
  }

  const handleReject = async () => {
    if (!rejectReason) return toast.warning('請填駁回原因')
    if (rejectFiles.length > 3) return toast.warning('附件最多 3 個')
    setRejecting(true)
    try {
      // 先把附件上傳到 uploads bucket（form-reject/<sub_id>/<ts>_<filename>）
      const attachments = []
      for (const file of rejectFiles) {
        const path = `form-reject/${reviewModal.id}/${Date.now()}_${safeStorageName(file.name)}`
        const { data: upload, error: upErr } = await supabase.storage.from('uploads').upload(path, file)
        if (upErr) { toast.error(`上傳「${file.name}」失敗：${upErr.message}`); return }
        const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(upload.path)
        attachments.push({ url: publicUrl, name: file.name, uploaded_at: new Date().toISOString() })
      }
      const { data, error } = await supabase.rpc('form_submission_chain_approve', {
        p_id: reviewModal.id, p_approver_id: profile?.id, p_action: 'reject',
        p_reason: rejectReason,
        p_reject_attachments: attachments,
      })
      if (error) { toast.error('駁回失敗：' + error.message); return }
      if (!data?.ok) { toast.error(`駁回失敗：${data?.error || 'unknown'}`); return }
      setReviewModal(null); setRejectReason(''); setRejectFiles([])
      toast.success(attachments.length ? `已駁回（附 ${attachments.length} 個附件）` : '已駁回')
      load()
    } finally {
      setRejecting(false)
    }
  }

  const handleCancel = async (sub) => {
    if (!(await confirm({ message: '確定取消此申請？' }))) return
    const { error } = await supabase.from('form_submissions').update({ status: '已取消' }).eq('id', sub.id)
    if (error) { toast.error('取消失敗：' + error.message); return }
    toast.success('已取消')
    load()
  }

  const handleDelete = async (sub) => {
    if (!(await confirm({ message: `將「${sub.template?.name || '此申請'}」移至最近刪除？可在 60 天內復原。` }))) return
    const { error } = await supabase.rpc('soft_delete_request', { p_table: 'form_submissions', p_id: sub.id, p_deleted_by: profile?.id ?? null })
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已移至最近刪除')
    load()
  }

  // 列印簽呈：抓 chain steps + 簽核人姓名 → 開新視窗
  // ★ 必須在 click handler 第一行 sync 開好 window，否則 iOS Safari 會擋（async 後失去 user gesture）
  const handlePrint = async (sub) => {
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      await doPrint(sub, win)
    } catch (e) {
      try { win.close() } catch (_) {}
      toast.error('列印失敗：' + (e?.message || e))
    }
  }

  const doPrint = async (sub, win) => {
    // 申請人 step 0（PDF 簽核欄第一格）
    const applicantStep = {
      label: '申請人',
      name: sub.applicant?.name || '—',
      isApplicant: true,
      status: 'completed',
      completedAt: sub.created_at,
    }

    let restSteps = []
    const chainId = sub.template?.approval_chain_id
    if (chainId) {
      // 用 RPC 解出每關實際簽核人（covers 9 種 target_type，含 applicant_supervisor）
      const applicantEmpId = sub.applicant_id || sub.applicant?.id || null
      const [{ data: chainStepsData }, { data: ashRows }] = await Promise.all([
        supabase.rpc('get_chain_step_display_names', {
          p_chain_id: chainId, p_applicant_emp_id: applicantEmpId,
        }),
        supabase.from('approval_step_history')
          .select('step_order, exited_at, action, approver_name')
          .eq('request_type', 'form_submission')
          .eq('request_id', sub.id)
          .not('exited_at', 'is', null),
      ])
      const ashByStep = {}
      for (const r of (ashRows || [])) ashByStep[r.step_order] = r

      const stepsList = Array.isArray(chainStepsData) ? chainStepsData : []
      const isApproved = sub.status === '已核准' || sub.status === '已核銷'
      const isRejected = sub.status === '已駁回' || sub.status === '已退回' || sub.status === '已拒絕'
      const curStep = sub.current_step ?? 0
      restSteps = stepsList.map((s, i) => {
        let stStatus
        if (isApproved) stStatus = 'completed'
        else if (isRejected) stStatus = (i === curStep ? 'rejected' : (i < curStep ? 'completed' : 'pending'))
        else stStatus = (i < curStep ? 'completed' : (i === curStep ? 'current' : 'pending'))
        const ash = ashByStep[i]
        return {
          label: s.label || s.role_name || `第${i + 1}關`,
          name: s.names || '',
          role_name: s.role_name || '',
          status: stStatus,
          completedAt: stStatus === 'completed'
            ? (ash?.exited_at || (i === stepsList.length - 1 ? sub.approved_at : undefined))
            : undefined,
          completedBy: stStatus === 'completed' ? (ash?.approver_name || undefined) : undefined,
          rejectReason: stStatus === 'rejected' ? sub.reject_reason : '',
        }
      })
    }

    // 撈所有在職員工的 signature_url 給 PDF 簽核欄顯示簽名 / 印章圖
    const { data: empList } = await supabase
      .from('employees')
      .select('name, signature_url')
      .eq('status', '在職')
      .not('signature_url', 'is', null)
    const signatures = Object.fromEntries(
      (empList || []).filter(e => e.signature_url).map(e => [e.name, e.signature_url])
    )

    printFormMemo({
      submission: sub,
      template: sub.template,
      applicant: sub.applicant,
      companyName,
      logoUrl,
      chainSteps: [applicantStep, ...restSteps],
      approverMap: {},
      signatures,
      _win: win,
    })
  }

  const handleSaveCompany = () => {
    saveCompanyName(companyName)
    setShowCompanyModal(false)
    toast.error('公司名稱已儲存（瀏覽器本機）')
  }

  // 開查看明細：抓 chain steps（template.approval_chain_id）+ 套 status 到每關
  // form_submissions 是單關 admin 一鍵核准/駁回，沒有 current_step → inline 算 status，不走 buildChainBasedSteps
  const openDetail = async (sub) => {
    detailRowIdRef.current = sub.id
    setDetailRow(sub)
    setLoadingChain(true)
    setDetailChainSteps([])

    const applicantStep = {
      label: '申請人',
      name: sub.applicant?.name || '—',
      status: 'completed',
      completedAt: sub.created_at,
      isApplicant: true,
    }

    const isApproved = sub.status === '已核准' || sub.status === '已核銷'
    const isRejected = sub.status === '已駁回' || sub.status === '已退回' || sub.status === '已拒絕'
    let restSteps = []
    const chainId = sub.template?.approval_chain_id

    if (chainId) {
      // 用 RPC 解出每關實際簽核人（cover 動態 target：applicant_dept_manager / specific_* 等 9 種）
      // ★ 優先讀 snapshot（送出當下鎖定）→ 沒快照才 fallback live chain（舊單相容）
      const applicantEmpId = sub.applicant_id || sub.applicant?.id || null
      const [{ data: snapData }, { data: ashRows }] = await Promise.all([
        supabase.rpc('get_request_chain_display_names', {
          p_request_type: 'form_submission',
          p_request_id: sub.id,
          p_applicant_emp_id: applicantEmpId,
        }),
        supabase.from('approval_step_history')
          .select('step_order, exited_at, action, approver_name')
          .eq('request_type', 'form_submission')
          .eq('request_id', sub.id)
          .not('exited_at', 'is', null)
          .order('step_order', { ascending: true }),
      ])
      let chainStepsData = Array.isArray(snapData) && snapData.length > 0 ? snapData : null
      if (!chainStepsData) {
        const { data: liveData } = await supabase.rpc('get_chain_step_display_names', {
          p_chain_id: chainId, p_applicant_emp_id: applicantEmpId,
        })
        chainStepsData = Array.isArray(liveData) ? liveData : []
      }
      const ashByStep = {}
      for (const r of (ashRows || [])) {
        ashByStep[r.step_order] = r  // 同 step 多筆會被最後一筆蓋掉，正常情況每 step 只有 1 筆 exited
      }

      const stepsList = Array.isArray(chainStepsData) ? chainStepsData : []
      const curStep = sub.current_step ?? 0
      restSteps = stepsList.map((s, i) => {
        let status
        if (isApproved) status = 'completed'
        else if (isRejected) status = (i === curStep ? 'rejected' : (i < curStep ? 'completed' : 'pending'))
        else status = (i < curStep ? 'completed' : (i === curStep ? 'current' : 'pending'))
        const ash = ashByStep[i]
        return {
          label: s.label || s.role_name || `第${i + 1}關`,
          name: s.names || '',  // RPC 已解出所有 target_type
          status,
          // completedAt 優先 ash.exited_at；最後一關終態 fallback 用 sub.approved_at
          completedAt: status === 'completed'
            ? (ash?.exited_at || (i === stepsList.length - 1 ? sub.approved_at : undefined))
            : undefined,
          // 簽核人名以 ash 紀錄為準（會被自己當下實際簽的人覆蓋 — 例如多人共簽中誰按）
          completedBy: status === 'completed' ? (ash?.approver_name || undefined) : undefined,
          rejectReason: status === 'rejected' ? sub.reject_reason : '',
        }
      })
    } else {
      // 沒設 chain → 單關「主管核示」
      if (isApproved) {
        restSteps = [{ label: '主管核示', name: sub.approver?.name || '', status: 'completed', completedAt: sub.approved_at }]
      } else if (isRejected) {
        restSteps = [{ label: '主管核示', name: sub.approver?.name || '', status: 'rejected', rejectReason: sub.reject_reason }]
      } else {
        restSteps = [{ label: '主管核示', name: '', status: 'current' }]
      }
    }

    if (detailRowIdRef.current !== sub.id) return
    setDetailChainSteps([applicantStep, ...restSteps])
    setLoadingChain(false)
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>
              {templateFilter && templateName ? templateName : '表單提交記錄'}
            </h2>
            <p>
              共 {list.length} 筆 · 申請中 {list.filter(r => r.status === '申請中').length} 筆
              {templateFilter && (
                templateChain
                  ? <span style={{ marginLeft: 8, color: 'var(--accent-cyan)', fontSize: 12 }}>· 簽核鏈：{templateChain.name}</span>
                  : <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontSize: 12 }}>· ⚠ 無簽核鏈，admin 可直接核准</span>
              )}
              {templateFilter && (
                <button
                  onClick={() => setSearchParams({}, { replace: true })}
                  style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                  title="顯示全部表單"
                >
                  × 顯示全部表單
                </button>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {templateFilter && isAdmin && (
              <button className="btn btn-secondary"
                onClick={() => setShowChainModal(true)}
                title="設定簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            {templateFilter && (
              <button className="btn btn-primary"
                onClick={() => setShowCreateModal(true)}
                title="新增申請">
                <Plus size={14} /> 新增申請
              </button>
            )}
            {!templateFilter && (
              <button className="btn btn-secondary" onClick={() => setShowCompanyModal(true)} title="設定公司名稱（簽呈標題用）">
                <Building2 size={14} /> 公司名稱
              </button>
            )}
          </div>
        </div>
      </div>

      {/* templateFilter 模式不顯示 tab bar，對齊人力需求列表頁簡潔風格 */}
      {!templateFilter && (
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden', marginBottom: 16, maxWidth: 480 }}>
        {[
          { key: 'mine',   label: '📝 我的申請' },
          ...(isAdmin ? [{ key: 'review', label: '🔍 待我審核' }] : []),
          ...(isAdmin ? [{ key: 'all',    label: '📋 全部' }] : []),
        ].map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{
            padding: '8px 16px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            flex: 1,
          }}>{t.label}</button>
        ))}
      </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋單號" style={{ paddingLeft: 26, paddingRight: search ? 26 : 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 120 }} />
            {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><X size={12} /></button>}
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 55 }}>單號</th>
                <th>表單</th>
                <th>申請人</th>
                <th>申請日</th>
                <th>狀態</th>
                <th>核准人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.filter(s => !search.trim() || String(s.id).includes(search.trim())).length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>無資料</td></tr>
              )}
              {list.filter(s => !search.trim() || String(s.id).includes(search.trim())).map(s => {
                const sb = STATUS_BADGE[s.status] || {}
                // chain 中間關卡用 RPC 算「這關該不該給我簽」；沒設 chain 的單 admin 仍可一鍵核准
                const canApprove = s.status === '申請中' && (
                  canApproveByRpc('form_submissions', s.id)
                  || (!s.template?.approval_chain_id && isAdmin)
                )
                const canCancel = s.status === '申請中' && (s.applicant_id === profile?.id || isAdmin)
                return (
                  <tr key={s.id} onClick={() => openDetail(s)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細">
                    <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{s.id}</td>
                    <td><b>{s.template?.name}</b></td>
                    <td>{s.applicant?.name}{s.applicant?.name_en ? ` ${s.applicant.name_en}` : ''}</td>
                    <td style={{ fontSize: 12 }}>{s.created_at?.slice(0, 10)}</td>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: sb.bg, color: sb.color }}>{s.status}</span>
                      {s.status === '申請中' && chainStepsMap[s.id] && (() => {
                        const cs = chainStepsMap[s.id]
                        const cur = s.current_step ?? 0
                        const stepInfo = cs.steps[cur]
                        if (!stepInfo) return null
                        return (
                          <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 2 }}>
                            第 {cur + 1}/{cs.totalSteps} 關 · {stepInfo.label || stepInfo.role_name || ''}
                          </div>
                        )
                      })()}
                    </td>
                    <td style={{ fontSize: 12 }}>{s.approver?.name || '—'}{s.reject_reason && <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>{s.reject_reason}</div>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-purple)' }} onClick={() => handlePrint(s)} title="列印簽呈 PDF">
                          <Printer size={11} /> 列印
                        </button>
                        {canApprove && (
                          <>
                            <AsyncButton className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-green)' }} onClick={() => handleApprove(s)} busyLabel="處理中…">
                              <CheckCircle size={11} /> 核准
                            </AsyncButton>
                            <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => setReviewModal(s)}>
                              <XCircle size={11} /> 駁回
                            </button>
                          </>
                        )}
                        {canCancel && (
                          <AsyncButton className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleCancel(s)} busyLabel="處理中…">取消</AsyncButton>
                        )}
                        {canDeleteAll && (
                          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(s)} title="永久刪除此申請">
                            <X size={11} /> 刪除
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
      </div>

      {detailRow && (() => {
        const fields = []
        const attachments = []
        for (const f of (detailRow.template?.fields || [])) {
          if (f.type === 'section') continue
          const v = detailRow.data?.[f.key]
          if (f.type === 'file') {
            // 多檔：陣列；單檔：字串（向下相容）
            const items = Array.isArray(v) ? v : (v ? [{ url: v, name: String(v).split('?')[0].split('/').pop() || f.label }] : [])
            for (const item of items) {
              if (item?.url) attachments.push({ url: item.url, name: item.name || String(item.url).split('/').pop() })
            }
          } else if (f.type === 'date_range') {
            if (v?.start || v?.end) {
              const start = v.start || '—'
              const end = v.end || '—'
              const days = (v.start && v.end)
                ? Math.max(0, Math.round((new Date(v.end) - new Date(v.start)) / 86400000) + 1)
                : null
              fields.push({ label: f.label, value: `${start} → ${end}${days !== null ? `（共 ${days} 天）` : ''}` })
            }
          } else {
            let displayValue
            if (v === null || v === undefined || v === '') displayValue = ''
            else if (f.type === 'checkbox') displayValue = v ? '✓ 是' : '✗ 否'
            else if (f.type === 'employee_picker') displayValue = empMap[v] || `(員工 #${v})`
            else if (f.type === 'department_picker') displayValue = deptMap[v] || `(部門 #${v})`
            else if (f.type === 'store_picker') displayValue = storeMap[v] || `(門市 #${v})`
            else displayValue = String(v)
            const multiline = f.type === 'textarea' || (typeof displayValue === 'string' && displayValue.length > 50)
            fields.push({ label: f.label, value: displayValue, multiline })
          }
        }
        if (detailRow.reject_reason) {
          fields.push({ label: '駁回原因', value: detailRow.reject_reason, multiline: true })
        }
        // 駁回附件（簽核人退單時補的範本/報價單）→ 跟表單附件一起顯示，標 [駁回] 區隔
        if (Array.isArray(detailRow.reject_attachments)) {
          for (const att of detailRow.reject_attachments) {
            if (att?.url) {
              attachments.push({
                url: att.url,
                name: `[駁回附件] ${att.name || String(att.url).split('?')[0].split('/').pop()}`,
              })
            }
          }
        }
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle={detailRow.template?.name || '表單'}
            docNo={detailRow.id}
            status={detailRow.status}
            applicant={{
              name: detailRow.applicant?.name,
              name_en: detailRow.applicant?.name_en,
              position: detailRow.applicant?.position,
            }}
            fields={fields}
            attachments={attachments}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            onPrint={() => handlePrint(detailRow)}
          />
        )
      })()}

      {reviewModal && (
        <Modal title={`駁回 — ${reviewModal.template?.name}`}
          onClose={() => { setReviewModal(null); setRejectReason(''); setRejectFiles([]) }}
          onSubmit={handleReject}
          submitLabel={rejecting ? '處理中…' : '確認駁回'}>
          <Field label="駁回原因">
            <textarea className="form-input" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} disabled={rejecting} />
          </Field>
          <Field label="附件（選填，最多 3 個 — 範本／報價單／正確格式截圖等）">
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
              multiple
              disabled={rejecting || rejectFiles.length >= 3}
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                const remaining = 3 - rejectFiles.length
                if (files.length > remaining) toast.warning(`只能再加 ${remaining} 個檔案（共 3 個）`)
                setRejectFiles(prev => [...prev, ...files.slice(0, remaining)])
                e.target.value = ''
              }}
              style={{ marginBottom: 6 }}
            />
            {rejectFiles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {rejectFiles.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 8px', background: 'var(--bg-card-alt, rgba(0,0,0,0.03))',
                    borderRadius: 4, fontSize: 12,
                  }}>
                    <Paperclip size={12} style={{ color: 'var(--accent-cyan)' }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{(f.size / 1024).toFixed(0)} KB</span>
                    <button type="button" disabled={rejecting}
                      onClick={() => setRejectFiles(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Field>
        </Modal>
      )}

      {showCompanyModal && (
        <Modal title="公司名稱（列印簽呈用）" onClose={() => setShowCompanyModal(false)} onSubmit={handleSaveCompany} submitLabel="儲存">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: 10, borderRadius: 6, marginBottom: 12 }}>
            這是列印簽呈時的標題公司名稱。儲存於瀏覽器本機（每台電腦設定一次）。
          </div>
          <Field label="公司名稱" required>
            <input className="form-input" style={{ width: '100%' }} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="例：威耀時代股份有限公司" />
          </Field>
        </Modal>
      )}

      {/* + 新增申請 Modal (內嵌 CustomFormFill 元件) */}
      {showCreateModal && templateFilter && (
        <ModalOverlay onClose={() => setShowCreateModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--bg-card)', borderRadius: 12,
            width: 'min(720px, 96vw)', maxHeight: '88vh', overflow: 'auto',
            border: '1px solid var(--border-medium)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '16px 22px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                + 新增{templateName || '申請'}
              </h3>
              <button onClick={() => setShowCreateModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                         color: 'var(--text-muted)', fontSize: 22, padding: 4 }}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <CustomFormFill
                templateId={templateFilter}
                embedded
                onClose={() => { setShowCreateModal(false); load() }}
              />
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ⚙ 簽核設定 Modal */}
      {showChainModal && templateFilter && (
        <ChainConfigModal
          open={showChainModal}
          onClose={() => setShowChainModal(false)}
          formType={`custom:${templateFilter}`}
          formLabel={templateName || '自訂表單'}
          mode="single"
          organizationId={profile?.organization_id}
          onSaved={() => { setShowChainModal(false); load() }}
        />
      )}
    </div>
  )
}

