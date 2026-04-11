import {
  Play, Pause, Edit3, BarChart3, Copy, Trash2
} from 'lucide-react'
import { TRIGGER_TYPES } from '../../../lib/dripCampaign'

const STATUS_MAP = {
  draft: { label: '草稿', badge: 'badge-neutral', icon: <Edit3 size={12} /> },
  active: { label: '進行中', badge: 'badge-success', icon: <Play size={12} /> },
  paused: { label: '暫停', badge: 'badge-warning', icon: <Pause size={12} /> },
  completed: { label: '已完成', badge: 'badge-info', icon: null },
}

export default function DripCampaignList({ filtered, onToggleStatus, onEdit, onAnalytics, onClone, onDelete }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="data-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>活動名稱</th>
            <th>觸發條件</th>
            <th>狀態</th>
            <th>步驟</th>
            <th>訂閱人數</th>
            <th>完成率</th>
            <th style={{ textAlign: 'right' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>尚無符合條件的活動</td></tr>
          )}
          {filtered.map(camp => {
            const triggerInfo = TRIGGER_TYPES.find(t => t.id === camp.trigger)
            const st = STATUS_MAP[camp.status] || STATUS_MAP.draft
            const completionRate = camp.stats?.enrolled ? Math.round((camp.stats.completed / camp.stats.enrolled) * 100) : 0
            return (
              <tr key={camp.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{camp.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{camp.description?.substring(0, 40)}{camp.description?.length > 40 ? '...' : ''}</div>
                </td>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <span>{triggerInfo?.icon}</span> {triggerInfo?.name || camp.trigger}
                  </span>
                </td>
                <td><span className={`badge ${st.badge}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{st.icon} {st.label}</span></td>
                <td><span style={{ fontSize: 13 }}>{camp.steps?.length || 0} 步驟</span></td>
                <td><span style={{ fontSize: 13 }}>{(camp.stats?.enrolled || 0).toLocaleString()}</span></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                      <div style={{ width: `${completionRate}%`, height: '100%', borderRadius: 3, background: completionRate > 60 ? '#22c55e' : completionRate > 30 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, minWidth: 36 }}>{completionRate}%</span>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => onToggleStatus(camp.id)} title={camp.status === 'active' ? '暫停' : '啟動'}>
                      {camp.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => onEdit(camp)} title="編輯">
                      <Edit3 size={13} />
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => onAnalytics(camp)} title="分析">
                      <BarChart3 size={13} />
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => onClone(camp)} title="複製">
                      <Copy size={13} />
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', color: '#ef4444' }} onClick={() => onDelete(camp.id)} title="刪除">
                      <Trash2 size={13} />
                    </button>
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
