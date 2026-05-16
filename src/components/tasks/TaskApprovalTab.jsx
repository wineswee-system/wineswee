import { X } from 'lucide-react'
import SearchableSelect, { empOptions } from '../SearchableSelect'
import {
  createTaskConfirmation, updateTaskConfirmation, deleteTaskConfirmation,
  createApprovalForm, updateApprovalForm,
  createApprovalFormSteps, updateApprovalFormStep,
  updateTask,
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { notifyApproval } from '../../lib/lineNotify'

const PRIORITY_LIST = ['低', '中', '高']

const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
const sectionStyle = {
  padding: '16px 20px', marginBottom: 12, borderRadius: 10,
  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
}

export default function TaskApprovalTab({
  task,
  profile,
  employees,
  form, setAndDirty,
  confirmations, setConfirmations,
  newConfirmApprover, setNewConfirmApprover,
  newConfirmPriority, setNewConfirmPriority,
  approvalChains,
  approvalForm, setApprovalForm,
  approvalSteps, setApprovalSteps,
  approvalPriority, setApprovalPriority,
  approvalMode, setApprovalMode,
  openInput, closeInput,
  onUpdate,
}) {

  // ── Task Confirmations ──
  const handleAddConfirmation = async () => {
    if (!newConfirmApprover) return
    if (confirmations.some(c => c.approver === newConfirmApprover)) return
    const mode = form.confirmation_mode || task.confirmation_mode || 'parallel'
    const hasActive = confirmations.some(c => c.status === 'pending')
    const initialStatus = (mode === 'sequential' && hasActive) ? 'waiting' : 'pending'
    const { data } = await createTaskConfirmation({
      task_id: task.id,
      approver: newConfirmApprover,
      status: initialStatus,
      priority: newConfirmPriority,
    })
    if (data) {
      setConfirmations(prev => [...prev, data])
      if (initialStatus === 'pending') {
        notifyApproval(newConfirmApprover, task.title, `請求審批（${newConfirmPriority}）`, { store: task.store || null })
      }
      setNewConfirmApprover('')
      setNewConfirmPriority('中')
    }
  }

  const handleConfirmationAction = async (id, status, notes) => {
    const { data } = await updateTaskConfirmation(id, {
      status,
      notes: notes || null,
      responded_at: new Date().toISOString(),
    })
    if (!data) return

    const mode = form.confirmation_mode || task.confirmation_mode || 'parallel'
    let next = confirmations.map(c => c.id === id ? data : c)
    if (mode === 'sequential' && (status === 'approved' || status === 'rejected') && !task.approval_chain_id) {
      const stillPending = next.some(c => c.status === 'pending')
      if (!stillPending) {
        const priRank = { '高': 0, '中': 1, '低': 2 }
        const nextWaiting = next
          .filter(c => c.status === 'waiting')
          .sort((a, b) => (priRank[a.priority] ?? 1) - (priRank[b.priority] ?? 1) || a.id - b.id)[0]
        if (nextWaiting) {
          const { data: promoted } = await updateTaskConfirmation(nextWaiting.id, { status: 'pending' })
          if (promoted) {
            notifyApproval(promoted.approver, task.title, `請求審批（${promoted.priority || '中'}）`, { store: task.store || null })
          }
        }
      }
    }

    if (task.approval_chain_id) {
      const { data: all } = await supabase.from('task_confirmations').select('*').eq('task_id', task.id).order('created_at')
      setConfirmations(all || [])
      const { data: refreshedTask } = await supabase.from('tasks').select('*').eq('id', task.id).single()
      if (refreshedTask) onUpdate(refreshedTask)
    } else {
      setConfirmations(next)
    }
  }

  const handleRemoveConfirmation = async (id) => {
    await deleteTaskConfirmation(id)
    setConfirmations(prev => prev.filter(c => c.id !== id))
  }

  // ── Approval Form / Chain ──
  const handleStartApproval = async (chainId) => {
    if (!chainId) return
    const chain = approvalChains.find(c => c.id === Number(chainId))
    if (!chain) return
    const { data: approvalFormData } = await createApprovalForm({
      title: `${task.title} — 簽核`,
      applicant: profile?.name || task.assignee || '系統',
      chain_id: chain.id,
      ref_task_id: task.id,
      status: '簽核中',
      current_step: 0,
      priority: approvalPriority,
      mode: approvalMode,
    })
    if (!approvalFormData) return
    setApprovalForm(approvalFormData)
    const chainSteps = chain.steps || []
    const stepRows = chainSteps.map((s, i) => ({
      form_id: approvalFormData.id,
      step_order: i + 1,
      role: s.role,
      status: approvalMode === 'parallel' ? '待簽' : (i === 0 ? '待簽' : '等待中'),
    }))
    const { data: steps } = await createApprovalFormSteps(stepRows)
    setApprovalSteps(steps || [])
    const notifyExtras = { chainName: chain.name, category: chain.category, store: approvalFormData.store || null, approvedSteps: [] }
    if (approvalMode === 'parallel') {
      chainSteps.forEach((s, i) => {
        if (s.role) notifyApproval(s.role, task.title, `第 ${i + 1} 關：${s.label || s.role}（同時審核）`, notifyExtras)
      })
    } else {
      const firstStep = chainSteps[0]
      if (firstStep?.role) {
        notifyApproval(firstStep.role, task.title, `第 1 關：${firstStep.label || firstStep.role}`, {
          ...notifyExtras,
          pendingSteps: chainSteps.slice(1).map(s => ({ name: s.label || s.role })),
        })
      }
    }
  }

  const handleApprovalAction = async (formStepId, action, comment) => {
    const newStatus = action === 'approve' ? '已核准' : '已退回'
    const currentUser = profile?.name || task.assignee || '系統'
    const { data } = await updateApprovalFormStep(formStepId, {
      status: newStatus,
      approver: currentUser,
      comment: comment || null,
      acted_at: new Date().toISOString(),
    })
    if (!data) return
    const updated = approvalSteps.map(s => s.id === formStepId ? data : s)
    setApprovalSteps(updated)

    if (action === 'reject') {
      const { data: f } = await updateApprovalForm(approvalForm.id, { status: '已退回' })
      if (f) setApprovalForm(f)
      return
    }

    if (approvalMode === 'parallel') {
      const allDone = updated.every(s => s.status === '已核准')
      if (allDone) {
        const { data: f } = await updateApprovalForm(approvalForm.id, {
          status: '已通過', completed_at: new Date().toISOString(),
        })
        if (f) setApprovalForm(f)
        const { data: completedTask } = await updateTask(task.id, {
          status: '已完成', completed_at: new Date().toISOString(),
        })
        if (completedTask) onUpdate(completedTask)
      }
    } else {
      const nextStep = updated.find(s => s.status === '等待中')
      if (nextStep) {
        const { data: ns } = await updateApprovalFormStep(nextStep.id, { status: '待簽' })
        if (ns) setApprovalSteps(prev => prev.map(s => s.id === ns.id ? ns : s))
        await updateApprovalForm(approvalForm.id, { current_step: nextStep.step_order })
        const chain = approvalChains.find(c => c.id === approvalForm.chain_id)
        const stepDef = chain?.steps?.[nextStep.step_order - 1]
        if (nextStep.role) notifyApproval(nextStep.role, approvalForm.title, `第 ${nextStep.step_order} 關：${stepDef?.label || nextStep.role}`, {
          chainName: chain?.name || null, category: chain?.category || null,
          store: task.store || null,
          approvedSteps: updated.filter(s => s.status === '已核准').map(s => ({ name: s.approver, actedAt: s.acted_at })),
          pendingSteps: updated.filter(s => s.status === '等待中').map(s => ({ name: s.role })),
        }).catch(() => {})
      } else {
        const { data: f } = await updateApprovalForm(approvalForm.id, {
          status: '已通過', completed_at: new Date().toISOString(),
        })
        if (f) setApprovalForm(f)
        const { data: completedTask } = await updateTask(task.id, {
          status: '已完成', completed_at: new Date().toISOString(),
        })
        if (completedTask) onUpdate(completedTask)
      }
    }
  }

  const handleUpdateApprovalMeta = async (patch) => {
    if (!approvalForm) return
    const { data } = await updateApprovalForm(approvalForm.id, patch)
    if (data) setApprovalForm(data)
  }

  return (
    <>
      {/* ═══ 確認審批 ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🔐 確認審批 ({confirmations.length})</span>
          {confirmations.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
              已回應 {confirmations.filter(c => c.status !== 'pending' && c.status !== 'waiting').length}/{confirmations.length}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          指定員工審批本任務。不需走完整簽核鏈時使用。
        </div>

        {/* 審核方式 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>審核方式</div>
          <select className="form-input" style={{ width: '100%', fontSize: 12 }}
            value={form.confirmation_mode || 'parallel'}
            onChange={e => setAndDirty('confirmation_mode', e.target.value)}>
            <option value="parallel">⚡ 同時（全部一起審）</option>
            <option value="sequential">🔀 依序（一位審完再換下一位）</option>
          </select>
          {(form.confirmation_mode === 'sequential') && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              依序模式：同一時間只有一位在「待審批」，前一位回應後自動換下一位（依優先度 高→中→低）。
            </div>
          )}
        </div>

        {confirmations.map(c => {
          const isDone = c.status === 'approved'
          const isRejected = c.status === 'rejected'
          const isWaiting = c.status === 'waiting'
          const pri = c.priority || '中'
          const priColor = pri === '高' ? 'var(--accent-red)' : pri === '低' ? 'var(--text-muted)' : 'var(--accent-orange)'
          const badgeLabel = isDone ? '✅ 已審批'
            : isRejected ? '❌ 已拒絕'
            : isWaiting ? '🕐 排隊中'
            : '⏳ 待審批'
          const badgeBg = isDone ? 'var(--accent-green-dim)'
            : isRejected ? 'var(--accent-red-dim)'
            : isWaiting ? 'var(--glass-light)'
            : 'var(--accent-orange-dim)'
          const badgeColor = isDone ? 'var(--accent-green)'
            : isRejected ? 'var(--accent-red)'
            : isWaiting ? 'var(--text-muted)'
            : 'var(--accent-orange)'
          return (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px',
              background: 'var(--glass-light)', borderRadius: 8, marginBottom: 6,
              border: '1px solid var(--border-subtle)',
              opacity: isWaiting ? 0.7 : 1,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>👤 {c.approver}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    border: `1px solid ${priColor}`, color: priColor, fontWeight: 700,
                  }}>{pri}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    background: badgeBg, color: badgeColor,
                  }}>{badgeLabel}</span>
                </div>
                {c.responded_at && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    已回應 · {new Date(c.responded_at).toLocaleString('zh-TW')}
                  </div>
                )}
                {c.notes && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                    💬 {c.notes}
                  </div>
                )}
                {c.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className="btn btn-sm"
                      style={{ background: 'var(--accent-green)', color: '#fff', border: 'none', padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: 'pointer' }}
                      onClick={() => openInput(
                        '審批確認',
                        '審批備註（可留空）：',
                        (n) => { closeInput(); handleConfirmationAction(c.id, 'approved', n || null) },
                        { placeholder: '選填', required: false }
                      )}>✅ 審批</button>
                    <button className="btn btn-sm"
                      style={{ background: 'var(--accent-red)', color: '#fff', border: 'none', padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: 'pointer' }}
                      onClick={() => openInput(
                        '拒絕確認',
                        '拒絕原因：',
                        (n) => { closeInput(); handleConfirmationAction(c.id, 'rejected', n) },
                        { placeholder: '請填寫拒絕原因', required: true }
                      )}>❌ 拒絕</button>
                  </div>
                )}
              </div>
              <button onClick={() => handleRemoveConfirmation(c.id)} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
              }}><X size={14} /></button>
            </div>
          )
        })}

        {/* Add confirmation */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <SearchableSelect
              value={newConfirmApprover}
              onChange={(v) => setNewConfirmApprover(v || '')}
              options={empOptions(
                employees.filter(emp => !confirmations.some(c => c.approver === emp.name)),
                { keyBy: 'name' }
              )}
              placeholder="＋ 搜尋員工..."
            />
          </div>
          <select className="form-input" style={{ width: 90, fontSize: 12 }}
            value={newConfirmPriority} onChange={e => setNewConfirmPriority(e.target.value)}>
            {PRIORITY_LIST.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={handleAddConfirmation}
            disabled={!newConfirmApprover}
            style={{ fontSize: 12, padding: '6px 12px' }}>加入</button>
        </div>
      </div>

      {/* ═══ 簽核流程 ═══ */}
      <div style={{
        ...sectionStyle,
        border: '2px solid var(--accent-purple)',
        background: 'linear-gradient(135deg, var(--bg-card), rgba(139,92,246,0.05))',
      }}>
        <div style={{ ...labelStyle, marginTop: 0, color: 'var(--accent-purple)', fontSize: 14 }}>
          🔏 簽核流程
        </div>

        {task.approval_chain_id ? (
          <div style={{
            padding: 12, borderRadius: 8,
            background: 'var(--accent-cyan-dim)',
            border: '1px solid var(--accent-cyan-dim)',
            color: 'var(--text-secondary)',
            fontSize: 13, lineHeight: 1.6,
          }}>
            {(() => {
              const chain = approvalChains.find(c => c.id === task.approval_chain_id)
              const totalSteps = chain?.steps?.length ?? '?'
              const hasConf = confirmations.length > 0
              const isApproved = task.confirmation_status === 'approved'
              const isRejected = task.confirmation_status === 'rejected'
              return (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--accent-cyan)' }}>
                    🔗 已綁定簽核鏈：{chain?.name || `#${task.approval_chain_id}`}（{totalSteps} 關）
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {isApproved ? '✅ 簽核完成，任務已標記完成。' :
                     isRejected ? '❌ 簽核已退回，任務退回進行中。' :
                     hasConf ? '⏳ 簽核進行中 — 進度請見上面「確認審批」面板。' :
                     '完成任務時自動啟動，按「儲存」並把狀態改成「已完成」就會建第一關簽核者。'}
                  </div>
                </>
              )
            })()}
          </div>
        ) : !approvalForm ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>尚未啟動簽核，設定後選擇簽核鏈開始</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>優先度</div>
                <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                  value={approvalPriority} onChange={e => setApprovalPriority(e.target.value)}>
                  {PRIORITY_LIST.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>審核方式</div>
                <select className="form-input" style={{ width: '100%', fontSize: 12 }}
                  value={approvalMode} onChange={e => setApprovalMode(e.target.value)}>
                  <option value="sequential">🔀 依序（一關接一關）</option>
                  <option value="parallel">⚡ 同時（全部一起審）</option>
                </select>
              </div>
            </div>
            <select className="form-input" style={{ width: '100%', fontSize: 13 }}
              value="" onChange={e => handleStartApproval(e.target.value)}>
              <option value="">＋ 選擇簽核鏈以啟動...</option>
              {approvalChains.map(ac => (
                <option key={ac.id} value={ac.id}>
                  {ac.name} ({(ac.steps || []).length} 關)
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            {/* Form status summary */}
            {(() => {
              const respondedCount = approvalSteps.filter(s => s.acted_at).length
              const totalCount = approvalSteps.length
              const pri = approvalForm.priority || '中'
              const priColor = pri === '高' ? 'var(--accent-red)' : pri === '低' ? 'var(--text-muted)' : 'var(--accent-orange)'
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    background: approvalForm.status === '已通過' ? 'var(--accent-green-dim)' :
                      approvalForm.status === '已退回' ? 'var(--accent-red-dim)' : 'var(--accent-purple-dim)',
                    color: approvalForm.status === '已通過' ? 'var(--accent-green)' :
                      approvalForm.status === '已退回' ? 'var(--accent-red)' : 'var(--accent-purple)',
                    border: `1px solid ${approvalForm.status === '已通過' ? 'var(--accent-green-dim)' :
                      approvalForm.status === '已退回' ? 'var(--accent-red-dim)' : 'var(--accent-purple-dim)'}`,
                  }}>
                    {approvalForm.status === '已通過' ? '✅ 已通過' : approvalForm.status === '已退回' ? '❌ 已退回' : '⏳ 簽核中'}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                    border: `1px solid ${priColor}`, color: priColor,
                  }}>優先度 {pri}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                    background: 'var(--glass-light)', color: 'var(--text-secondary)',
                  }}>{(approvalForm.mode || 'sequential') === 'parallel' ? '⚡ 同時審' : '🔀 依序審'}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                    background: 'var(--glass-light)', color: 'var(--text-secondary)',
                  }}>已回應 {respondedCount}/{totalCount}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    申請人：{approvalForm.applicant}
                  </span>
                  {approvalForm.status === '簽核中' && (
                    <select className="form-input" style={{ fontSize: 11, padding: '2px 6px', width: 72 }}
                      value={approvalForm.priority || '中'}
                      onChange={e => handleUpdateApprovalMeta({ priority: e.target.value })}>
                      {PRIORITY_LIST.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                </div>
              )
            })()}

            {/* Steps timeline */}
            <div style={{ position: 'relative', paddingLeft: 24 }}>
              <div style={{
                position: 'absolute', left: 9, top: 8, bottom: 8, width: 2,
                background: 'var(--border-medium)',
              }} />

              {approvalSteps.map((as, i) => {
                const isActive = as.status === '待簽'
                const isDone = as.status === '已核准'
                const isRejected = as.status === '已退回'
                return (
                  <div key={as.id} style={{ position: 'relative', marginBottom: 16 }}>
                    <div style={{
                      position: 'absolute', left: -24, top: 2,
                      width: 18, height: 18, borderRadius: '50%',
                      background: isDone ? 'var(--accent-green)' : isRejected ? 'var(--accent-red)' :
                        isActive ? 'var(--accent-purple)' : 'var(--border-medium)',
                      border: isActive ? '3px solid var(--accent-purple-dim)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 10, zIndex: 1,
                    }}>
                      {isDone ? '✓' : isRejected ? '✗' : i + 1}
                    </div>

                    <div style={{
                      padding: '10px 14px', borderRadius: 10,
                      background: isActive ? 'var(--accent-purple-dim)' : 'var(--glass-light)',
                      border: `1px solid ${isActive ? 'var(--accent-purple-dim)' : 'var(--border-subtle)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            第 {as.step_order} 關：{as.role || '審核者'}
                          </div>
                          {as.acted_at ? (
                            <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600,
                              color: isRejected ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                              {isRejected ? '❌' : '✅'} 已回應
                              {as.approver && ` · ${as.approver}`}
                              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                                {new Date(as.acted_at).toLocaleString('zh-TW')}
                              </span>
                            </div>
                          ) : isActive ? (
                            <div style={{ fontSize: 11, color: 'var(--accent-purple)', marginTop: 4, fontWeight: 600 }}>
                              ⏳ 等待回應中
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                              尚未輪到此關
                            </div>
                          )}
                          {as.comment && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                              💬 {as.comment}
                            </div>
                          )}
                        </div>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                          background: isDone ? 'var(--accent-green-dim)' : isRejected ? 'var(--accent-red-dim)' :
                            isActive ? 'var(--accent-purple-dim)' : 'var(--glass-light)',
                          color: isDone ? 'var(--accent-green)' : isRejected ? 'var(--accent-red)' :
                            isActive ? 'var(--accent-purple)' : 'var(--text-muted)',
                        }}>
                          {as.status}
                        </span>
                      </div>

                      {isActive && approvalForm.status === '簽核中' && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button
                            className="btn btn-sm"
                            style={{
                              background: 'var(--accent-green)', color: '#fff', border: 'none',
                              padding: '6px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                            }}
                            onClick={() => openInput(
                              '核准簽核',
                              '審核意見（可留空）：',
                              (comment) => { closeInput(); handleApprovalAction(as.id, 'approve', comment || null) },
                              { placeholder: '選填', required: false }
                            )}
                          >
                            ✅ 核准
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{
                              background: 'var(--accent-red)', color: '#fff', border: 'none',
                              padding: '6px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                            }}
                            onClick={() => openInput(
                              '退回簽核',
                              '退回原因：',
                              (comment) => { closeInput(); handleApprovalAction(as.id, 'reject', comment) },
                              { placeholder: '請填寫退回原因', required: true }
                            )}
                          >
                            ❌ 退回
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  )
}
