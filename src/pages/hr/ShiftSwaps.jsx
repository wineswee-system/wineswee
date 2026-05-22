import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useReturnNav } from '../../lib/useReturnNav'
import { RefreshCcw, Search, X as XIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

const STATUS_BADGE = {
  '待對方同意': { bg: 'rgba(99,102,241,0.12)',  color: '#6366f1' },
  '待主管核准': { bg: 'rgba(251,146,60,0.12)',  color: 'var(--accent-orange)' },
  '已通過':     { bg: 'rgba(34,197,94,0.12)',   color: 'var(--accent-green)' },
  '已拒絕':     { bg: 'rgba(239,68,68,0.12)',   color: 'var(--accent-red)' },
  '已駁回':     { bg: 'rgba(239,68,68,0.12)',   color: 'var(--accent-red)' },
}

export default function ShiftSwaps() {
  const { profile, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [detailRow, setDetailRow] = useState(null)

  const load = async () => {
    setLoading(true)
    // shift_swaps 欄位：requester_id / target_id / swap_date / status / store_id ...
    let q = supabase.from('shift_swaps')
      .select('*, requester_emp:employees!requester_id(id,name), target_emp:employees!target_id(id,name)')
      .is('deleted_at', null)
      .order('id', { ascending: false })
    if (profile?.organization_id) q = q.eq('organization_id', profile.organization_id)
    const { data } = await q
    setList(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [profile?.organization_id])

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動開明細
  const [searchParams, setSearchParams] = useSearchParams()
  const returnNav = useReturnNav()
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
  // manager 核准：我不是雙方 + status='待主管核准'（store manager / schedule.approve 由 RPC 端驗）
  const myRole = (r) => {
    if (!profile?.id) return null
    if (r.status === '待對方同意' && r.target_id === profile.id) return 'peer'
    if (r.status === '待主管核准' && r.requester_id !== profile.id && r.target_id !== profile.id) return 'manager'
    return null
  }

  // peer: web_respond_shift_swap_peer({ agree | reject })
  const doApprovePeer = async () => {
    const r = detailRow
    const { data, error } = await supabase.rpc('web_respond_shift_swap_peer', {
      p_swap_id: r.id, p_action: 'agree', p_reason: null,
    })
    if (error) { toast.error('同意失敗：' + error.message); return }
    if (!data?.ok) { toast.error('同意失敗：' + (data?.error || 'unknown')); return }
    toast.success('已同意，等主管核准')
  }
  const doRejectPeer = async (_r, reason) => {
    const r = detailRow
    const { data, error } = await supabase.rpc('web_respond_shift_swap_peer', {
      p_swap_id: r.id, p_action: 'reject', p_reason: reason,
    })
    if (error) { toast.error('拒絕失敗：' + error.message); return }
    if (!data?.ok) { toast.error('拒絕失敗：' + (data?.error || 'unknown')); return }
    toast.success('已拒絕')
  }
  // manager: web_approve_shift_swap_manager({ approve | reject }) — 含實際 schedules 交換
  const doApproveManager = async () => {
    const r = detailRow
    const { data, error } = await supabase.rpc('web_approve_shift_swap_manager', {
      p_swap_id: r.id, p_action: 'approve', p_reason: null,
    })
    if (error) { toast.error('核准失敗：' + error.message); return }
    if (!data?.ok) { toast.error('核准失敗：' + (data?.error || 'unknown')); return }
    toast.success('已核准（班表已交換）')
  }
  const doRejectManager = async (_r, reason) => {
    const r = detailRow
    const { data, error } = await supabase.rpc('web_approve_shift_swap_manager', {
      p_swap_id: r.id, p_action: 'reject', p_reason: reason,
    })
    if (error) { toast.error('駁回失敗：' + error.message); return }
    if (!data?.ok) { toast.error('駁回失敗：' + (data?.error || 'unknown')); return }
    toast.success('已駁回')
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '移至最近刪除？可在 60 天內復原。' }))) return
    const { error } = await supabase.rpc('soft_delete_request', { p_table: 'shift_swaps', p_id: row.id, p_deleted_by: profile?.id ?? null })
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已移至最近刪除')
    load()
  }

  if (loading) return <LoadingSpinner />

  const displayList = search.trim() ? list.filter(r => String(r.id).includes(search.trim())) : list
  const peerCount = list.filter(r => r.status === '待對方同意' && r.target_id === profile?.id).length
  const managerCount = list.filter(r => r.status === '待主管核准' && r.requester_id !== profile?.id && r.target_id !== profile?.id).length

  const detailRoleNow = detailRow ? myRole(detailRow) : null
  const actions = detailRoleNow === 'peer' ? {
    sourceTable: 'shift_swaps', row: detailRow,
    onApprove: doApprovePeer, onReject: doRejectPeer,
    onChanged: () => { load(); setDetailRow(null); returnNav() },
    approveLabel: '同意', rejectLabel: '拒絕', hideExtra: true,
  } : detailRoleNow === 'manager' ? {
    sourceTable: 'shift_swaps', row: detailRow,
    onApprove: doApproveManager, onReject: doRejectManager,
    onChanged: () => { load(); setDetailRow(null); returnNav() },
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋單號" style={{ paddingLeft: 26, paddingRight: search ? 26 : 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 120 }} />
            {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><XIcon size={12} /></button>}
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 55 }}>單號</th>
                <th>申請人</th>
                <th>對方</th>
                <th>換班日期</th>
                <th>狀態</th>
                <th>申請時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {displayList.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無換班申請</td></tr>
              )}
              {displayList.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                return (
                  <tr key={r.id} onClick={() => setDetailRow(r)} style={{ cursor: 'pointer' }} title="點擊查看明細">
                    <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{r.id}</td>
                    <td><b>{r.requester_emp?.name || r.requester || `#${r.requester_id}`}</b></td>
                    <td>{r.target_emp?.name || r.target || `#${r.target_id}`}</td>
                    <td>{r.swap_date || '—'}</td>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{r.status}</span>
                      {(r.reject_reason || r.peer_reject_reason) && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{r.reject_reason || r.peer_reject_reason}</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
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
          docTitle="換班申請"
          docNo={detailRow.id}
          status={detailRow.status}
          applicant={{
            name: detailRow.requester_emp?.name || detailRow.requester || `員工 #${detailRow.requester_id}`,
            status: '在職',
          }}
          fields={[
            { label: '申請人', value: detailRow.requester_emp?.name || detailRow.requester },
            { label: '對方', value: detailRow.target_emp?.name || detailRow.target },
            { label: '換班日期', value: detailRow.swap_date },
            ...(detailRow.reason ? [{ label: '原因', value: detailRow.reason, multiline: true }] : []),
            ...(detailRow.peer_reject_reason ? [{ label: '對方拒絕原因', value: detailRow.peer_reject_reason, multiline: true }] : []),
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
