import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { toast } from '../../lib/toast'

const STATUS_BADGE = {
  '待對方同意': { bg: 'rgba(99,102,241,0.12)',  color: '#6366f1' },
  '待主管核准': { bg: 'rgba(251,146,60,0.12)',  color: 'var(--accent-orange)' },
  '已通過':     { bg: 'rgba(34,197,94,0.12)',   color: 'var(--accent-green)' },
  '已拒絕':     { bg: 'rgba(239,68,68,0.12)',   color: 'var(--accent-red)' },
  '已駁回':     { bg: 'rgba(239,68,68,0.12)',   color: 'var(--accent-red)' },
}

export default function ShiftSwaps() {
  const { profile } = useAuth()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState(null)

  const load = async () => {
    setLoading(true)
    let q = supabase.from('shift_swaps')
      .select('*, source:employees!source_id(id,name), target:employees!target_id(id,name)')
      .order('id', { ascending: false })
    if (profile?.organization_id) q = q.eq('organization_id', profile.organization_id)
    const { data } = await q
    setList(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [profile?.organization_id])

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

  // ── 我可以做什麼判斷 ──
  // peer 同意：我是 target_id 且 status='待對方同意'
  // manager 核准：我是 store manager 或有 schedule.approve 權限 且 status='待主管核准'
  const myRole = (r) => {
    if (!profile?.id) return null
    if (r.status === '待對方同意' && r.target_id === profile.id) return 'peer'
    if (r.status === '待主管核准' && r.source_id !== profile.id && r.target_id !== profile.id) return 'manager'
    return null
  }

  const doApprovePeer = async () => {
    const r = detailRow
    const { error } = await supabase.from('shift_swaps').update({
      status: '待主管核准',
      peer_responded_at: new Date().toISOString(),
    }).eq('id', r.id)
    if (error) { toast.error('同意失敗：' + error.message); return }
    toast.success('已同意，等主管核准')
  }
  const doRejectPeer = async (_r, reason) => {
    const r = detailRow
    const { error } = await supabase.from('shift_swaps').update({
      status: '已拒絕',
      peer_responded_at: new Date().toISOString(),
      reject_reason: reason,
    }).eq('id', r.id)
    if (error) { toast.error('拒絕失敗：' + error.message); return }
    toast.success('已拒絕')
  }
  const doApproveManager = async () => {
    const r = detailRow
    const { error } = await supabase.from('shift_swaps').update({
      status: '已通過',
      approver_id: profile?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', r.id)
    if (error) { toast.error('核准失敗：' + error.message); return }
    toast.success('已核准')
  }
  const doRejectManager = async (_r, reason) => {
    const r = detailRow
    const { error } = await supabase.from('shift_swaps').update({
      status: '已駁回',
      approver_id: profile?.id,
      approved_at: new Date().toISOString(),
      reject_reason: reason,
    }).eq('id', r.id)
    if (error) { toast.error('駁回失敗：' + error.message); return }
    toast.success('已駁回')
  }

  if (loading) return <LoadingSpinner />

  const peerCount = list.filter(r => r.status === '待對方同意' && r.target_id === profile?.id).length
  const managerCount = list.filter(r => r.status === '待主管核准').length

  const detailRoleNow = detailRow ? myRole(detailRow) : null
  const actions = detailRoleNow === 'peer' ? {
    sourceTable: 'shift_swaps', row: detailRow,
    onApprove: doApprovePeer, onReject: doRejectPeer,
    onChanged: () => { load(); setDetailRow(null) },
    approveLabel: '同意', rejectLabel: '拒絕', hideExtra: true,
  } : detailRoleNow === 'manager' ? {
    sourceTable: 'shift_swaps', row: detailRow,
    onApprove: doApproveManager, onReject: doRejectManager,
    onChanged: () => { load(); setDetailRow(null) },
    approveLabel: '核准', rejectLabel: '駁回', hideExtra: true,
  } : null

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><RefreshCcw size={20} style={{ display: 'inline', marginRight: 6 }} />換班申請</h2>
            <p>
              共 {list.length} 筆
              {peerCount > 0 && <span style={{ marginLeft: 8, color: '#6366f1' }}>· 等我同意 {peerCount} 筆</span>}
              {managerCount > 0 && <span style={{ marginLeft: 8, color: 'var(--accent-orange)' }}>· 等主管核准 {managerCount} 筆</span>}
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>申請人</th>
                <th>對方</th>
                <th>換班日期</th>
                <th>狀態</th>
                <th>申請時間</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無換班申請</td></tr>
              )}
              {list.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                return (
                  <tr key={r.id} onClick={() => setDetailRow(r)} style={{ cursor: 'pointer' }} title="點擊查看明細">
                    <td><b>{r.source?.name || `#${r.source_id}`}</b></td>
                    <td>{r.target?.name || `#${r.target_id}`}</td>
                    <td>
                      {r.source_date || r.date || '—'}
                      {r.target_date && r.target_date !== r.source_date && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>↔ {r.target_date}</div>}
                    </td>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{r.status}</span>
                      {r.reject_reason && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{r.reject_reason}</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
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
          docTitle="換班申請"
          docNo={detailRow.id}
          status={detailRow.status}
          applicant={{
            name: detailRow.source?.name || `員工 #${detailRow.source_id}`,
            status: '在職',
          }}
          fields={[
            { label: '申請人', value: detailRow.source?.name },
            { label: '對方', value: detailRow.target?.name },
            { label: '換班日期', value: detailRow.source_date || detailRow.date },
            ...(detailRow.target_date && detailRow.target_date !== detailRow.source_date
              ? [{ label: '對方日期', value: detailRow.target_date }] : []),
            ...(detailRow.reason ? [{ label: '原因', value: detailRow.reason, multiline: true }] : []),
            ...(detailRow.reject_reason ? [{ label: '退回原因', value: detailRow.reject_reason, multiline: true }] : []),
          ]}
          createdAt={detailRow.created_at}
          chainSteps={[]}
          actions={actions}
        />
      )}
    </div>
  )
}
