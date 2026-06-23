import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle, TrendingDown, Users, RefreshCw, ChevronDown, ChevronUp, Brain } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getDepartments } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

import { toast } from '../../lib/toast'
// ── Risk factor weights & thresholds ──
const RISK_WEIGHTS = {
  tenure_short: { weight: 15, label: '年資過短（<1年）', threshold: m => m < 12 },
  tenure_plateau: { weight: 10, label: '年資停滯（3-5年無晉升）', threshold: (_, lp) => lp > 36 && lp < 60 },
  late_frequent: { weight: 20, label: '近90天頻繁遲到', threshold: (_, __, lc) => lc >= 5 },
  leave_spike: { weight: 15, label: '近90天請假異常增加', threshold: (_, __, ___, lvc) => lvc >= 8 },
  low_performance: { weight: 20, label: '績效分數偏低', threshold: (_, __, ___, ____, ps) => ps !== null && ps < 70 },
  salary_below_band: { weight: 10, label: '薪資低於同職等中位數', threshold: (_, __, ___, ____, _____, sp) => sp !== null && sp < 30 },
  no_engagement: { weight: 10, label: '未參與滿意度調查', threshold: (_, __, ___, ____, _____, ______, es) => es === null },
}

function computeRiskScore(emp) {
  let score = 0
  const factors = []
  const args = [emp.tenure_months, emp.last_promotion_months, emp.late_count_90d, emp.leave_count_90d, emp.performance_score, emp.salary_percentile, emp.engagement_score]

  for (const [key, cfg] of Object.entries(RISK_WEIGHTS)) {
    if (cfg.threshold(...args)) {
      score += cfg.weight
      factors.push(cfg.label)
    }
  }
  return { score: Math.min(score, 100), factors }
}

function riskLevel(score) {
  if (score >= 70) return { text: '高', color: 'var(--accent-red)', bg: 'rgba(239,68,68,0.12)' }
  if (score >= 40) return { text: '中', color: 'var(--accent-orange)', bg: 'rgba(245,158,11,0.12)' }
  return { text: '低', color: 'var(--accent-green)', bg: 'rgba(16,185,129,0.12)' }
}

export default function AttritionPrediction() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [employees, setEmployees] = useState([])
  const [attendance, setAttendance] = useState([])
  const [leaves, setLeaves] = useState([])
  const [reviews, setReviews] = useState([])
  const [salaries, setSalaries] = useState([])
  const [surveys, setSurveys] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [riskFilter, setRiskFilter] = useState('')
  const [sortField, setSortField] = useState('risk_score')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [computing, setComputing] = useState(false)
  const [departments, setDepartments] = useState([])

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    const now = new Date()
    const d90 = new Date(now)
    d90.setDate(d90.getDate() - 90)
    const since = d90.toISOString().slice(0, 10)

    Promise.all([
      supabase.from('employees').select('*').eq('status', '在職').eq('organization_id', orgId).order('name'),
      supabase.from('attendance_records').select('employee_id, date, status, hours, employees(name)').eq('organization_id', orgId).gte('date', since),
      supabase.from('leave_requests').select('employee_id, days, status, employees(name)').eq('organization_id', orgId).gte('created_at', since),
      supabase.from('performance_reviews').select('employee, overall_score, period').eq('organization_id', orgId).order('period', { ascending: false }),
      supabase.from('salary_records').select('employee_id, base_salary, month, employees(name)').eq('organization_id', orgId).order('month', { ascending: false }),
      supabase.from('engagement_responses').select('employee, overall_score').eq('organization_id', orgId),
      getDepartments(orgId),
    ]).then(([e, a, l, p, s, sv, d]) => {
      setEmployees(e.data || [])
      setAttendance(a.data || [])
      setLeaves(l.data || [])
      setReviews(p.data || [])
      setSalaries(s.data || [])
      setSurveys(sv.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load attrition data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [profile?.organization_id])

  const riskData = useMemo(() => {
    if (!employees.length) return []

    const now = new Date()
    const lateCounts = {}
    attendance.forEach(a => {
      if (a.status === '遲到' || a.status === 'late') {
        lateCounts[a.employee] = (lateCounts[a.employee] || 0) + 1
      }
    })

    const leaveCounts = {}
    leaves.forEach(l => {
      if (l.status === '已核准' || l.status === '待審核') {
        leaveCounts[l.employee] = (leaveCounts[l.employee] || 0) + (l.days || 1)
      }
    })

    const latestReview = {}
    reviews.forEach(r => {
      if (!latestReview[r.employee]) latestReview[r.employee] = r.overall_score
    })

    // Compute salary percentiles by position
    const salaryByPos = {}
    const latestSalary = {}
    salaries.forEach(s => {
      if (!latestSalary[s.employee]) {
        latestSalary[s.employee] = s.base_salary
      }
    })
    employees.forEach(emp => {
      const pos = emp.position || '其他'
      if (!salaryByPos[pos]) salaryByPos[pos] = []
      if (latestSalary[emp.name]) salaryByPos[pos].push(latestSalary[emp.name])
    })
    for (const pos of Object.keys(salaryByPos)) salaryByPos[pos].sort((a, b) => a - b)

    const engagementMap = {}
    surveys.forEach(s => {
      if (!engagementMap[s.employee] || s.overall_score > engagementMap[s.employee]) {
        engagementMap[s.employee] = s.overall_score
      }
    })

    return employees.map(emp => {
      const joinDate = emp.join_date ? new Date(emp.join_date) : null
      const tenureMonths = joinDate ? Math.floor((now - joinDate) / (1000 * 60 * 60 * 24 * 30.44)) : null
      const perfScore = latestReview[emp.name] ?? null
      const salary = latestSalary[emp.name]
      const posArr = salaryByPos[emp.position || '其他'] || []
      let salaryPct = null
      if (salary && posArr.length > 1) {
        const rank = posArr.filter(s => s <= salary).length
        salaryPct = Math.round((rank / posArr.length) * 100)
      }

      const record = {
        ...emp,
        tenure_months: tenureMonths,
        late_count_90d: lateCounts[emp.name] || 0,
        leave_count_90d: leaveCounts[emp.name] || 0,
        performance_score: perfScore,
        salary_percentile: salaryPct,
        last_promotion_months: tenureMonths, // simplified: assume no promotion data
        engagement_score: engagementMap[emp.name] ?? null,
        current_salary: salary,
      }

      const { score, factors } = computeRiskScore(record)
      return { ...record, risk_score: score, risk_factors: factors, risk: riskLevel(score) }
    })
  }, [employees, attendance, leaves, reviews, salaries, surveys])

  const filtered = useMemo(() => {
    let list = riskData
    if (deptFilter) list = list.filter(e => e.dept === deptFilter)
    if (riskFilter) list = list.filter(e => e.risk.text === riskFilter)
    list.sort((a, b) => {
      const av = a[sortField] ?? -1
      const bv = b[sortField] ?? -1
      return sortAsc ? av - bv : bv - av
    })
    return list
  }, [riskData, deptFilter, riskFilter, sortField, sortAsc])

  const stats = useMemo(() => {
    const high = riskData.filter(e => e.risk.text === '高').length
    const mid = riskData.filter(e => e.risk.text === '中').length
    const low = riskData.filter(e => e.risk.text === '低').length
    const avg = riskData.length ? Math.round(riskData.reduce((s, e) => s + e.risk_score, 0) / riskData.length) : 0
    return { high, mid, low, avg, total: riskData.length }
  }, [riskData])

  const handleSaveSnapshots = async () => {
    setComputing(true)
    const today = new Date().toISOString().slice(0, 10)
    const orgId = profile?.organization_id || null
    let success = 0
    let failed = 0
    for (const emp of riskData) {
      const { error: upErr } = await supabase.from('attrition_risk_snapshots').upsert({
        organization_id: orgId,
        employee: emp.name,
        snapshot_date: today,
        risk_score: emp.risk_score,
        risk_level: emp.risk.text,
        factors: emp.risk_factors,
        tenure_months: emp.tenure_months,
        late_count_90d: emp.late_count_90d,
        leave_count_90d: emp.leave_count_90d,
        performance_score: emp.performance_score,
        salary_percentile: emp.salary_percentile,
        engagement_score: emp.engagement_score,
      }, { onConflict: 'employee,snapshot_date' })
      if (upErr) { failed++; console.error('[attrition snapshot] upsert failed:', emp.name, upErr) }
      else success++
    }
    setComputing(false)
    if (failed > 0) toast.error(`儲存失敗 ${failed} 筆（成功 ${success} 筆）`)
    else toast.success(`風險快照已儲存（${success} 筆）`)
  }

  const toggleSort = (field) => {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(false) }
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null
    return sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧠</span> AI 離職預測</h2>
            <p>基於出勤、績效、薪資、滿意度等多維度分析員工離職風險</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleSaveSnapshots} disabled={computing}>
              <RefreshCw size={14} className={computing ? 'spin' : ''} /> {computing ? '儲存中...' : '儲存快照'}
            </button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'rgba(239,68,68,0.12)' }}>
          <div className="stat-card-label">高風險</div>
          <div className="stat-card-value">{stats.high}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'rgba(245,158,11,0.12)' }}>
          <div className="stat-card-label">中風險</div>
          <div className="stat-card-value">{stats.mid}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'rgba(16,185,129,0.12)' }}>
          <div className="stat-card-label">低風險</div>
          <div className="stat-card-value">{stats.low}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
          <div className="stat-card-label">平均分數</div>
          <div className="stat-card-value">{stats.avg}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'rgba(139,92,246,0.12)' }}>
          <div className="stat-card-label">在職總數</div>
          <div className="stat-card-value">{stats.total}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 140 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>⚠️ 風險</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 120 }} value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
          <option value="">全部等級</option>
          <option value="高">高風險</option>
          <option value="中">中風險</option>
          <option value="低">低風險</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          顯示 {filtered.length} / {riskData.length} 人
        </span>
      </div>

      {/* Risk distribution bar */}
      {stats.total > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 28 }}>
            {stats.high > 0 && <div style={{ width: `${(stats.high / stats.total) * 100}%`, background: 'var(--accent-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 600 }}>高 {stats.high}</div>}
            {stats.mid > 0 && <div style={{ width: `${(stats.mid / stats.total) * 100}%`, background: 'var(--accent-orange)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 600 }}>中 {stats.mid}</div>}
            {stats.low > 0 && <div style={{ width: `${(stats.low / stats.total) * 100}%`, background: 'var(--accent-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 600 }}>低 {stats.low}</div>}
          </div>
        </div>
      )}

      {/* Risk table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Brain size={16} /></span> 員工離職風險評估</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>部門</th>
                <th>職位</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('tenure_months')}>年資(月) <SortIcon field="tenure_months" /></th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('late_count_90d')}>遲到(90天) <SortIcon field="late_count_90d" /></th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('leave_count_90d')}>請假(90天) <SortIcon field="leave_count_90d" /></th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('performance_score')}>績效 <SortIcon field="performance_score" /></th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('risk_score')}>風險分數 <SortIcon field="risk_score" /></th>
                <th>風險等級</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => (
                <>
                  <tr key={emp.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === emp.id ? null : emp.id)}>
                    <td style={{ fontWeight: 600 }}>{emp.name}</td>
                    <td>{emp.dept || '-'}</td>
                    <td>{emp.position || '-'}</td>
                    <td>{emp.tenure_months ?? '-'}</td>
                    <td style={{ color: emp.late_count_90d >= 5 ? 'var(--accent-red)' : undefined, fontWeight: emp.late_count_90d >= 5 ? 600 : undefined }}>
                      {emp.late_count_90d}
                    </td>
                    <td style={{ color: emp.leave_count_90d >= 8 ? 'var(--accent-orange)' : undefined }}>
                      {emp.leave_count_90d}天
                    </td>
                    <td>
                      {emp.performance_score !== null ? (
                        <span style={{ color: emp.performance_score < 70 ? 'var(--accent-red)' : emp.performance_score >= 90 ? 'var(--accent-green)' : 'var(--accent-cyan)' }}>
                          {emp.performance_score}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                          <div style={{ width: `${emp.risk_score}%`, height: '100%', borderRadius: 3, background: emp.risk.color }} />
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{emp.risk_score}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                        color: emp.risk.color, background: emp.risk.bg,
                      }}>
                        {emp.risk.text}
                      </span>
                    </td>
                  </tr>
                  {expandedId === emp.id && (
                    <tr key={`${emp.id}-detail`}>
                      <td colSpan={9} style={{ background: 'var(--bg-secondary)', padding: '12px 20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>風險因素</div>
                            {emp.risk_factors.length > 0 ? (
                              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                                {emp.risk_factors.map((f, i) => (
                                  <li key={i} style={{ marginBottom: 2, color: 'var(--accent-red)' }}>{f}</li>
                                ))}
                              </ul>
                            ) : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>無顯著風險因素</span>}
                          </div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>詳細指標</div>
                            <div style={{ fontSize: 13, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                              <span>薪資百分位：</span><span style={{ fontWeight: 600 }}>{emp.salary_percentile !== null ? `${emp.salary_percentile}%` : '-'}</span>
                              <span>滿意度分數：</span><span style={{ fontWeight: 600 }}>{emp.engagement_score ?? '未填寫'}</span>
                              <span>到職日：</span><span>{emp.join_date || '-'}</span>
                              <span>目前薪資：</span><span style={{ fontWeight: 600 }}>{emp.current_salary ? `$${emp.current_salary.toLocaleString()}` : '-'}</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                          <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }}>
                            📋 建立留才計畫
                          </button>
                          <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }}>
                            💬 安排 1-on-1
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>無符合條件的員工</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
