import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SearchableSelect, { empOptions } from './SearchableSelect'
import AsyncButton from './AsyncButton'
import { ModalOverlay } from './Modal'
import { confirm } from '../lib/confirm'
import { toast } from '../lib/toast'
import { X } from 'lucide-react'

/**
 * 加簽控制元件 — 給 HR 8 表 + expense_request 通用
 *
 * 三情境：
 *   1. 我是加簽人 → 核准加簽 / 退回 兩鈕
 *   2. 有 pending 加簽且不是我 → 加簽中 + 撤銷（限發起人）
 *   3. 正常 → 核准 / 退回（外部負責）+ 🪶 加簽 按鈕（這 component 提供）
 *
 * 用法：
 *   <ExtraSignerControls
 *     sourceTable="leave_requests"
 *     row={leaveRow}             // 必須含 id, current_step, employee_id
 *     onChanged={() => load()}   // 加簽 / 撤銷 / 處理後重新載資料
 *     // 可選：客製 fallback 渲染（沒 pending extra 時，return 你的 核准/退回 按鈕）
 *     renderNormal={() => <>...</>}
 *   />
 */
export default function ExtraSignerControls({
  sourceTable, row, onChanged, renderNormal,
  // 加簽人下拉的篩選（預設排除自己 + 申請人）
  filterEmployees,
}) {
  const { profile } = useAuth()
  const [pendingExtra, setPendingExtra] = useState(null)
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [extraForm, setExtraForm] = useState({ assignee_id: null, reason: '' })

  // 載入 pendingExtra + employees
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
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
  }, [sourceTable, row.id])

  if (loading) return null

  const me = profile?.id
  const isMyExtraRequest = pendingExtra && pendingExtra.requested_by_id === me
  const isMyExtraAssignment = pendingExtra && pendingExtra.assignee_id === me

  // ─── Handlers ──────────────────────────────────────────────────────
  const openModal = () => { setShowModal(true); setExtraForm({ assignee_id: null, reason: '' }) }

  const submitExtra = async () => {
    if (!extraForm.assignee_id) { toast.error('請選擇加簽人'); return }
    const { error } = await supabase.rpc('request_extra_signer', {
      p_source_table: sourceTable,
      p_source_id: row.id,
      p_insert_before_step: row.current_step ?? 0,
      p_assignee_id: extraForm.assignee_id,
      p_requested_by_id: me,
      p_reason: extraForm.reason?.trim() || null,
    })
    if (error) {
      const msg = error.message?.includes('不能對自己加簽') ? '不能對自己加簽'
                : error.message?.includes('已有 pending 加簽') ? '此步驟已有加簽進行中'
                : error.message?.includes('不支援此單據類型') ? '此單據類型不支援加簽'
                : `加簽失敗：${error.message}`
      toast.error(msg)
      return
    }
    toast.success('已送出加簽請求')
    setShowModal(false)
    onChanged?.()
  }

  const cancelExtra = async () => {
    if (!pendingExtra) return
    const ok = await confirm('確定撤銷加簽？加簽人會收到通知')
    if (!ok) return
    const { error } = await supabase.rpc('cancel_extra_signer', {
      p_extra_step_id: pendingExtra.id,
      p_canceller_id: me,
    })
    if (error) { toast.error(`撤銷失敗：${error.message}`); return }
    toast.success('已撤銷加簽')
    onChanged?.()
  }

  const processExtra = async (action) => {
    if (!pendingExtra) return
    let reason = null
    if (action === 'reject') {
      reason = prompt('退回加簽原因（必填）：')
      if (!reason || !reason.trim()) { toast.error('必須填寫退回原因'); return }
    }
    const { error } = await supabase.rpc('process_extra_signer', {
      p_extra_step_id: pendingExtra.id,
      p_processor_id: me,
      p_action: action,
      p_reject_reason: reason?.trim() || null,
    })
    if (error) { toast.error(`${action === 'approve' ? '核准' : '退回'}失敗：${error.message}`); return }
    toast.success(action === 'approve' ? '已核准加簽' : '已退回加簽，整單已退回')
    onChanged?.()
  }

  // ─── Render ────────────────────────────────────────────────────────
  // 情境 1：我是加簽人
  if (isMyExtraAssignment) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-orange)' }}>
          🪶 加簽待你處理
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <AsyncButton className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }}
            onClick={() => processExtra('approve')} busyLabel="…">
            ✓ 核准加簽
          </AsyncButton>
          <AsyncButton className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-red)' }}
            onClick={() => processExtra('reject')} busyLabel="…">
            退回
          </AsyncButton>
        </div>
      </div>
    )
  }

  // 情境 2：加簽中
  if (pendingExtra) {
    const assigneeName = employees.find(e => e.id === pendingExtra.assignee_id)?.name || '加簽人'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
          🪶 加簽中：{assigneeName}
        </span>
        {isMyExtraRequest && (
          <AsyncButton className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
            onClick={cancelExtra} busyLabel="…">
            撤銷
          </AsyncButton>
        )}
      </div>
    )
  }

  // 情境 3：正常 — 由 renderNormal 提供核准/退回，這 component 只加「加簽」按鈕
  return (
    <>
      {renderNormal?.()}
      <button className="btn btn-secondary"
        style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-orange)' }}
        onClick={openModal}
        title="加簽（邀請第三人協助審核）">
        🪶 加簽
      </button>

      {showModal && (
        <ModalOverlay onClick={() => setShowModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>🪶 加簽請求</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 12, padding: 10, background: 'var(--accent-orange-dim)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
              邀請同事在第 {(row.current_step ?? 0) + 1} 關之前協助加簽
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                加簽人 <span style={{ color: 'var(--accent-red)' }}>*</span>
              </label>
              <SearchableSelect
                value={extraForm.assignee_id}
                onChange={(v) => setExtraForm(f => ({ ...f, assignee_id: v }))}
                options={empOptions(employees.filter(e => {
                  if (filterEmployees) return filterEmployees(e)
                  return e.id !== me && e.id !== row.employee_id
                }))}
                placeholder="搜尋同事姓名或部門…"
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                加簽原因（選填，但建議填）
              </label>
              <textarea className="input"
                value={extraForm.reason}
                onChange={(e) => setExtraForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="例：金額較高，請會計師先看"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <AsyncButton className="btn btn-primary" onClick={submitExtra} busyLabel="送出中…"
                disabled={!extraForm.assignee_id}>
                送出加簽請求
              </AsyncButton>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  )
}
