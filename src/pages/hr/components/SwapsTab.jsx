import { supabase } from '../../../lib/supabase'

export default function SwapsTab({ swaps, setSwaps }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><span className="card-title-icon">🔄</span> 換班申請</div>
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead><tr><th>申請人</th><th>對象</th><th>日期</th><th>原班</th><th>換班</th><th>原因</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>
            {swaps.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無換班申請</td></tr>}
            {swaps.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.requester}</td>
                <td style={{ fontWeight: 600 }}>{s.target}</td>
                <td>{s.swap_date}</td>
                <td>{s.requester_shift || '—'}</td>
                <td>{s.target_shift || '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.reason || '—'}</td>
                <td>
                  <span className={`badge ${s.status === '已核准' ? 'badge-success' : s.status === '已拒絕' ? 'badge-danger' : 'badge-warning'}`}>
                    <span className="badge-dot"></span>{s.status}
                  </span>
                  {s.reject_reason && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{s.reject_reason}</div>}
                </td>
                <td>
                  {s.status === '待審核' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-primary" onClick={async () => {
                        const { data } = await supabase.from('shift_swaps').update({ status: '已核准', approver: '主管' }).eq('id', s.id).select().single()
                        if (data) {
                          setSwaps(prev => prev.map(x => x.id === s.id ? data : x))
                          // Execute swap in schedules (use employee_id if available, fallback to name)
                          await supabase.from('schedules').update({ shift: s.target_shift })
                            .eq(s.requester_id ? 'employee_id' : 'employee', s.requester_id || s.requester).eq('date', s.swap_date)
                          await supabase.from('schedules').update({ shift: s.requester_shift })
                            .eq(s.target_id ? 'employee_id' : 'employee', s.target_id || s.target).eq('date', s.swap_date)
                        }
                      }}>核准</button>
                      <button className="btn btn-sm btn-secondary" onClick={async () => {
                        const reason = prompt('拒絕原因：')
                        if (!reason?.trim()) return
                        const { data } = await supabase.from('shift_swaps').update({ status: '已拒絕', reject_reason: reason.trim() }).eq('id', s.id).select().single()
                        if (data) setSwaps(prev => prev.map(x => x.id === s.id ? data : x))
                      }}>拒絕</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
