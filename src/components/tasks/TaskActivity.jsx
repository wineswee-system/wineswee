import { useState, useEffect } from 'react'
import { Activity, UserPlus, MessageSquare, CheckCircle2, Edit3, Clock, ArrowRight, AtSign, Paperclip } from 'lucide-react'
import { getTaskActivity } from '../../lib/db'

const ACTION_CONFIG = {
  created:         { icon: Activity,     color: '#64748b', label: '建立任務' },
  status_changed:  { icon: ArrowRight,   color: '#06b6d4', label: '狀態變更' },
  assigned:        { icon: UserPlus,     color: '#8b5cf6', label: '指派' },
  due_changed:     { icon: Clock,        color: '#f59e0b', label: '截止日變更' },
  field_changed:   { icon: Edit3,        color: '#64748b', label: '欄位變更' },
  moved:           { icon: ArrowRight,   color: '#06b6d4', label: '移動' },
  commented:       { icon: MessageSquare, color: '#64748b', label: '留言' },
  mentioned:       { icon: AtSign,       color: '#f59e0b', label: '提及' },
  attachment_added:{ icon: Paperclip,    color: '#64748b', label: '附加檔案' },
  watcher_added:   { icon: UserPlus,     color: '#10b981', label: '關注者' },
  completed:       { icon: CheckCircle2, color: '#10b981', label: '完成' },
}

function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  const mins = Math.round((now - d) / 60000)
  if (mins < 1)   return '剛剛'
  if (mins < 60)  return `${mins} 分鐘前`
  const hrs = Math.round(mins / 60)
  if (hrs < 24)   return `${hrs} 小時前`
  const days = Math.round(hrs / 24)
  if (days < 7)   return `${days} 天前`
  return iso.slice(0, 16).replace('T', ' ')
}

function describe(item) {
  const actor = item.actor || '系統'
  switch (item.action) {
    case 'created':
      return `${actor} 建立了此任務`
    case 'status_changed':
      return `${actor} 將狀態由「${item.old_value || '無'}」改為「${item.new_value}」`
    case 'assigned':
      return `${actor} 將任務指派給 ${item.new_value || '無'}`
    case 'due_changed':
      return `${actor} 將截止日由 ${item.old_value || '無'} 改為 ${item.new_value || '無'}`
    case 'field_changed':
      return `${actor} 修改 ${item.field}：${item.old_value || '無'} → ${item.new_value || '無'}`
    case 'moved':
      return `${actor} 將任務移動至其他欄位`
    case 'commented':
      return `${actor} 新增了留言`
    case 'mentioned':
      return `${actor} 提到了 ${item.new_value || '某人'}`
    case 'attachment_added':
      return `${actor} 附加了檔案 ${item.new_value || ''}`
    case 'watcher_added':
      return `${actor} 新增關注者 ${item.new_value || ''}`
    case 'completed':
      return `${actor} 完成了此任務`
    default:
      return `${actor} ${item.action}`
  }
}

export default function TaskActivity({ taskId, compact = false, limit = 50, refreshKey = 0 }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!taskId) return
    setLoading(true)
    getTaskActivity(taskId, limit).then(({ data }) => {
      setItems(data || [])
      setLoading(false)
    })
  }, [taskId, limit, refreshKey])

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>載入中...</div>
  if (!items.length) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>尚無活動紀錄</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 10 }}>
      {items.map((it, idx) => {
        const cfg = ACTION_CONFIG[it.action] || { icon: Activity, color: '#64748b' }
        const Icon = cfg.icon
        return (
          <div key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', position: 'relative' }}>
            {!compact && idx < items.length - 1 && (
              <div style={{ position: 'absolute', left: 11, top: 24, bottom: -10, width: 1, background: 'var(--border-subtle)' }} />
            )}
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: `color-mix(in srgb, ${cfg.color} 20%, var(--bg-card))`,
              color: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, zIndex: 1,
            }}>
              <Icon size={12} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, lineHeight: 1.4 }}>{describe(it)}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {formatWhen(it.created_at)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
