import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

const STATUS_BADGE = {
  '待審核': { bg: 'rgba(99,102,241,0.12)',  color: '#6366f1' },
  '已核准': { bg: 'rgba(34,197,94,0.12)',  color: 'var(--accent-green)' },
  '已退回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
}

export default function OffRequests() {
  const { profile, role, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const isAdmin = ['super_admin','admin','manager'].includes(role?.name || profile?.role)
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState(null)

  const load = async () => {
    setLoading(true)
    let q = supabase.from('off_requests')
      .select('*')
      .is('deleted_at', null)
      .order('id', { ascending: false })
    if (profile?.organization_id) q = q.eq('organization_id', profile.organization_id)
    if (!isAdmin && profile?.name) q = q.eq('employee', profile.name)
    const { data } = await q
    setList(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [profile?.organization_id, profile?.name, isAdmin])

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動開明細
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

  // 走 SECURITY DEFINER RPC，避免 RLS 卡關 + 驗權限（HR 簽核者）
  const doApprove = async () => {
    if (!detailRow) return
    const { data, error } = await supabase.rpc('web_approve_off_request', {
      p_id: detailRow.id, p_action: 'approve', p_reason: null,
    })
    if (error) { toast.error('核准失敗：' + error.message); return }
    if (!data?.ok) { toast.error('核准失敗：' + (data?.error || 'unknown')); return }
    toast.success('已核准')
  }
  const doReject = async (_r, reason) => {
    if (!detailRow) return
    const { data, error } = await supabase.rpc('web_approve_off_request', {
      p_id: detailRow.id, p_action: 'reject', p_reason: reason,
    })
    if (error) { toast.error('退回失敗：' + error.message); return }
    if (!data?.ok) { toast.error('退回失敗：' + (data?.error || 'unknown')); return }
    toast.success('已退回')
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '移至最近刪除？可在 60 天內復原。' }))) return
    const { error } = await supabase.rpc('soft_delete_request', { p_table: 'off_requests', p_id: row.id })
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已移至最近刪除')
    load()
  }

  if (loading) return <LoadingSpinner />

  const pending = list.filter(r => r.status === '待審核').length
  const canApproveRow = (r) => isAdmin && r.status === '待審核' && r.employee !== profile?.name

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><CalendarOff size={20} style={{ display: 'inline', marginRight: 6 }} />希望休</h2>
            <p>共 {list.length} 筆 · 待審核 {pending} 筆</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>希望休日期</th>
                <th>原因</th>
                <th>申請時間</th>
                <th>狀態</th>
                <th>簽核者</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無希望休申請</td></tr>
              )}
              {list.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                return (
                  <tr key={r.id} onClick={() => setDetailRow(r)} style={{ cursor: 'pointer' }} title="點擊查看明細">
                    <td><b>{r.employee}</b>{r.store ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.store}</div> : null}</td>
                    <td>{r.date}</td>
                    <td style={{ fontSize: 13 }}>{r.reason || '—'}</td>
                    <td style={{ fontSize: 12 }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{r.status}</span>
                      {r.reject_reason && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{r.reject_reason}</div>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {r.approver_name || '—'}
                      {r.approved_at && <div style={{ fontSize: 10 }}>{r.approved_at.slice(0, 10)}</div>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canDeleteAll && (
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(r)} title="永久刪除">
                          刪除
                        </button>
                      )}
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
          docTitle="希望休申請"
          docNo={detailRow.id}
          status={detailRow.status}
          applicant={{
            name: detailRow.employee,
            status: '在職',
          }}
          fields={[
            { label: '希望休日期', value: detailRow.date },
            { label: '原因', value: detailRow.reason || '—', multiline: true },
            ...(detailRow.store ? [{ label: '門市', value: detailRow.store }] : []),
            ...(detailRow.reject_reason ? [{ label: '退回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ...(detailRow.approver_name ? [{ label: '簽核者', value: detailRow.approver_name }] : []),
          ]}
          createdAt={detailRow.created_at}
          chainSteps={[]}
          actions={
            canApproveRow(detailRow) ? {
              sourceTable: 'off_requests',
              row: detailRow,
              onApprove: doApprove,
              onReject: doReject,
              onChanged: () => { load(); setDetailRow(null) },
              rejectLabel: '退回',
              hideExtra: true,  // 希望休不支援加簽
            } : null
          }
        />
      )}
    </div>
  )
}
