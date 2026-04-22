import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { ActivityTimeline } from '../../components/LiffManager/ActivityTimeline'

/* ── Status mapping (sme-ops uses Traditional Chinese status values) ── */
const STATUS = {
  RUNNING: '進行中',
  COMPLETED: '已完成',
  PAUSED: '暫停',
  PENDING: '待處理',
  NOT_STARTED: '未開始',
  BLOCKED: '已擱置',
  CANCELLED: '已取消',
}

/* ── CSS-in-JS ── */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

.liff-dash {
  min-height: 100vh;
  background: linear-gradient(180deg, #0c0e1a 0%, #141829 50%, #0f1420 100%);
  color: #dde2f0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.dash-header {
  position: relative;
  padding: 32px 24px 40px;
  background: linear-gradient(135deg, #0f172a 0%, #155e75 60%, #0891b2 100%);
  border-radius: 0 0 28px 28px;
  text-align: center;
  overflow: hidden;
}
.dash-header::before {
  content: '';
  position: absolute;
  top: -60%;
  left: -20%;
  width: 140%;
  height: 140%;
  background: radial-gradient(ellipse, rgba(255,255,255,0.08) 0%, transparent 70%);
  pointer-events: none;
}
.dash-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
}
.dash-title {
  font-size: 24px;
  font-weight: 800;
  color: #fff;
  margin: 0;
  letter-spacing: 0.3px;
  position: relative;
}
.dash-subtitle {
  font-size: 13px;
  color: rgba(255,255,255,0.65);
  margin-top: 4px;
  position: relative;
}
.overall-bar-wrap { margin-top: 16px; padding: 0 4px; position: relative; }
.overall-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255,255,255,0.6);
  margin-bottom: 6px;
}
.overall-pct { font-weight: 800; color: #fff; font-size: 13px; }
.overall-track {
  height: 6px;
  border-radius: 99px;
  background: rgba(255,255,255,0.15);
  backdrop-filter: blur(4px);
}
.overall-fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #fff 0%, rgba(255,255,255,0.85) 100%);
  transition: width 0.8s cubic-bezier(0.4,0,0.2,1);
  box-shadow: 0 0 8px rgba(255,255,255,0.3);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 0 20px;
  margin-top: -24px;
  position: relative;
  z-index: 2;
}
.summary-card {
  background: rgba(30, 36, 58, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 18px;
  padding: 16px 8px;
  text-align: center;
  border: 1px solid rgba(255,255,255,0.06);
  box-shadow: 0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04);
  transition: transform 0.2s;
}
.summary-card:active { transform: scale(0.97); }
.summary-val {
  font-size: 32px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.5px;
}
.summary-val.green { color: #34d399; }
.summary-val.amber { color: #fbbf24; }
.summary-val.red   { color: #f87171; }
.summary-lbl {
  font-size: 11px;
  color: #64748b;
  margin-top: 6px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.glass-section {
  margin: 16px 20px;
  background: rgba(22, 27, 45, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.05);
  box-shadow: 0 2px 16px rgba(0,0,0,0.2);
  overflow: hidden;
}
.section-head {
  padding: 16px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.section-title { font-size: 15px; font-weight: 700; letter-spacing: 0.2px; }
.section-meta { font-size: 11px; color: #475569; font-weight: 500; }
.section-body { padding: 14px 18px; }

.delay-card {
  padding: 14px 16px;
  margin-bottom: 8px;
  border-radius: 14px;
  border-left: 3px solid #fbbf24;
  background: rgba(255,255,255,0.02);
  transition: background 0.15s;
}
.delay-card:active { background: rgba(255,255,255,0.05); }
.delay-title {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 6px;
  color: #dde2f0;
}
.delay-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: #64748b;
}

.count-badge {
  padding: 2px 10px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 700;
}
.count-badge.red { background: rgba(248,113,113,0.12); color: #f87171; }

.tl-item { display: flex; gap: 14px; padding-bottom: 14px; position: relative; }
.tl-item:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 16px;
  bottom: 0;
  width: 1px;
  background: rgba(255,255,255,0.06);
}
.tl-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  margin-top: 3px;
  flex-shrink: 0;
  box-shadow: 0 0 8px var(--dot-glow);
}
.tl-dot.green { background: #34d399; --dot-glow: rgba(52,211,153,0.4); }
.tl-dot.amber { background: #fbbf24; --dot-glow: rgba(251,191,36,0.4); }
.tl-dot.indigo { background: #818cf8; --dot-glow: rgba(129,140,248,0.4); }
.tl-dot.red { background: #f87171; --dot-glow: rgba(248,113,113,0.4); }
.tl-body { flex: 1; }
.tl-time {
  font-size: 11px;
  color: #475569;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-weight: 500;
}
.tl-title {
  font-size: 13px;
  font-weight: 500;
  color: #cbd5e1;
  margin-top: 1px;
}
.tl-store { font-size: 11px; color: #3b82f6; margin-top: 2px; font-weight: 500; }

.empty-state {
  text-align: center;
  padding: 28px 16px;
  color: #475569;
  font-size: 13px;
}
.empty-state.success { color: #34d399; font-weight: 600; }

.dash-error {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #0c0e1a 0%, #141829 100%);
  gap: 12px;
  padding: 24px;
  text-align: center;
}
.error-icon { font-size: 44px; }
.error-text { color: #f87171; font-size: 14px; font-weight: 500; }
.error-detail { color: #475569; font-size: 12px; max-width: 280px; }

.refresh-bar {
  text-align: center;
  padding: 8px;
  font-size: 11px;
  color: #475569;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.refresh-btn {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  padding: 6px 16px;
  color: #818cf8;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.refresh-btn:active { background: rgba(255,255,255,0.12); }
.refresh-spinning { animation: spin 0.8s linear infinite; }
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.dash-loading {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #0c0e1a 0%, #141829 100%);
  gap: 12px;
}
.loading-icon { font-size: 44px; animation: pulse-glow 1.8s infinite; }
@keyframes pulse-glow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.08); }
}
.loading-text { color: #64748b; font-size: 14px; font-weight: 500; }
@media (prefers-reduced-motion: reduce) {
  .overall-fill, .summary-card, .delay-card, .refresh-btn { transition: none !important; }
  @keyframes spin { from, to { transform: rotate(0deg); } }
  @keyframes pulse-glow { from, to { box-shadow: none; } }
}
`

export default function LiffManagerDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [employee, setEmployee] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [rawInstances, setRawInstances] = useState([])
  const [rawSteps, setRawSteps] = useState([])
  const [rawTasks, setRawTasks] = useState([])
  const [stores, setStores] = useState([])
  const [selectedStore, setSelectedStore] = useState('all')
  const [activityPeriod, setActivityPeriod] = useState('today')
  const [expandedInstanceId, setExpandedInstanceId] = useState(null)
  const [focusTab, setFocusTab] = useState('in_progress')

  // ── LIFF init (mirrors LiffTask/LiffClockIn pattern) ──
  useEffect(() => { initLiff() }, [])

  async function initLiff() {
    try {
      if (window.liff) {
        const liffId = resolveLiffId()
        console.log('[LIFF Dashboard] resolved liff id:', liffId || '(none)')
        if (!liffId) {
          setError('LIFF ID 未設定 — 請於 Vercel 環境變數加入 VITE_LIFF_DASHBOARD_ID 並重新部署')
          setLoading(false)
          return
        }
        if (liffId) {
          await window.liff.init({ liffId })
          if (!window.liff.isLoggedIn()) { window.liff.login(); return }
          const profile = await window.liff.getProfile()
          const { data: ela } = await supabase
            .from('employee_line_accounts')
            .select('employee_id')
            .eq('line_user_id', profile.userId)
            .limit(1)
            .maybeSingle()
          if (ela?.employee_id) {
            const { data: emp } = await supabase
              .from('employees').select('*').eq('id', ela.employee_id).maybeSingle()
            if (emp) { setEmployee(emp); await loadData(); return }
          }
        }
      }
      // Fallback: ?employee=Name (dev/preview)
      const params = new URLSearchParams(window.location.search)
      const empName = params.get('employee')
      if (empName) {
        const { data: emp } = await supabase.from('employees')
          .select('*').eq('name', empName).maybeSingle()
        if (emp) { setEmployee(emp); await loadData(); return }
      }
      // Dev bypass: load any employee
      if (import.meta.env.DEV) {
        const { data: emp } = await supabase.from('employees')
          .select('*').eq('status', '在職').limit(1).maybeSingle()
        if (emp) { setEmployee(emp); await loadData(); return }
      }
      setError('無法識別身份，請從 LINE 開啟此頁面')
      setLoading(false)
    } catch (err) {
      console.error('LIFF init error:', err)
      setError('LIFF 初始化失敗：' + (err.message || ''))
      setLoading(false)
    }
  }

  const loadData = useCallback(async () => {
    try {
      const now = new Date()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString()

      const [instRes, stepsRes, tasksRes, storesRes] = await Promise.all([
        supabase.from('workflow_instances')
          .select('id, template_name, status, started_at, completed_at, due_date, store, assignee')
          .order('started_at', { ascending: false })
          .limit(60),
        supabase.from('tasks')
          .select('id, workflow_instance_id, title, status, due_date, assignee, store, completed_at, created_at')
          .not('workflow_instance_id', 'is', null)
          .gte('created_at', thirtyDaysAgo)
          .order('step_order', { ascending: true })
          .limit(500),
        supabase.from('tasks')
          .select('id, title, status, priority, due_date, assignee, workflow, created_at')
          .is('workflow_instance_id', null)
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(300),
        supabase.from('stores').select('id, name').order('name'),
      ])

      setRawInstances(instRes.data || [])
      setRawSteps(stepsRes.data || [])
      setRawTasks(tasksRes.data || [])
      setStores(storesRes.data || [])
      setLastRefresh(new Date())
    } catch (err) {
      console.error('LiffManagerDashboard load error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Auto-refresh every 5 min
  useEffect(() => {
    if (!employee) return
    const interval = setInterval(() => loadData(), 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [employee, loadData])

  async function handleRefresh() {
    setRefreshing(true)
    await loadData()
  }

  // Store-scope predicate
  const matchesStore = useCallback((row) => {
    if (selectedStore === 'all') return true
    return row.store === selectedStore
  }, [selectedStore])

  // Steps grouped per instance
  const stepsByInstance = useMemo(() => {
    const map = new Map()
    rawSteps.forEach(s => {
      if (!map.has(s.workflow_instance_id)) map.set(s.workflow_instance_id, [])
      map.get(s.workflow_instance_id).push(s)
    })
    return map
  }, [rawSteps])

  const filteredInstances = useMemo(() => {
    return rawInstances
      .filter(matchesStore)
      .map(inst => ({ ...inst, steps: stepsByInstance.get(inst.id) || [] }))
  }, [rawInstances, matchesStore, stepsByInstance])

  const wfStat = useMemo(() => ({
    total: filteredInstances.length,
    running: filteredInstances.filter(i => i.status === STATUS.RUNNING).length,
    completed: filteredInstances.filter(i => i.status === STATUS.COMPLETED).length,
  }), [filteredInstances])

  const recentInstances = useMemo(
    () => filteredInstances.filter(i => i.status === STATUS.RUNNING).slice(0, 20),
    [filteredInstances]
  )

  const stepStat = useMemo(() => {
    const now = new Date()
    const list = rawSteps.filter(matchesStore)
    return {
      total: list.length,
      pending: list.filter(s => s.status === STATUS.PENDING || s.status === STATUS.NOT_STARTED).length,
      in_progress: list.filter(s => s.status === STATUS.RUNNING).length,
      completed: list.filter(s => s.status === STATUS.COMPLETED).length,
      blocked: list.filter(s => s.status === STATUS.BLOCKED).length,
      overdue: list.filter(s => s.due_date && s.status !== STATUS.COMPLETED && s.status !== STATUS.CANCELLED && new Date(s.due_date) < now).length,
    }
  }, [rawSteps, matchesStore])

  const filteredSteps = useMemo(() => rawSteps.filter(matchesStore), [rawSteps, matchesStore])

  const activity = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const cutoff = activityPeriod === 'today'
      ? todayStart
      : new Date(now.getTime() - (activityPeriod === '7days' ? 7 : 30) * 86400000)
    const sameDay = activityPeriod === 'today'

    // Steps: completion + creation events
    const stepEvents = filteredSteps.flatMap(s => {
      const events = []
      const created = new Date(s.created_at)
      if (created >= cutoff) {
        events.push({
          id: `s-c-${s.id}`,
          _ts: created.getTime(),
          time: formatTime(created, sameDay),
          title: s.title,
          storeName: s.store || '',
          type: s.status === STATUS.BLOCKED ? 'blocked' : 'created',
        })
      }
      if (s.completed_at) {
        const completed = new Date(s.completed_at)
        if (completed >= cutoff) {
          events.push({
            id: `s-d-${s.id}`,
            _ts: completed.getTime(),
            time: formatTime(completed, sameDay),
            title: s.title,
            storeName: s.store || '',
            type: 'completed',
          })
        }
      }
      return events
    })

    // Standalone tasks: creation events only (sme-ops tasks lack updated_at/completed_at)
    const taskEvents = rawTasks
      .filter(t => {
        if (selectedStore !== 'all') return false  // tasks have no store column
        return new Date(t.created_at) >= cutoff
      })
      .map(t => ({
        id: `t-${t.id}`,
        _ts: new Date(t.created_at).getTime(),
        time: formatTime(new Date(t.created_at), sameDay),
        title: t.title,
        storeName: '',
        type: t.status === STATUS.COMPLETED ? 'completed'
          : t.status === STATUS.BLOCKED ? 'blocked' : 'created',
      }))

    return [...stepEvents, ...taskEvents]
      .sort((a, b) => b._ts - a._ts)
      .slice(0, sameDay ? 10 : 30)
  }, [filteredSteps, rawTasks, activityPeriod, selectedStore])

  const { inProgressList, overdueList } = useMemo(() => {
    const now = new Date()
    const inProg = filteredSteps
      .filter(s => s.status === STATUS.RUNNING)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const over = filteredSteps
      .filter(s => s.status !== STATUS.COMPLETED && s.status !== STATUS.CANCELLED && s.due_date && new Date(s.due_date) < now)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
    return { inProgressList: inProg, overdueList: over }
  }, [filteredSteps])

  if (loading) {
    return (
      <>
        <style>{css}</style>
        <div className="dash-loading">
          <div className="loading-icon">📊</div>
          <div className="loading-text">載入營運資料中...</div>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <style>{css}</style>
        <div className="dash-error">
          <div className="error-icon">⚠️</div>
          <div className="error-text">{error}</div>
          <div className="error-detail">請從 LINE 開啟此頁面，或在 URL 加上 ?employee=姓名 進行預覽。</div>
        </div>
      </>
    )
  }

  const overallPct = stepStat.total > 0
    ? Math.round((stepStat.completed / stepStat.total) * 100)
    : 0

  const statusBadge = {
    [STATUS.RUNNING]: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: '進行中' },
    [STATUS.PAUSED]: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', label: '暫停' },
  }

  return (
    <>
      <style>{css}</style>
      <div className="liff-dash">
        {/* Header */}
        <div className="dash-header">
          <h1 className="dash-title">📊 工作流程總覽</h1>
          <p className="dash-subtitle">
            {employee?.name ? `${employee.name}，` : ''}流程、任務與查核清單概況
          </p>
          <div className="overall-bar-wrap">
            <div className="overall-label">
              <span>整體任務完成率</span>
              <span className="overall-pct">{overallPct}%</span>
            </div>
            <div className="overall-track">
              <div className="overall-fill" role="progressbar" style={{ width: `${overallPct}%` }} />
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="summary-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="summary-card">
            <div className="summary-val" style={{ color: '#60a5fa' }}>{wfStat.running}</div>
            <div className="summary-lbl">進行中流程</div>
            <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>{wfStat.total} 總計</div>
          </div>
          <div className="summary-card">
            <div className="summary-val" style={{ color: '#22d3ee' }}>{stepStat.in_progress}</div>
            <div className="summary-lbl">進行中任務</div>
          </div>
          <div className="summary-card">
            <div className="summary-val amber">{stepStat.pending}</div>
            <div className="summary-lbl">待處理任務</div>
            <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>{stepStat.total} 總計</div>
          </div>
          <div className="summary-card">
            <div className="summary-val red">{stepStat.overdue}</div>
            <div className="summary-lbl">逾期任務</div>
          </div>
        </div>

        {/* Refresh + store filter */}
        <div className="refresh-bar" style={{ flexWrap: 'wrap', padding: '10px 16px' }}>
          <button className="refresh-btn" onClick={handleRefresh} disabled={refreshing}>
            <span className={refreshing ? 'refresh-spinning' : ''} style={{ display: 'inline-block' }}>🔄</span>
            {' '}{refreshing ? '更新中…' : '重新整理'}
          </button>
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            style={{
              background: selectedStore === 'all' ? 'rgba(255,255,255,0.06)' : 'rgba(129,140,248,0.15)',
              border: '1px solid',
              borderColor: selectedStore === 'all' ? 'rgba(255,255,255,0.08)' : 'rgba(129,140,248,0.4)',
              borderRadius: '20px',
              padding: '6px 12px',
              color: selectedStore === 'all' ? '#818cf8' : '#a5b4fc',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="all">🏢 全部門市</option>
            {stores.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
          {lastRefresh && (
            <span style={{ fontSize: '10px', color: '#334155' }}>
              {lastRefresh.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 更新
            </span>
          )}
        </div>

        {/* Active workflows */}
        <div className="glass-section">
          <div className="section-head">
            <span className="section-title">🔄 進行中流程</span>
            {recentInstances.length > 0 && <span className="section-meta">{recentInstances.length}</span>}
          </div>
          <div className="section-body">
            {recentInstances.length === 0 ? (
              <div className="empty-state">目前沒有進行中的流程</div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {recentInstances.map(inst => {
                  const steps = inst.steps || []
                  const now = new Date()
                  const total = steps.length
                  const completed = steps.filter(s => s.status === STATUS.COMPLETED).length
                  const inProgress = steps.filter(s => s.status === STATUS.RUNNING).length
                  const blocked = steps.filter(s => s.status === STATUS.BLOCKED).length
                  const overdueCount = steps.filter(s => s.status !== STATUS.COMPLETED && s.status !== STATUS.CANCELLED && s.due_date && new Date(s.due_date) < now).length
                  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
                  const pctColor = pct >= 80 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#f87171'
                  const badge = statusBadge[inst.status]
                  const isOpen = expandedInstanceId === inst.id
                  const inProgressSteps = steps.filter(s => s.status === STATUS.RUNNING)
                  return (
                    <div
                      key={inst.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedInstanceId(isOpen ? null : inst.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedInstanceId(isOpen ? null : inst.id) } }}
                      style={{
                        cursor: 'pointer',
                        padding: '12px 14px',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid',
                        borderColor: isOpen ? 'rgba(129,140,248,0.4)' : 'rgba(255,255,255,0.06)',
                        boxShadow: isOpen ? '0 4px 16px rgba(79,70,229,0.15)' : '0 1px 3px rgba(0,0,0,0.2)',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '10px', color: '#64748b', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>▶</span>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#dde2f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.template_name}</span>
                          {badge && (
                            <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', fontWeight: 600, background: badge.bg, color: badge.color, flexShrink: 0 }}>
                              {badge.label}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: pctColor, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '99px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '10px' }}>
                        <div style={{ height: '100%', borderRadius: '99px', width: `${pct}%`, background: 'linear-gradient(90deg, #fff 0%, rgba(255,255,255,0.85) 100%)', boxShadow: '0 0 8px rgba(255,255,255,0.3)', transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '11px', alignItems: 'center' }}>
                        <span style={{ color: '#34d399', fontWeight: 600 }}>✅ 已完成 {completed}/{total}</span>
                        {inProgress > 0 && <span style={{ color: '#60a5fa', fontWeight: 600 }}>🔄 進行 {inProgress}</span>}
                        {blocked > 0 && <span style={{ color: '#fbbf24', fontWeight: 600 }}>🟠 擱置 {blocked}</span>}
                        {overdueCount > 0 && (
                          <span style={{
                            fontSize: '10px',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontWeight: 700,
                            background: 'rgba(248,113,113,0.15)',
                            color: '#f87171',
                            border: '1px solid rgba(248,113,113,0.3)',
                            letterSpacing: '0.3px',
                          }}>❗ 逾期 {overdueCount}</span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#475569' }}>{new Date(inst.started_at).toLocaleDateString('zh-TW')}</span>
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ fontSize: '11px', color: '#475569', fontWeight: 600, marginBottom: '6px' }}>🔄 進行中任務 ({inProgressSteps.length})</div>
                          {inProgressSteps.length === 0 ? (
                            <div style={{ fontSize: '11px', color: '#475569', padding: '4px 0' }}>目前無進行中任務</div>
                          ) : inProgressSteps.map(s => {
                            const stepOverdue = s.due_date && new Date(s.due_date) < new Date()
                            return (
                              <div key={s.id} style={{ padding: '8px 10px', marginBottom: '6px', borderRadius: '8px', background: 'rgba(59,130,246,0.06)', borderLeft: '2px solid #60a5fa' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600, color: '#dde2f0', marginBottom: '3px' }}>{s.title}</div>
                                <div style={{ display: 'flex', gap: '10px', fontSize: '10px', color: '#64748b' }}>
                                  <span>👤 {s.assignee || '未指派'}</span>
                                  {s.due_date && (
                                    <span style={{ color: stepOverdue ? '#f87171' : '#64748b', fontWeight: stepOverdue ? 700 : 400 }}>
                                      📅 {new Date(s.due_date).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}{stepOverdue ? ' 逾期' : ''}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* In-progress / Overdue tabs */}
        {(inProgressList.length > 0 || overdueList.length > 0) && (() => {
          const activeList = focusTab === 'in_progress' ? inProgressList : overdueList
          const accent = focusTab === 'in_progress' ? '#60a5fa' : '#f87171'
          const bgTint = focusTab === 'in_progress' ? 'rgba(59,130,246,0.06)' : 'rgba(248,113,113,0.06)'
          const mkTabStyle = (active, color, tintA, tintB) => ({
            flex: 1,
            padding: '10px 12px',
            fontSize: '12px',
            fontWeight: 700,
            borderRadius: '999px',
            border: '1px solid',
            borderColor: active ? tintB : 'rgba(255,255,255,0.06)',
            background: active ? tintA : 'rgba(255,255,255,0.02)',
            color: active ? color : '#64748b',
            cursor: 'pointer',
            transition: 'all 0.15s',
            letterSpacing: '0.3px',
          })
          return (
            <div className="glass-section">
              <div style={{ display: 'flex', gap: '8px', padding: '14px 18px 4px' }}>
                <button
                  type="button"
                  onClick={() => setFocusTab('in_progress')}
                  style={mkTabStyle(focusTab === 'in_progress', '#60a5fa', 'rgba(96,165,250,0.15)', 'rgba(96,165,250,0.4)')}
                >
                  🔄 進行任務 <span style={{ opacity: 0.75, marginLeft: '4px' }}>{inProgressList.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFocusTab('overdue')}
                  style={mkTabStyle(focusTab === 'overdue', '#f87171', 'rgba(248,113,113,0.15)', 'rgba(248,113,113,0.4)')}
                >
                  ❗ 逾期任務 <span style={{ opacity: 0.75, marginLeft: '4px' }}>{overdueList.length}</span>
                </button>
              </div>
              <div className="section-body">
                {activeList.length === 0 ? (
                  <div className="empty-state" style={{ padding: '20px 8px' }}>
                    {focusTab === 'in_progress' ? '目前無進行中任務' : '✓ 沒有逾期任務'}
                  </div>
                ) : activeList.slice(0, 15).map(s => {
                  const isOverdueTab = focusTab === 'overdue'
                  const overdueDays = s.due_date && new Date(s.due_date) < new Date() && s.status !== STATUS.COMPLETED && s.status !== STATUS.CANCELLED
                    ? Math.max(0, Math.ceil((Date.now() - new Date(s.due_date).getTime()) / 86400000))
                    : null
                  return (
                    <div key={s.id} style={{ padding: '8px 10px', marginBottom: '6px', borderRadius: '8px', background: bgTint, borderLeft: `2px solid ${accent}` }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#dde2f0', marginBottom: '3px' }}>{s.title}</div>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: '#64748b', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>👤 {s.assignee || '未指派'}</span>
                        {isOverdueTab ? (
                          overdueDays !== null && <span style={{ color: '#f87171', fontWeight: 700 }}>📅 逾期 {overdueDays} 天</span>
                        ) : (
                          <>
                            {s.due_date && (
                              <span>📅 {new Date(s.due_date).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}</span>
                            )}
                            {overdueDays !== null && (
                              <span style={{
                                fontSize: '9px',
                                padding: '1px 7px',
                                borderRadius: '999px',
                                fontWeight: 700,
                                background: 'rgba(248,113,113,0.15)',
                                color: '#f87171',
                                border: '1px solid rgba(248,113,113,0.3)',
                                letterSpacing: '0.3px',
                              }}>❗ 逾期 {overdueDays}天</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Activity */}
        <ActivityTimeline activity={activity} period={activityPeriod} onPeriodChange={setActivityPeriod} />

        {/* Safe area */}
        <div style={{ height: '40px' }} />
      </div>
    </>
  )
}

// Resolve LIFF ID from (1) ?liffId= URL override, (2) liff.state redirect,
// (3) dedicated dashboard env, (4) shared LIFF env. Lets one endpoint serve
// multiple LIFF apps without redeploying.
function resolveLiffId() {
  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get('liffId')
  if (fromQuery) return fromQuery
  // LIFF redirects via liff.line.me/<id> set this on the URL
  const liffState = params.get('liff.state')
  if (liffState) {
    const m = window.location.pathname.match(/\/liff\/([^/?#]+)/)
    if (m && /^\d{10}-[A-Za-z0-9]{8}$/.test(m[1])) return m[1]
  }
  return import.meta.env.VITE_LIFF_DASHBOARD_ID || import.meta.env.VITE_LIFF_ID
}

function formatTime(d, sameDay) {
  return sameDay
    ? d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
}
