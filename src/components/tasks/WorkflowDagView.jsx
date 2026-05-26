import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { GitBranch, Link, Loader } from 'lucide-react'
import { toast } from '../../lib/toast'
import { supabase } from '../../lib/supabase'
import { groupByLevel, getEdges, wouldCycle } from '../../lib/workflowDag'

const STATUS_COLOR = {
  '未開始':  'var(--text-muted)',
  '待處理':  'var(--text-muted)',
  '待簽核':  'var(--accent-orange)',
  '進行中':  'var(--accent-cyan)',
  '待確認':  'var(--accent-purple)',
  '已完成':  'var(--accent-green)',
  '已退回':  'var(--accent-red)',
  '已擱置':  'var(--accent-red)',
}

/**
 * WorkflowDagView — visual DAG for a workflow instance's steps.
 *
 * Props:
 *   steps       Array<{ id, step_order, title, status, assignee, ... }>
 *   instanceId  number
 */
export default function WorkflowDagView({ steps, instanceId }) {
  const [deps, setDeps]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [linking, setLinking]     = useState(null)   // stepId being linked FROM
  const [linkType, setLinkType]   = useState('prerequisite')
  const [positions, setPositions] = useState({})
  const [svgH, setSvgH]           = useState(300)

  const containerRef = useRef(null)
  const cardRefs     = useRef({})

  // ── Load deps for this instance ────────────────────────────────────────────
  useEffect(() => {
    if (!instanceId || !steps.length) { setLoading(false); return }
    const ids = steps.map(s => s.id)
    supabase.from('task_dependencies').select('*').in('task_id', ids)
      .then(({ data }) => { setDeps(data || []); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, steps.map(s => s.id).join(',')])

  // ── Measure card positions after DOM paint ─────────────────────────────────
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const cr = container.getBoundingClientRect()
    const pos = {}
    for (const [id, el] of Object.entries(cardRefs.current)) {
      if (!el) continue
      const r = el.getBoundingClientRect()
      pos[id] = {
        cx:     r.left - cr.left + r.width / 2,
        cy:     r.top  - cr.top  + r.height / 2,
        left:   r.left  - cr.left,
        right:  r.right - cr.left,
      }
    }
    setPositions(pos)
    setSvgH(container.scrollHeight || 300)
  }, [steps, deps, loading])

  // ── Dependency mutations ───────────────────────────────────────────────────
  const addDep = async (fromId, toId, type) => {
    if (wouldCycle(fromId, toId, deps, steps)) {
      toast.error('此依賴會造成循環，無法新增')
      return
    }
    // Guard: prevent exact duplicate (same nodes AND same dep_type)
    if (deps.some(d => d.task_id === toId && d.depends_on_task_id === fromId && d.dep_type === type)) return
    const { data, error } = await supabase.from('task_dependencies')
      .insert({ task_id: toId, depends_on_task_id: fromId, dep_type: type })
      .select().single()
    if (error) { toast.error('新增依賴失敗：' + error.message); return }
    if (data) setDeps(prev => [...prev, data])
  }

  const removeDep = async (depId) => {
    const { error } = await supabase.from('task_dependencies').delete().eq('id', depId)
    if (error) { toast.error('移除依賴失敗：' + error.message); return }
    setDeps(prev => prev.filter(d => d.id !== depId))
  }

  // ── Derived layout ─────────────────────────────────────────────────────────
  const columns  = groupByLevel(steps, deps)
  const edges    = getEdges(deps)

  const svgPaths = edges.map((edge, i) => {
    const fp = positions[edge.from]
    const tp = positions[edge.to]
    if (!fp || !tp) return null
    const sx = fp.right
    const sy = fp.cy
    const ex = tp.left
    const ey = tp.cy
    const cx = (sx + ex) / 2
    const isTrig = edge.dep_type === 'trigger'
    return {
      key:    i,
      d:      `M${sx},${sy} C${cx},${sy} ${cx},${ey} ${ex},${ey}`,
      stroke: isTrig ? 'var(--accent-purple)' : 'var(--accent-cyan)',
      dash:   isTrig ? '5,3' : undefined,
      marker: isTrig ? 'url(#dag-arrow-purple)' : 'url(#dag-arrow-cyan)',
    }
  }).filter(Boolean)

  // ── Loading / empty guards ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 60, gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
        <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> 載入依賴圖…
      </div>
    )
  }
  if (!steps.length) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 13 }}>尚無步驟任務</div>
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <GitBranch size={14} />
          依賴圖 — 點擊「連結到」選起點，再點目標步驟建立依賴
        </div>
        {linking ? (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 12px', borderRadius: 8, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid rgba(6,182,212,0.3)' }}>
            從步驟 <strong>{steps.find(s => s.id === linking)?.step_order}</strong> 出發，點選目標
            <button onClick={() => setLinking(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-cyan)', padding: 0, fontSize: 14 }}>✕</button>
          </div>
        ) : (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {[
              { v: 'prerequisite', label: '前置 (fan-in)'  },
              { v: 'trigger',      label: '觸發 (fan-out)' },
            ].map(({ v, label }) => {
              const active = linkType === v
              return (
                <button key={v} onClick={() => setLinkType(v)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                    border:     `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                    background:  active ? 'var(--accent-cyan-dim)' : 'transparent',
                    color:       active ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                  {label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 14, fontSize: 11, color: 'var(--text-muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 24, height: 2, background: 'var(--accent-cyan)', borderRadius: 1 }} />
          前置依賴（全部完成才開始）
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 24, height: 0, borderTop: '2px dashed var(--accent-purple)' }} />
          觸發依賴（完成即立即觸發）
        </span>
      </div>

      {/* DAG canvas */}
      <div ref={containerRef} style={{ position: 'relative', overflowX: 'auto' }}>
        {/* SVG arrows — absolute overlay */}
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: svgH, pointerEvents: 'none', overflow: 'visible', zIndex: 0 }}
          aria-hidden="true"
        >
          <defs>
            <marker id="dag-arrow-cyan"   markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--accent-cyan)" />
            </marker>
            <marker id="dag-arrow-purple" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--accent-purple)" />
            </marker>
          </defs>
          {svgPaths.map(p => (
            <path key={p.key} d={p.d} fill="none" stroke={p.stroke}
              strokeWidth={1.5} strokeDasharray={p.dash} markerEnd={p.marker} opacity={0.75} />
          ))}
        </svg>

        {/* Column flex layout */}
        <div style={{ display: 'flex', gap: 28, padding: '8px 8px 24px', position: 'relative', zIndex: 1, minWidth: 'max-content' }}>
          {columns.map(({ level, steps: colSteps }) => (
            <div key={level} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 210 }}>
              {/* Column header */}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center',
                letterSpacing: '0.05em', textTransform: 'uppercase',
                paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
                第 {level + 1} 階
              </div>

              {/* Step cards */}
              {colSteps.map(step => {
                const color    = STATUS_COLOR[step.status] || STATUS_COLOR['未開始']
                const isSource = linking === step.id
                const isTarget = !!linking && linking !== step.id
                const stepDeps = deps.filter(d => d.task_id === step.id)

                return (
                  <div
                    key={step.id}
                    ref={el => { cardRefs.current[step.id] = el }}
                    onClick={() => {
                      if (linking && linking !== step.id) {
                        addDep(linking, step.id, linkType)
                        setLinking(null)
                      }
                    }}
                    style={{
                      padding: '10px 12px',
                      background: 'var(--bg-card)',
                      border: `1.5px solid ${isSource ? 'var(--accent-cyan)' : isTarget ? 'var(--accent-orange)' : 'var(--border-medium)'}`,
                      borderRadius: 10,
                      cursor: linking ? (isSource ? 'default' : 'crosshair') : 'default',
                      boxShadow: isSource ? '0 0 0 3px rgba(6,182,212,0.15)'
                        : isTarget ? '0 0 0 2px rgba(245,158,11,0.15)' : undefined,
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                  >
                    {/* Title + status badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 5 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35, flex: 1 }}>
                        {step.title}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: 'var(--bg-secondary)', color, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {step.status}
                      </span>
                    </div>

                    {/* Meta line */}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      #{step.step_order} · {step.assignee || '未指派'}
                    </div>

                    {/* Incoming dep badges */}
                    {stepDeps.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {stepDeps.map(d => {
                          const prereq = steps.find(s => s.id === d.depends_on_task_id)
                          if (!prereq) return null
                          const isTrig = d.dep_type === 'trigger'
                          return (
                            <span key={d.id} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              background: isTrig ? 'var(--accent-purple-dim)' : 'var(--accent-cyan-dim)',
                              color:      isTrig ? 'var(--accent-purple)'     : 'var(--accent-cyan)',
                              border:     `1px solid ${isTrig ? 'rgba(168,85,247,0.2)' : 'rgba(6,182,212,0.2)'}`,
                            }}>
                              {isTrig ? '⚡' : '←'} {prereq.step_order}
                              <button
                                onClick={e => { e.stopPropagation(); removeDep(d.id) }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', lineHeight: 1, opacity: 0.8 }}
                                title="移除依賴">
                                ×
                              </button>
                            </span>
                          )
                        })}
                      </div>
                    )}

                    {/* Link button — hidden while linking mode is active */}
                    {!linking && (
                      <button
                        onClick={e => { e.stopPropagation(); setLinking(step.id) }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                          width: '100%', fontSize: 10, padding: '3px 0', borderRadius: 5,
                          background: 'none', border: '1px dashed var(--border-medium)',
                          cursor: 'pointer', color: 'var(--text-muted)',
                          transition: 'border-color 0.1s, color 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-cyan)'; e.currentTarget.style.color = 'var(--accent-cyan)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-medium)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                      >
                        <Link size={9} /> 連結到
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
