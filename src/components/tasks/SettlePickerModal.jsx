import { useState, useEffect } from 'react'
import { ModalOverlay } from '../Modal'
import LoadingSpinner from '../LoadingSpinner'
import { supabase } from '../../lib/supabase'
import { toast } from '../../lib/toast'

const SETTLEABLE = ['已核准', '待核銷', '核銷已退回']
const CUR_SYM = { TWD: 'NT$', USD: 'US$', JPY: '¥', CNY: '¥', EUR: '€', NZD: 'NZ$', AUD: 'A$' }
const fmt = (n, c) => `${CUR_SYM[c] || (c ?? 'NT$')} ${Number(n || 0).toLocaleString()}`

/**
 * SettlePickerModal — 驗收段尚未綁單時，挑一張「待驗收」的費用申請單。
 *
 * 多組申請/驗收拆在不同步驟時，無法自動配對 → 由人挑要驗收哪張。
 * 範圍：同流程(workflow_instance)優先；任務不在流程則退回全公司待驗收。
 * 已被其他驗收段認領(form_id)的單會排除。
 *
 * props: { binding, task, onClose, onPicked(requestId) }
 */
export default function SettlePickerModal({ binding, task, onClose, onPicked }) {
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const instId = task?.workflow_instance_id || null
        let reqIds = null
        if (instId) {
          // 同流程的「申請段」綁定 → 它們建出的費用申請單
          const { data: applyB } = await supabase
            .from('task_form_bindings')
            .select('form_id, tasks!inner(workflow_instance_id)')
            .in('form_type', ['expense_request', 'expense_apply'])
            .not('form_id', 'is', null)
            .eq('tasks.workflow_instance_id', instId)
          reqIds = [...new Set((applyB || []).map(b => b.form_id))]
          if (reqIds.length === 0) { if (alive) { setCandidates([]); setLoading(false) } return }
        }

        // 待驗收的費用申請單
        let q = supabase.from('expense_requests')
          .select('id, title, employee, estimated_amount, currency, status, created_at')
          .is('deleted_at', null)
          .in('status', SETTLEABLE)
          .order('created_at', { ascending: false })
        if (reqIds) q = q.in('id', reqIds)
        else q = q.limit(50)  // 不在流程內：列最近 50 張待驗收
        const { data: reqs } = await q

        // 排除已被其他驗收段認領的單
        const { data: claimed } = await supabase
          .from('task_form_bindings')
          .select('form_id')
          .eq('form_type', 'expense_settle')
          .not('form_id', 'is', null)
        const claimedSet = new Set((claimed || []).map(c => c.form_id))
        const list = (reqs || []).filter(r => !claimedSet.has(r.id))
        if (alive) { setCandidates(list); setLoading(false) }
      } catch (e) {
        if (alive) { toast.error('載入待驗收單失敗：' + (e.message || '')); setLoading(false) }
      }
    })()
    return () => { alive = false }
  }, [task?.workflow_instance_id])

  const pick = async (req) => {
    setSaving(true)
    try {
      const { error } = await supabase.from('task_form_bindings')
        .update({ form_id: req.id }).eq('id', binding.id)
      if (error) throw error
      toast.success(`已選定費用申請單 #${req.id}`)
      onPicked?.(req.id)
    } catch (e) {
      toast.error('選定失敗：' + (e.message || ''))
      setSaving(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal-shell modal-md" style={{ animation: 'fadeIn 0.15s ease', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-shell-header">
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>選擇要驗收的費用申請單</h3>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div className="modal-shell-body" style={{ padding: 16 }}>
          {loading ? <LoadingSpinner /> : candidates.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              目前沒有可核銷的費用申請單<br />
              <span style={{ fontSize: 12 }}>（需有「已核准 / 待核銷」狀態，且尚未被其他驗收步驟認領）</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {candidates.map(r => (
                <button key={r.id} type="button" disabled={saving} onClick={() => pick(r)}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, opacity: saving ? 0.6 : 1,
                  }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      #{r.id} {r.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {r.employee} · {r.status}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', whiteSpace: 'nowrap' }}>
                    {fmt(r.estimated_amount, r.currency)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}
