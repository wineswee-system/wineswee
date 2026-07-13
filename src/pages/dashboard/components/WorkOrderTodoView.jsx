import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { Building2, Inbox, Flag, CheckCircle, Send } from 'lucide-react'

// 工單待辦 — 「當下輪到我動作」的跨部門工單。跟簽核中心分開（工單不是簽核）。
const PR = {
  high:   { label: '高', color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
  medium: { label: '中', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  low:    { label: '低', color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
}
const ACTION = {
  accept:  { label: '去受理', icon: Flag,        color: 'var(--accent-cyan)',  hint: '受理並排定完成日' },
  complete:{ label: '去回報完成', icon: CheckCircle, color: 'var(--accent-green)', hint: '你承辦，回報完成' },
  confirm: { label: '去確認結案', icon: CheckCircle, color: 'var(--accent-green)', hint: '對方已完成，確認結案' },
}

export default function WorkOrderTodoView({ onCount }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    supabase.rpc('web_list_my_work_order_todos').then(({ data }) => {
      const list = Array.isArray(data) ? data : []
      setRows(list)
      onCount?.(list.length)
      setLoading(false)
    })
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const go = (r) => navigate(`/process/work-orders?focus=${r.id}&returnTo=/`)

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><LoadingSpinner /></div>

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        以下是<b>當下輪到你動作</b>的跨部門工單（待你受理 / 待你回報完成 / 待你確認結案）。
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Inbox size={44} style={{ color: 'var(--accent-green)', marginBottom: 12 }} />
          <div style={{ fontSize: 14 }}>目前沒有待你處理的工單 🎉</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const pr = PR[r.priority] || PR.medium
            const act = ACTION[r.my_action] || ACTION.accept
            const Icon = act.icon
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10,
                border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0, background: pr.dim, color: pr.color }}>優先 {pr.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {r.title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>#{r.id}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {r.my_action === 'confirm'
                      ? <><Building2 size={11} style={{ verticalAlign: -1 }} /> {r.target_department_name}{r.assignee_name ? ` · ${r.assignee_name}` : ''} 已完成</>
                      : <>來自 {r.requester_department_name} · {r.requester_name}</>}
                    {` · ${act.hint}`}
                    {r.expected_due_date && ` · 期望 ${r.expected_due_date}`}
                    {r.scheduled_due_date && ` · 排定 ${r.scheduled_due_date}`}
                  </div>
                </div>
                <button onClick={() => go(r)} style={{
                  flexShrink: 0, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: act.color, color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Icon size={13} /> {act.label}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
