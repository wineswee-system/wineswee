import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SearchableSelect, { empOptions } from './SearchableSelect'
import AsyncButton from './AsyncButton'
import { confirm } from '../lib/confirm'
import { toast } from '../lib/toast'
import { Check, X, Feather } from 'lucide-react'

/**
 * 簽核操作列（在 ApprovalDetailModal 底部用）
 *
 * 統一 8 表的簽核 / 加簽動作。三情境：
 *   1. 我是加簽人 → 核准加簽 / 退回加簽（inline reject 原因）
 *   2. 有 pending 加簽（不是我）→ 加簽中 banner + 撤銷（限發起人）
 *   3. 正常 → 核准 / 退回 / 加簽 三鈕
 *      - 點退回 → inline reject reason textarea
 *      - 點加簽 → inline 加簽表單（選人 + 原因）
 *
 * @param {Object} props
 * @param {string} props.sourceTable          'leave_requests' / 'expense_requests' / ...
 * @param {Object} props.row                  { id, current_step, employee_id }
 * @param {Function} props.onApprove          async (row) => void
 * @param {Function} props.onReject           async (row, reason) => void
 * @param {Function} [props.onChanged]        加簽 / 撤銷 / 處理完後重 load
 * @param {string} [props.approveLabel='核准']
 * @param {string} [props.rejectLabel='退回']
 */
export default function ApprovalActionBar({
  sourceTable, row,
  onApprove, onReject, onChanged,
  approveLabel = '核准', rejectLabel = '退回',
  // 不支援加簽的情境（如核銷 settle chain）→ true 時只顯示核准/退回兩鈕
  hideExtra = false,
}) {
  const { profile } = useAuth()
  const [pendingExtra, setPendingExtra] = useState(null)
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  const [mode, setMode] = useState('idle') // idle | rejecting | adding
  const [rejectReason, setRejectReason] = useState('')
  const [extraAssignee, setExtraAssignee] = useState(null)
  const [extraReason, setExtraReason] = useState('')
  const [extraRejectReason, setExtraRejectReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [showExtraReject, setShowExtraReject] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      if (hideExtra) {
        // 核銷類不查 pendingExtra，省一次 query
        if (!cancelled) setLoading(false)
        return
      }
      const [{ data: extras }, { data: emps }] = await Promise.all([
        supabase.from('approval_extra_steps')
          .select('id, source_id, insert_before_step, assignee_id, requested_by_id, reason, status')
          .eq('source_table', sourceTable)
          .eq('source_id', row.id)
          .eq('status', 'pending')
          .limit(1),
        supabase.from('employees')
          .select('id, name, department_id')
          .eq('status', '在職')
          .order('name'),
      ])
      if (cancelled) return
      setPendingExtra((extras || [])[0] || null)
      setEmployees(emps || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [sourceTable, row.id, hideExtra])

  if (loading) return null

  const me = profile?.id
  const isMyExtraRequest = pendingExtra && pendingExtra.requested_by_id === me
  const isMyExtraAssignment = pendingExtra && pendingExtra.assignee_id === me

  // ── handlers ──────────────────────────────────────────────────────
  const doApprove = async () => {
    try { await onApprove?.(row) } finally { onChanged?.() }
  }
  const doReject = async () => {
    if (!rejectReason.trim()) { toast.error('請填寫退回原因'); return }
    try { await onReject?.(row, rejectReason.trim()) } finally {
      setMode('idle'); setRejectReason('')
      onChanged?.()
    }
  }
  const submitExtra = async () => {
    if (!extraAssignee) { toast.error('請選擇加簽人'); return }
    setBusy(true)
    const { error } = await supabase.rpc('request_extra_signer', {
      p_source_table: sourceTable,
      p_source_id: row.id,
      p_insert_before_step: row.current_step ?? 0,
      p_assignee_id: extraAssignee,
      p_requested_by_id: me,
      p_reason: extraReason?.trim() || null,
    })
    setBusy(false)
    if (error) {
      const msg = error.message?.includes('不能對自己加簽') ? '不能對自己加簽'
                : error.message?.includes('已有 pending 加簽') ? '此步驟已有加簽進行中'
                : `加簽失敗：${error.message}`
      toast.error(msg); return
    }
    toast.success('已送出加簽請求')
    setMode('idle'); setExtraAssignee(null); setExtraReason('')
    onChanged?.()
  }
  const cancelExtra = async () => {
    if (!pendingExtra) return
    const ok = await confirm('確定撤銷加簽？加簽人會收到通知')
    if (!ok) return
    setBusy(true)
    const { error } = await supabase.rpc('cancel_extra_signer', {
      p_extra_step_id: pendingExtra.id, p_canceller_id: me,
    })
    setBusy(false)
    if (error) { toast.error(`撤銷失敗：${error.message}`); return }
    toast.success('已撤銷加簽')
    onChanged?.()
  }
  const processExtra = async (action) => {
    if (!pendingExtra) return
    if (action === 'reject' && !extraRejectReason.trim()) {
      toast.error('請填寫退回加簽原因'); return
    }
    setBusy(true)
    const { error } = await supabase.rpc('process_extra_signer', {
      p_extra_step_id: pendingExtra.id,
      p_processor_id: me,
      p_action: action,
      p_reject_reason: action === 'reject' ? extraRejectReason.trim() : null,
    })
    setBusy(false)
    if (error) { toast.error(`${action === 'approve' ? '核准' : '退回'}失敗：${error.message}`); return }
    toast.success(action === 'approve' ? '已核准加簽' : '已退回加簽（整單已退回）')
    setShowExtraReject(false); setExtraRejectReason('')
    onChanged?.()
  }

  // ── render ────────────────────────────────────────────────────────
  const wrap = (children) => (
    <div style={{
      padding: '14px 22px',
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--bg-secondary)',
      flexShrink: 0,
    }}>{children}</div>
  )

  // 情境 1：我是加簽人
  if (isMyExtraAssignment) {
    return wrap(
      <>
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 10,
          background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)',
          fontSize: 14, fontWeight: 700,
        }}>
          🪶 加簽待你處理
          {pendingExtra?.reason && (
            <div style={{ fontSize: 13, fontWeight: 400, marginTop: 4, color: 'var(--text-primary)' }}>
              原因：{pendingExtra.reason}
            </div>
          )}
        </div>
        {!showExtraReject ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <AsyncButton className="btn btn-primary" style={{ flex: 3, padding: '10px' }}
              onClick={() => processExtra('approve')} busyLabel="處理中…" disabled={busy}>
              <Check size={16} /> 核准加簽
            </AsyncButton>
            <button className="btn btn-secondary" style={{
              flex: 1, padding: '10px', color: 'var(--accent-red)',
              borderColor: 'var(--accent-red)',
            }} onClick={() => setShowExtraReject(true)}>
              <X size={16} /> 退回
            </button>
          </div>
        ) : (
          <div>
            <textarea className="input" rows={3}
              value={extraRejectReason}
              onChange={(e) => setExtraRejectReason(e.target.value)}
              placeholder="退回加簽原因（必填，整單會一起退回）"
              style={{ width: '100%', resize: 'vertical', marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary"
                onClick={() => { setShowExtraReject(false); setExtraRejectReason('') }}>取消</button>
              <AsyncButton className="btn btn-primary"
                style={{ background: 'var(--accent-red)' }}
                onClick={() => processExtra('reject')} busyLabel="處理中…"
                disabled={busy || !extraRejectReason.trim()}>確認退回</AsyncButton>
            </div>
          </div>
        )}
      </>
    )
  }

  // 情境 2：加簽中
  if (pendingExtra) {
    const assigneeName = employees.find(e => e.id === pendingExtra.assignee_id)?.name || '加簽人'
    return wrap(
      <div style={{
        padding: '12px 14px', borderRadius: 8,
        background: 'var(--accent-orange-dim)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-orange)' }}>
            🪶 加簽中：{assigneeName}
          </div>
          {pendingExtra.reason && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              原因：{pendingExtra.reason}
            </div>
          )}
        </div>
        {isMyExtraRequest && (
          <AsyncButton className="btn btn-secondary"
            style={{ color: 'var(--accent-orange)', borderColor: 'var(--accent-orange)' }}
            onClick={cancelExtra} busyLabel="…" disabled={busy}>
            撤銷加簽
          </AsyncButton>
        )}
      </div>
    )
  }

  // 情境 3：正常
  return wrap(
    <>
      {/* idle / 預設按鈕：hideExtra=true 只顯示核准/退回；否則三鈕 */}
      {mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <AsyncButton className="btn btn-primary" style={{ flex: 3, padding: '10px' }}
            onClick={doApprove} busyLabel="處理中…">
            <Check size={16} /> {approveLabel}
          </AsyncButton>
          <button className="btn btn-secondary"
            style={{ flex: 1, padding: '10px', color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}
            onClick={() => setMode('rejecting')}>
            <X size={16} /> {rejectLabel}
          </button>
          {!hideExtra && (
            <button className="btn btn-secondary"
              style={{ flex: 1.5, padding: '10px', color: 'var(--accent-orange)', borderColor: 'var(--accent-orange)', borderStyle: 'dashed' }}
              onClick={() => setMode('adding')}>
              <Feather size={16} /> 加簽
            </button>
          )}
        </div>
      )}

      {/* 退回原因 inline */}
      {mode === 'rejecting' && (
        <div>
          <textarea className="input" rows={3}
            value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
            placeholder={`${rejectLabel}原因（必填）`}
            style={{ width: '100%', resize: 'vertical', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => { setMode('idle'); setRejectReason('') }}>取消</button>
            <AsyncButton className="btn btn-primary" style={{ background: 'var(--accent-red)' }}
              onClick={doReject} busyLabel="處理中…" disabled={!rejectReason.trim()}>確認{rejectLabel}</AsyncButton>
          </div>
        </div>
      )}

      {/* 加簽 inline form（hideExtra 時不渲染）*/}
      {mode === 'adding' && !hideExtra && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            🪶 邀請第三人協助加簽（會插在當前簽核者之前）
          </div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            加簽人 <span style={{ color: 'var(--accent-red)' }}>*</span>
          </label>
          <div style={{ marginBottom: 10 }}>
            <SearchableSelect
              value={extraAssignee}
              onChange={setExtraAssignee}
              options={empOptions(employees.filter(e => e.id !== me && e.id !== row.employee_id))}
              placeholder="搜尋同事姓名…"
            />
          </div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            加簽原因（選填，但建議填）
          </label>
          <textarea className="input" rows={2}
            value={extraReason} onChange={(e) => setExtraReason(e.target.value)}
            placeholder="例：金額較高，請會計師先看"
            style={{ width: '100%', resize: 'vertical', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary"
              onClick={() => { setMode('idle'); setExtraAssignee(null); setExtraReason('') }}>取消</button>
            <AsyncButton className="btn btn-primary"
              style={{ background: 'var(--accent-orange)' }}
              onClick={submitExtra} busyLabel="送出中…" disabled={busy || !extraAssignee}>
              送出加簽請求
            </AsyncButton>
          </div>
        </div>
      )}
    </>
  )
}
