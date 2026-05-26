import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useReturnNav } from '../../lib/useReturnNav'
import { CheckSquare } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { toast } from '../../lib/toast'

const STATUS_BADGE = {
  pending:  { bg: 'rgba(99,102,241,0.12)',  color: '#6366f1',                label: '待確認' },
  approved: { bg: 'rgba(34,197,94,0.12)',   color: 'var(--accent-green)',   label: '已通過' },
  rejected: { bg: 'rgba(239,68,68,0.12)',   color: 'var(--accent-red)',     label: '已退回' },
}

export default function TaskConfirmations() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const returnNav = useReturnNav()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState(null)

  const load = async () => {
    if (!profile?.name) return
    setLoading(true)
    // task_confirmations 用 approver（員工姓名 TEXT）標記簽核者
    let q = supabase.from('task_confirmations')
      .select('*, task:tasks(id, title, description, organization_id, assignee)')
      .eq('approver', profile.name)
      .order('id', { ascending: false })
    const { data } = await q
    const filtered = (data || []).filter(c =>
      !c.task?.organization_id || c.task.organization_id === profile.organization_id
    )
    setList(filtered)
    setLoading(false)
  }
  useEffect(() => { load() }, [profile?.name, profile?.organization_id])

  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !list.length) return
    const row = list.find(r => r.id === Number(focus))
    if (row) {
      setDetailRow(row)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [list, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // 用主系統既有的 web_approve_task_step RPC（2026-05-07 task_chain_unified_db_trigger）
  // RPC 內會用 auth.uid() 解出 emp，自動找到對應的 pending confirmation
  const doApprove = async () => {
    const r = detailRow
    const { data, error } = await supabase.rpc('web_approve_task_step', {
      p_task_id: r.task_id, p_action: 'approve', p_reason: null,
    })
    if (error) { toast.error('核准失敗：' + error.message); return }
    if (!data?.ok) { toast.error('核准失敗：' + (data?.error || 'unknown')); return }
    toast.success('已確認，後續會推進到下一關')
  }
  const doReject = async (_r, reason) => {
    const r = detailRow
    const { data, error } = await supabase.rpc('web_approve_task_step', {
      p_task_id: r.task_id, p_action: 'reject', p_reason: reason,
    })
    if (error) { toast.error('退回失敗：' + error.message); return }
    if (!data?.ok) { toast.error('退回失敗：' + (data?.error || 'unknown')); return }
    toast.success('已退回')
  }

  if (loading) return <LoadingSpinner />

  const pending = list.filter(r => r.status === 'pending').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><CheckSquare size={20} style={{ display: 'inline', marginRight: 6 }} />任務確認</h2>
            <p>共 {list.length} 筆 · 待確認 {pending} 筆</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>任務</th>
                <th>關卡</th>
                <th>狀態</th>
                <th>建立時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>沒有要你確認的任務</td></tr>
              )}
              {list.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                return (
                  <tr key={r.id} onClick={() => setDetailRow(r)} style={{ cursor: 'pointer' }} title="點擊查看明細">
                    <td>
                      <b>{r.task?.title || `任務 #${r.task_id}`}</b>
                      {r.task?.assignee && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>負責人：{r.task.assignee}</div>}
                    </td>
                    <td>第 {(r.step_order ?? 0) + 1} 關</td>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{s.label || r.status}</span>
                      {r.reject_reason && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{r.reject_reason}</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => navigate(`/process/tasks?focus=${r.task_id}`)}>
                        看任務
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {detailRow && (
        <ApprovalDetailModal
          open={!!detailRow}
          onClose={() => setDetailRow(null)}
          docTitle={detailRow.task?.title || `任務確認 #${detailRow.id}`}
          docNo={detailRow.id}
          status={STATUS_BADGE[detailRow.status]?.label || detailRow.status}
          applicant={{
            name: detailRow.task?.assignee || '—',
            status: '在職',
          }}
          fields={[
            { label: '任務 ID', value: `#${detailRow.task_id}` },
            { label: '關卡', value: `第 ${(detailRow.step_order ?? 0) + 1} 關` },
            ...(detailRow.task?.description ? [{ label: '任務說明', value: detailRow.task.description, multiline: true }] : []),
            ...(detailRow.reject_reason ? [{ label: '退回原因', value: detailRow.reject_reason, multiline: true }] : []),
          ]}
          createdAt={detailRow.created_at}
          chainSteps={[]}
          actions={
            detailRow.status === 'pending' ? {
              sourceTable: 'tasks',
              row: detailRow,
              onApprove: doApprove,
              onReject: doReject,
              onChanged: () => { load(); setDetailRow(null); returnNav() },
              approveLabel: '確認', rejectLabel: '退回',
              hideExtra: true,  // task 確認暫不支援加簽
            } : null
          }
        />
      )}
    </div>
  )
}
