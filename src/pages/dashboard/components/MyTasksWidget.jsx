import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, ChevronRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'

const ACTIVE = ['進行中', '待處理', '待簽核', '待確認', '已退回']
const STATUS_STYLE = {
  '進行中': { bg: 'var(--accent-blue-dim)',   color: 'var(--accent-blue)' },
  '待處理': { bg: 'var(--glass-light)',        color: 'var(--text-muted)' },
  '待簽核': { bg: 'var(--accent-orange-dim)',  color: 'var(--accent-orange)' },
  '待確認': { bg: 'var(--accent-orange-dim)',  color: 'var(--accent-orange)' },
  '已退回': { bg: 'var(--accent-red-dim)',     color: 'var(--accent-red)' },
}

const fmtDue = (d) => {
  if (!d) return '未設定'
  const m = String(d).slice(0, 10).match(/^\d{4}-(\d{2})-(\d{2})/)
  return m ? `${m[1]}/${m[2]}` : '—'
}

// 我的任務 — 儀表板 widget：列出指派給目前使用者、進行中的任務，點擊開任務
export default function MyTasksWidget() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id && !profile?.name) { setLoading(false); return }
    const conds = []
    if (profile?.id) conds.push(`assignee_id.eq.${profile.id}`)
    if (profile?.name) conds.push(`assignee.eq.${profile.name}`)
    let q = supabase.from('tasks')
      .select('id, title, status, due_date, store, assignee, assignee_id, workflow_instance_id, project_id')
      .in('status', ACTIVE)
      .or(conds.join(','))
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(8)
    if (profile?.organization_id) q = q.eq('organization_id', profile.organization_id)
    q.then(({ data }) => { setTasks(data || []); setLoading(false) })
  }, [profile?.id, profile?.name, profile?.organization_id])

  const overdueToday = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 18, boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <Briefcase size={16} style={{ color: 'var(--accent-cyan)' }} /> 我的任務
        </h3>
        <button onClick={() => navigate('/process/tasks')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-cyan)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          全部 <ChevronRight size={13} />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>載入中…</div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>目前沒有指派給你的任務 🎉</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map(t => {
            const s = STATUS_STYLE[t.status] || STATUS_STYLE['待處理']
            const overdue = t.due_date && String(t.due_date).slice(0, 10) < overdueToday
            return (
              <div key={t.id} onClick={() => navigate(
                t.workflow_instance_id ? `/process/workflows?focus=${t.workflow_instance_id}`
                : t.project_id ? `/process/projects?project=${t.project_id}`
                : `/process/tasks?focus=${t.id}`
              )}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: overdue ? 'var(--accent-red)' : 'var(--text-muted)', marginTop: 2, fontWeight: overdue ? 700 : 400 }}>
                    {overdue ? '⚠ 逾期 ' : '到期 '}{fmtDue(t.due_date)}{t.store ? ` · ${t.store}` : ''}
                  </div>
                </div>
                <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, flexShrink: 0 }}>{t.status}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
