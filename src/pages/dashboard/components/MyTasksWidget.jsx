import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, ChevronRight, ArrowRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'

// 我要做的:進行中/待處理/被退回;等別人:待簽核/待確認(我不用動)
const TODO = ['進行中', '待處理', '已退回']
const WAITING = ['待簽核', '待確認']
const FETCH_STATUS = [...TODO, ...WAITING]

const localToday = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000)
const md = (d) => String(d).slice(5).replace('-', '/')

// 動作用語(把系統狀態翻成人話)
const ACTION_LABEL = { '進行中': '要做', '待處理': '要做', '已退回': '被退回・要重做' }

export default function MyTasksWidget() {
  const { profile, hasPermission } = useAuth()
  const navigate = useNavigate()
  const canAccessTasks = hasPermission('nav.project.tasks')
  const [tasks, setTasks] = useState([])
  const [wfMap, setWfMap] = useState({})     // instance_id → { name, total }
  const [projMap, setProjMap] = useState({}) // project_id → name
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id && !profile?.name) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const conds = []
      if (profile?.id) conds.push(`assignee_id.eq.${profile.id}`)
      if (profile?.name) conds.push(`assignee.eq.${profile.name}`)
      let q = supabase.from('tasks')
        .select('id, title, description, status, due_date, due_time, store, assignee, assignee_id, step_order, workflow_instance_id, project_id')
        .in('status', FETCH_STATUS)
        .or(conds.join(','))
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(20)
      if (profile?.organization_id) q = q.eq('organization_id', profile.organization_id)
      const { data } = await q
      if (cancelled) return
      const rows = data || []
      setTasks(rows)

      // 來源名稱 + 流程總步數
      const wfIds = [...new Set(rows.map(r => r.workflow_instance_id).filter(Boolean))]
      const projIds = [...new Set(rows.map(r => r.project_id).filter(Boolean))]
      if (wfIds.length) {
        const [{ data: insts }, { data: steps }] = await Promise.all([
          supabase.from('workflow_instances').select('id, template_name').in('id', wfIds),
          supabase.from('tasks').select('workflow_instance_id, step_order').in('workflow_instance_id', wfIds),
        ])
        const total = {}
        ;(steps || []).forEach(s => { total[s.workflow_instance_id] = Math.max(total[s.workflow_instance_id] || 0, s.step_order || 0) })
        const m = {}
        ;(insts || []).forEach(i => { m[i.id] = { name: i.template_name, total: total[i.id] || 0 } })
        if (!cancelled) setWfMap(m)
      }
      if (projIds.length) {
        const { data: projs } = await supabase.from('projects').select('id, name').in('id', projIds)
        const m = {}
        ;(projs || []).forEach(p => { m[p.id] = p.name })
        if (!cancelled) setProjMap(m)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [profile?.id, profile?.name, profile?.organization_id])

  const openTask = (t) => {
    if (t.workflow_instance_id) navigate(`/process/workflows?focus=${t.workflow_instance_id}`)
    else if (t.project_id) navigate(`/process/projects?project=${t.project_id}`)
    else if (canAccessTasks) navigate(`/process/tasks?focus=${t.id}`)
  }

  const today = localToday()
  const dueInfo = (t) => {
    if (!t.due_date) return { group: 'later', tone: 'muted', dot: '⚪', text: '未設定時間' }
    const d = String(t.due_date).slice(0, 10)
    if (d < today) return { group: 'overdue', tone: 'red', dot: '🔴', text: `逾期 ${daysBetween(d, today)} 天` }
    if (d === today) return { group: 'today', tone: 'orange', dot: '🟠', text: `今天 ${(t.due_time || '17:00').slice(0, 5)} 前` }
    return { group: 'later', tone: 'muted', dot: '⚪', text: `還有 ${daysBetween(today, d)} 天（${md(d)}）` }
  }
  // 專案跟流程都可能有 → 兩個標籤都回傳(步驟資訊從流程帶)
  const srcOf = (t) => {
    const project = (t.project_id && projMap[t.project_id]) ? projMap[t.project_id] : null
    const w = (t.workflow_instance_id && wfMap[t.workflow_instance_id]) ? wfMap[t.workflow_instance_id] : null
    const flow = w ? w.name : null
    const step = (w && t.step_order) ? `第 ${t.step_order} 步${w.total ? `／共 ${w.total} 步` : ''}` : ''
    const fallback = (!project && !flow) ? (t.store || '') : ''
    return { project, flow, step, fallback, label: project || flow || fallback }
  }
  const TONE = {
    red: { c: 'var(--accent-red)', bg: 'var(--accent-red-dim)' },
    orange: { c: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
    muted: { c: 'var(--text-muted)', bg: 'var(--bg-tertiary)' },
  }

  const todo = tasks.filter(t => TODO.includes(t.status))
  const waiting = tasks.filter(t => WAITING.includes(t.status))
  const groups = [
    { key: 'overdue', label: '🔴 逾期 — 先做這個', items: [] },
    { key: 'today', label: '🟠 今天要做', items: [] },
    { key: 'later', label: '⚪ 這週之後', items: [] },
  ]
  todo.forEach(t => { const g = dueInfo(t).group; (groups.find(x => x.key === g) || groups[2]).items.push(t) })
  const overdueN = groups[0].items.length
  const todayN = groups[1].items.length

  let heroUsed = false
  const renderCard = (t) => {
    const di = dueInfo(t)
    const src = srcOf(t)
    const tone = TONE[di.tone]
    const big = !heroUsed && (di.group === 'overdue' || di.group === 'today')
    if (big) heroUsed = true
    const rejected = t.status === '已退回'
    return (
      <div key={t.id} onClick={() => openTask(t)}
        style={{
          padding: big ? '13px 14px' : '11px 12px', borderRadius: 12, marginBottom: 8, cursor: 'pointer',
          background: rejected ? 'var(--accent-red-dim)' : 'var(--bg-secondary)',
          border: `1px solid ${big ? tone.c : 'var(--border-subtle)'}`,
        }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
          {src.project && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-purple)', background: 'var(--accent-purple-dim)', borderRadius: 6, padding: '2px 8px' }}>📁 {src.project}</span>
          )}
          {src.flow && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-cyan)', background: 'var(--accent-cyan-dim)', borderRadius: 6, padding: '2px 8px' }}>🔀 {src.flow}</span>
          )}
          {src.fallback && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: 6, padding: '2px 8px' }}>{src.fallback}</span>
          )}
          {src.step && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{src.step}</span>}
        </div>
        <div style={{ fontSize: big ? 17 : 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: t.description ? 8 : 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px', background: tone.bg, color: tone.c }}>
            ⏰ {di.text}
          </span>
          {rejected && <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent-red)' }}>{ACTION_LABEL['已退回']}</span>}
        </div>
        {t.description && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: 8, padding: '7px 10px', marginBottom: 10,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            👉 {t.description}
          </div>
        )}
        <button style={{
          width: '100%', border: 'none', borderRadius: 9, padding: big ? '10px' : '7px', cursor: 'pointer',
          fontSize: big ? 14 : 13, fontWeight: 800,
          background: big ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
          color: big ? '#fff' : 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        }}>
          {di.group === 'later' ? '查看' : '開始做'} <ArrowRight size={13} />
        </button>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 18, boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <Briefcase size={16} style={{ color: 'var(--accent-cyan)' }} /> 我的任務
        </h3>
        {canAccessTasks && (
          <button onClick={() => navigate('/process/tasks')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-cyan)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            全部 <ChevronRight size={13} />
          </button>
        )}
      </div>

      {!loading && todo.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          共 {todo.length} 件要做
          {overdueN > 0 && <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>　🔴 {overdueN} 逾期</span>}
          {todayN > 0 && <span style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>　🟠 {todayN} 今天</span>}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>載入中…</div>
      ) : todo.length === 0 && waiting.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>今天沒事囉 🎉</div>
      ) : (
        <>
          {groups.filter(g => g.items.length).map(g => (
            <div key={g.key}>
              <div style={{ fontSize: 12, fontWeight: 800, margin: '10px 0 7px', color:
                g.key === 'overdue' ? 'var(--accent-red)' : g.key === 'today' ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                {g.label}
              </div>
              {g.items.map(renderCard)}
            </div>
          ))}
          {todo.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>目前沒有要你動手的任務 🎉</div>
          )}

          {waiting.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px dashed var(--border-subtle)', paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6 }}>⏳ 等別人處理(你不用動)</div>
              {waiting.map(t => {
                const src = srcOf(t)
                return (
                  <div key={t.id} onClick={() => openTask(t)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.title}{src.label ? ` · ${src.label}` : ''}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{t.status}</span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
