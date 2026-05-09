import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import AsyncButton from '../../../components/AsyncButton'

const STATUS_CLASS = {
  '待對方同意':  'badge-warning',
  '待主管核准':  'badge-warning',
  '已核准':      'badge-success',
  '已拒絕':      'badge-danger',
  '已駁回':      'badge-danger',
  '已取消':      'badge-secondary',
}

export default function SwapsTab({ swaps, setSwaps }) {
  const [processing, setProcessing] = useState(null)

  // 主管核准 — 抓 schedules 真實值，互換 shift + actual_*
  const handleApprove = async (s) => {
    if (s.status !== '待主管核准') {
      alert('此單目前不在「待主管核准」階段')
      return
    }
    setProcessing(s.id)
    try {
      // 1. 撈兩人當天的真實 schedules
      const [aRes, bRes] = await Promise.all([
        supabase.from('schedules').select('id, shift, actual_start, actual_end, actual_hours')
          .eq('date', s.swap_date)
          .or(`employee_id.eq.${s.requester_id},employee.eq.${s.requester}`)
          .limit(1).maybeSingle(),
        supabase.from('schedules').select('id, shift, actual_start, actual_end, actual_hours')
          .eq('date', s.swap_date)
          .or(`employee_id.eq.${s.target_id},employee.eq.${s.target}`)
          .limit(1).maybeSingle(),
      ])
      if (!aRes.data || !bRes.data) {
        alert('找不到當日班表，無法執行換班')
        return
      }

      // 2. 互換 shift / actual_*
      await Promise.all([
        supabase.from('schedules').update({
          shift: bRes.data.shift,
          actual_start: bRes.data.actual_start,
          actual_end: bRes.data.actual_end,
          actual_hours: bRes.data.actual_hours,
        }).eq('id', aRes.data.id),
        supabase.from('schedules').update({
          shift: aRes.data.shift,
          actual_start: aRes.data.actual_start,
          actual_end: aRes.data.actual_end,
          actual_hours: aRes.data.actual_hours,
        }).eq('id', bRes.data.id),
      ])

      // 3. 更新 shift_swaps 狀態
      const { data: updated } = await supabase.from('shift_swaps').update({
        status: '已核准',
        approver_name: '主管(Web)',
        approved_at: new Date().toISOString(),
      }).eq('id', s.id).select().single()

      if (updated) setSwaps(prev => prev.map(x => x.id === s.id ? updated : x))
    } finally {
      setProcessing(null)
    }
  }

  const handleReject = async (s) => {
    if (s.status !== '待主管核准' && s.status !== '待對方同意') {
      alert('此單已結案，無法駁回')
      return
    }
    const reason = prompt('駁回原因（A、B 都會看到）：')
    if (!reason?.trim()) return
    setProcessing(s.id)
    try {
      const { data: updated } = await supabase.from('shift_swaps').update({
        status: '已駁回',
        approver_name: '主管(Web)',
        approved_at: new Date().toISOString(),
        reject_reason: reason.trim(),
      }).eq('id', s.id).select().single()
      if (updated) setSwaps(prev => prev.map(x => x.id === s.id ? updated : x))
    } finally {
      setProcessing(null)
    }
  }

  const handleCancel = async (s) => {
    if (!['待對方同意', '待主管核准'].includes(s.status)) return
    if (!confirm('確定取消此換班？')) return
    setProcessing(s.id)
    try {
      const { data: updated } = await supabase.from('shift_swaps').update({
        status: '已取消',
      }).eq('id', s.id).select().single()
      if (updated) setSwaps(prev => prev.map(x => x.id === s.id ? updated : x))
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><span className="card-title-icon">🔄</span> 換班申請</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          兩段確認：A 提交 → B 同意 → 主管核准
        </div>
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>申請人</th>
              <th>對象</th>
              <th>日期</th>
              <th>原班 ↔ 對方</th>
              <th>門市</th>
              <th>理由</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {swaps.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無換班申請</td></tr>}
            {swaps.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.requester}</td>
                <td style={{ fontWeight: 600 }}>{s.target}</td>
                <td>{s.swap_date || s.date}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {s.requester_shift || '—'} ↔ {s.target_shift || '—'}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.store || '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.reason || '—'}</td>
                <td>
                  <span className={`badge ${STATUS_CLASS[s.status] || 'badge-secondary'}`}>
                    <span className="badge-dot"></span>{s.status}
                  </span>
                  {s.status === '待主管核准' && s.peer_response === '同意' && (
                    <div style={{ fontSize: 10, color: 'var(--accent-green)', marginTop: 2 }}>
                      ✓ 對方已同意 {s.peer_responded_at?.slice(11, 16)}
                    </div>
                  )}
                  {s.peer_reject_reason && (
                    <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>
                      對方拒絕：{s.peer_reject_reason}
                    </div>
                  )}
                  {s.reject_reason && (
                    <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>
                      駁回：{s.reject_reason}
                    </div>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {s.status === '待主管核准' && (
                      <>
                        <AsyncButton className="btn btn-sm btn-primary" disabled={processing === s.id}
                          onClick={() => handleApprove(s)} busyLabel="處理中…">核准</AsyncButton>
                        <AsyncButton className="btn btn-sm btn-secondary" disabled={processing === s.id}
                          onClick={() => handleReject(s)} busyLabel="處理中…">駁回</AsyncButton>
                      </>
                    )}
                    {s.status === '待對方同意' && (
                      <>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>等 {s.target} 回覆</span>
                        <AsyncButton className="btn btn-sm btn-secondary" disabled={processing === s.id}
                          onClick={() => handleReject(s)} busyLabel="處理中…"
                          style={{ fontSize: 11 }}>駁回</AsyncButton>
                      </>
                    )}
                    {['待對方同意', '待主管核准'].includes(s.status) && (
                      <AsyncButton className="btn btn-sm" disabled={processing === s.id}
                        onClick={() => handleCancel(s)} busyLabel="處理中…"
                        style={{ fontSize: 11, color: 'var(--text-muted)' }}>取消</AsyncButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
