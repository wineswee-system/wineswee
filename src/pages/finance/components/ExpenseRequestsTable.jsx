/**
 * ExpenseRequestsTable — 費用申請主清單表格
 * Props: filtered, canApprove, profile, onOpenDetail, onApprove, onReject,
 *        onOpenSettle, onConfirmSettle, onRejectSettle, onEditResubmit
 */
import { Check, X, Send } from 'lucide-react'
import AsyncButton from '../../../components/AsyncButton'
import { displaySettleStatus } from '../../../lib/displayLabel'

const STATUS_COLORS = {
  '申請中':     { bg: 'var(--accent-blue-dim)',   color: 'var(--accent-blue)' },
  '已核准':     { bg: 'var(--accent-green-dim)',  color: 'var(--accent-green)' },
  '待核銷':     { bg: 'var(--accent-yellow-dim)', color: 'var(--accent-yellow)' },
  '已核銷':     { bg: 'var(--accent-cyan-dim)',   color: 'var(--accent-cyan)' },
  '已駁回':     { bg: 'var(--accent-red-dim)',    color: 'var(--accent-red)' },
  '核銷已退回': { bg: 'var(--accent-red-dim)',    color: 'var(--accent-red)' },
}

const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '-'

export default function ExpenseRequestsTable({
  filtered,
  canApprove,
  profile,
  onOpenDetail,
  onApprove,
  onReject,
  onOpenSettle,
  onConfirmSettle,
  onRejectSettle,
  onEditResubmit,
}) {
  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>申請人</th>
            <th>科目</th>
            <th>項目</th>
            <th style={{ textAlign: 'right' }}>預估金額</th>
            <th style={{ textAlign: 'right' }}>實際金額</th>
            <th>狀態</th>
            <th>日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>無資料</td>
            </tr>
          )}
          {filtered.map(r => {
            const sc = STATUS_COLORS[r.status] || {}
            return (
              <tr key={r.id} onClick={() => onOpenDetail(r)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細">
                <td style={{ fontWeight: 600 }}>{r.employee}</td>
                <td>
                  {r.is_expense === false
                    ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', fontWeight: 600 }}>非費用</span>
                    : <><span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.account_code}</span> {r.account_name}</>}
                </td>
                <td style={{ fontWeight: 500 }}>{r.title}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{r.is_expense === false ? '—' : fmt(r.estimated_amount)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                  {r.is_expense === false ? '—' : (r.actual_amount != null ? fmt(r.actual_amount) : '-')}
                  {r.difference != null && r.difference !== 0 && (
                    <span style={{ fontSize: 11, color: r.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)', marginLeft: 4 }}>
                      ({r.difference > 0 ? '+' : ''}{fmt(r.difference)})
                    </span>
                  )}
                </td>
                <td>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>
                    {displaySettleStatus(r.status)}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.created_at?.slice(0, 10)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {r.status === '申請中' && canApprove('expense_requests', r.id) && (
                      <>
                        <AsyncButton className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => onApprove(r)} busyLabel="處理中…">
                          <Check size={12} /> 核准
                        </AsyncButton>
                        <AsyncButton className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => onReject(r)} busyLabel="…">
                          <X size={12} />
                        </AsyncButton>
                      </>
                    )}
                    {r.is_expense !== false && r.status === '已核准' && r.employee_id === profile?.id && (
                      <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => onOpenSettle(r)}>
                        <Send size={12} /> 核銷(驗收)
                      </button>
                    )}
                    {r.status === '待核銷' && canApprove('expense_settles', r.id) && (
                      <>
                        <AsyncButton className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-cyan)' }} onClick={() => onConfirmSettle(r)} busyLabel="…">
                          <Check size={12} /> 核准
                        </AsyncButton>
                        <AsyncButton className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => onRejectSettle(r)} busyLabel="…">
                          <X size={12} />
                        </AsyncButton>
                      </>
                    )}
                    {r.status === '核銷已退回' && r.employee === profile?.name && (
                      <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-orange)' }} onClick={() => onOpenSettle(r)}>
                        ✏️ 重新核銷(驗收)
                      </button>
                    )}
                    {['申請中', '待審', '已駁回', '已退回'].includes(r.status) && r.employee === profile?.name && (
                      <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-orange)' }} onClick={() => onEditResubmit(r)}>
                        ✏️ {(r.status === '已駁回' || r.status === '已退回') ? '編輯重送' : '編輯'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
