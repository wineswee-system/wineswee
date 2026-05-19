import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle, Printer, Building2, Settings, Plus } from 'lucide-react'
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
  const { profile, role } = useAuth()
  const isAdmin = ['super_admin','admin','manager'].includes(role?.name || profile?.role)
  const { canApprove: canApproveByRpc } = usePendingApprovals()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const templateFilter = searchParams.get('template')  // ?template=<id> filter 單一模板
  const [templateName, setTemplateName] = useState('')
  const [templateChain, setTemplateChain] = useState(null)  // { id, name } or null = 無 chain
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  // 從某張模板的「查看紀錄」按鈕跳進來時，預設顯示「所有」tab；其他情境照舊
  const [tab, setTab] = useState(templateFilter ? 'all' : (isAdmin ? 'review' : 'mine'))   // mine | review | all
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)
  const [reviewModal, setReviewModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showChainModal, setShowChainModal] = useState(false)
  const [companyName, setCompanyName] = useState(loadCompanyName)
  const [logoUrl, setLogoUrl] = useState('')
  // task #3：每張單對應 chain 的所有 steps，給「第 X/Y 關 — label」用
  const [chainStepsMap, setChainStepsMap] = useState({})  // { chainId: { totalSteps, steps: [orderedByStepOrder] } }
  // task #1：picker 類型把 ID 顯示成人名/部門名/門市名
  const [empMap, setEmpMap] = useState({})
  const [deptMap, setDeptMap] = useState({})
  const [storeMap, setStoreMap] = useState({})

  const load = async () => {
    setLoading(true)
    let q = supabase.from('form_submissions').select(`*,
      template:form_templates(id,name,category,fields,approval_chain_id),
      applicant:employees!applicant_id(id,name,name_en,position),
      approver:employees!approver_id(id,name,signature_url)`).order('id', { ascending: false })
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
      orgId ? supabase.from('organizations').select('logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const rows = listRes.data || []
    setList(rows)
    setLogoUrl(orgRes?.data?.logo_url || '')

    // task #3：先抓 list 內出現的所有 chain_ids 對應的 steps 一次 → render 時 lookup
    const chainIds = [...new Set(rows.map(r => r.template?.approval_chain_id).filter(Boolean))]
    if (chainIds.length) {
      const { data: stepsData } = await supabase
        .from('approval_chain_steps')
        .select('chain_id, step_order, label, role_name')
        .in('chain_id', chainIds)
        .order('step_order', { ascending: true })
      const m = {}
      for (const step of (stepsData || [])) {
        if (!m[step.chain_id]) m[step.chain_id] = { totalSteps: 0, steps: [] }
        m[step.chain_id].steps[step.step_order] = step
        m[step.chain_id].totalSteps = Math.max(m[step.chain_id].totalSteps, step.step_order + 1)
      }
      setChainStepsMap(m)
    } else {
      setChainStepsMap({})
    }

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
    const { data, error } = await supabase.rpc('form_submission_chain_approve', {
      p_id: reviewModal.id, p_approver_id: profile?.id, p_action: 'reject', p_reason: rejectReason,
    })
    if (error) { toast.error('駁回失敗：' + error.message); return }
    if (!data?.ok) {
      toast.error(`駁回失敗：${data?.error || 'unknown'}`); return
    }
    setReviewModal(null); setRejectReason('')
    toast.success('已駁回')
    load()
  }

  const handleCancel = async (sub) => {
    if (!(await confirm({ message: '確定取消此申請？' }))) return
    await supabase.from('form_submissions').update({ status: '已取消' }).eq('id', sub.id)
    load()
  }

  // 列印簽呈：抓 chain steps + 簽核人姓名 → 開新視窗
  const handlePrint = async (sub) => {
    if (!companyName || companyName === '本公司') {
      if (!(await confirm({ message: '尚未設定公司名稱，要先設定嗎？' }))) return
      setShowCompanyModal(true)
      return
    }

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
      const { data: chainStepsData } = await supabase.rpc('get_chain_step_display_names', {
        p_chain_id: chainId, p_applicant_emp_id: applicantEmpId,
      })
      const stepsList = Array.isArray(chainStepsData) ? chainStepsData : []
      const isApproved = sub.status === '已核准' || sub.status === '已核銷'
      const isRejected = sub.status === '已駁回' || sub.status === '已退回' || sub.status === '已拒絕'
      const curStep = sub.current_step ?? 0
      restSteps = stepsList.map((s, i) => {
        let stStatus
        if (isApproved) stStatus = 'completed'
        else if (isRejected) stStatus = (i === curStep ? 'rejected' : (i < curStep ? 'completed' : 'pending'))
        else stStatus = (i < curStep ? 'completed' : (i === curStep ? 'current' : 'pending'))
        return {
          label: s.label || s.role_name || `第${i + 1}關`,
          name: s.names || '',
          role_name: s.role_name || '',
          status: stStatus,
          completedAt: stStatus === 'completed' && i === stepsList.length - 1 ? sub.approved_at : undefined,
          rejectReason: stStatus === 'rejected' ? sub.reject_reason : '',
        }
      })
    }

    printFormMemo({
      submission: sub,
      template: sub.template,
      applicant: sub.applicant,
      companyName,
      logoUrl,
      chainSteps: [applicantStep, ...restSteps],
      approverMap: {},
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
      const applicantEmpId = sub.applicant_id || sub.applicant?.id || null
      const { data: chainStepsData } = await supabase.rpc('get_chain_step_display_names', {
        p_chain_id: chainId,
        p_applicant_emp_id: applicantEmpId,
      })
      const stepsList = Array.isArray(chainStepsData) ? chainStepsData : []
      restSteps = stepsList.map((s, i) => {
        let status
        if (isApproved) status = 'completed'
        else if (isRejected) status = i === 0 ? 'rejected' : 'pending'
        else status = i === 0 ? 'current' : 'pending'
        return {
          label: s.label || s.role_name || `第${i + 1}關`,
          name: s.names || '',  // RPC 已解出所有 target_type
          status,
          completedAt: status === 'completed' && i === stepsList.length - 1 ? sub.approved_at : undefined,
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
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>表單</th>
                <th>申請人</th>
                <th>申請日</th>
                <th>狀態</th>
                <th>核准人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>無資料</td></tr>
              )}
              {list.map(s => {
                const sb = STATUS_BADGE[s.status] || {}
                // chain 中間關卡用 RPC 算「這關該不該給我簽」；沒設 chain 的單 admin 仍可一鍵核准
                const canApprove = s.status === '申請中' && (
                  canApproveByRpc('form_submissions', s.id)
                  || (!s.template?.approval_chain_id && isAdmin)
                )
                const canCancel = s.status === '申請中' && (s.applicant_id === profile?.id || isAdmin)
                return (
                  <tr key={s.id} onClick={() => openDetail(s)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細">
                    <td><b>{s.template?.name}</b></td>
                    <td>{s.applicant?.name}{s.applicant?.name_en ? ` ${s.applicant.name_en}` : ''}</td>
                    <td style={{ fontSize: 12 }}>{s.created_at?.slice(0, 10)}</td>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: sb.bg, color: sb.color }}>{s.status}</span>
                      {s.status === '申請中' && s.template?.approval_chain_id && chainStepsMap[s.template.approval_chain_id] && (() => {
                        const cs = chainStepsMap[s.template.approval_chain_id]
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
          if (f.type === 'section') continue  // section 是視覺分隔，不顯示在明細
          const v = detailRow.data?.[f.key]
          if (f.type === 'file') {
            if (v) attachments.push({ url: v, name: String(v).split('?')[0].split('/').pop() || f.label })
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
        <Modal title={`駁回 — ${reviewModal.template?.name}`} onClose={() => { setReviewModal(null); setRejectReason('') }} onSubmit={handleReject} submitLabel="確認駁回">
          <Field label="駁回原因">
            <textarea className="form-input" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
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

