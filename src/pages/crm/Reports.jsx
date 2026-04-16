import { useState, useEffect, useMemo } from 'react'
import { BarChart2, TrendingUp, Users, DollarSign, Calendar, Download, Filter } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { calculateFunnelConversion, calculateRepPerformance, forecastRevenue, toCSV, downloadCSV } from '../../lib/crmEngine'
import LoadingSpinner from '../../components/LoadingSpinner'

// ── Date helpers ──────────────────────────────────────────
function fmt(d) { return d.toISOString().slice(0, 10) }

function getMonthRange(offset = 0) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return [fmt(start), fmt(end)]
}

function getQuarterRange() {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const start = new Date(now.getFullYear(), q * 3, 1)
  const end = new Date(now.getFullYear(), q * 3 + 3, 0)
  return [fmt(start), fmt(end)]
}

function getYearRange() {
  const now = new Date()
  return [fmt(new Date(now.getFullYear(), 0, 1)), fmt(new Date(now.getFullYear(), 11, 31))]
}

function getLast6Months() {
  const now = new Date()
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'short' }),
    })
  }
  return months
}

// ── Styles ────────────────────────────────────────────────
const cardStyle = {
  background: 'var(--bg-card)',
  borderRadius: 12,
  border: '1px solid var(--border)',
  padding: 20,
}

const kpiCardStyle = (accent) => ({
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  position: 'relative',
  overflow: 'hidden',
})

const kpiValueStyle = { fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }
const kpiLabelStyle = { fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }
const sectionTitleStyle = { fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }

const quickBtnStyle = (active) => ({
  padding: '6px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: active ? 'var(--accent-blue)' : 'var(--bg-card)',
  color: active ? '#fff' : 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
})

const inputStyle = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: 13,
}

// ── Component ─────────────────────────────────────────────
export default function CRMReports() {
  const [thisMonth] = getMonthRange(0)
  const [, thisMonthEnd] = getMonthRange(0)
  const [startDate, setStartDate] = useState(thisMonth)
  const [endDate, setEndDate] = useState(thisMonthEnd)
  const [quickRange, setQuickRange] = useState('thisMonth')

  const [opportunities, setOpportunities] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ── Fetch data ──────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('opportunities').select('*'),
      supabase.from('crm_leads').select('*'),
    ]).then(([oppRes, leadRes]) => {
      setOpportunities(oppRes.data || [])
      setLeads(leadRes.data || [])
    }).catch(err => {
      console.error('Failed to load report data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  // ── Quick range handlers ────────────────────────────────
  const applyRange = (key) => {
    setQuickRange(key)
    let range
    switch (key) {
      case 'thisMonth': range = getMonthRange(0); break
      case 'lastMonth': range = getMonthRange(-1); break
      case 'thisQuarter': range = getQuarterRange(); break
      case 'thisYear': range = getYearRange(); break
      default: return
    }
    setStartDate(range[0])
    setEndDate(range[1])
  }

  const handleDateChange = (field, value) => {
    setQuickRange('')
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  // ── Filter data by date range ───────────────────────────
  const filteredOpps = useMemo(() => {
    return opportunities.filter(o => {
      const d = o.created_at?.slice(0, 10)
      if (!d) return false
      return d >= startDate && d <= endDate
    })
  }, [opportunities, startDate, endDate])

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      const d = l.created_at?.slice(0, 10)
      if (!d) return false
      return d >= startDate && d <= endDate
    })
  }, [leads, startDate, endDate])

  // ── KPIs ────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const wonOpps = filteredOpps.filter(o => o.stage === '贏單')
    const totalWonAmount = wonOpps.reduce((s, o) => s + (o.amount || 0), 0)

    // Average days to close
    const closeDays = wonOpps.map(o => {
      if (!o.created_at) return null
      const closeDate = o.updated_at || o.created_at
      return Math.max(1, Math.round((new Date(closeDate) - new Date(o.created_at)) / (1000 * 60 * 60 * 24)))
    }).filter(Boolean)
    const avgCloseDays = closeDays.length > 0 ? Math.round(closeDays.reduce((s, d) => s + d, 0) / closeDays.length) : 0

    return {
      newLeads: filteredLeads.length,
      wonDeals: wonOpps.length,
      wonAmount: totalWonAmount,
      avgCloseDays,
    }
  }, [filteredOpps, filteredLeads])

  // ── Pipeline velocity (deals per stage with amounts) ────
  const pipelineVelocity = useMemo(() => {
    const stages = ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單']
    const stageColors = {
      '初步接觸': 'var(--accent-blue)',
      '需求分析': 'var(--accent-cyan)',
      '報價': 'var(--accent-purple)',
      '議價': 'var(--accent-orange)',
      '贏單': 'var(--accent-green)',
      '輸單': 'var(--accent-red)',
    }
    return stages.map(stage => {
      const stageOpps = filteredOpps.filter(o => o.stage === stage)
      return {
        stage,
        count: stageOpps.length,
        amount: stageOpps.reduce((s, o) => s + (o.amount || 0), 0),
        color: stageColors[stage] || 'var(--accent-blue)',
      }
    })
  }, [filteredOpps])

  // ── Rep performance ─────────────────────────────────────
  const repData = useMemo(() => {
    const reps = [...new Set(filteredOpps.map(o => o.assignee).filter(Boolean))]
    return calculateRepPerformance(filteredOpps, reps).sort((a, b) => b.totalRevenue - a.totalRevenue)
  }, [filteredOpps])

  // ── Funnel conversion ──────────────────────────────────
  const funnelData = useMemo(() => calculateFunnelConversion(filteredOpps), [filteredOpps])

  // ── Monthly trend (last 6 months, using all opps) ──────
  const monthlyTrend = useMemo(() => {
    const months = getLast6Months()
    return months.map(m => {
      const monthWon = opportunities.filter(o =>
        o.stage === '贏單' && (o.updated_at || o.created_at || '').slice(0, 7) === m.key
      )
      return {
        ...m,
        revenue: monthWon.reduce((s, o) => s + (o.amount || 0), 0),
        deals: monthWon.length,
      }
    })
  }, [opportunities])

  // ── Revenue forecast ────────────────────────────────────
  const forecast = useMemo(() => forecastRevenue(opportunities, 3), [opportunities])

  // ── CSV export ──────────────────────────────────────────
  const handleExportRepCSV = () => {
    if (repData.length === 0) return
    const rows = repData.map(r => ({
      業務代表: r.rep,
      成交數: r.wonDeals,
      營收: r.totalRevenue,
      勝率: `${r.winRate}%`,
      進行中: r.activeDeals,
      總商機: r.totalDeals,
    }))
    const cols = ['業務代表', '成交數', '營收', '勝率', '進行中', '總商機']
    const csv = toCSV(rows, cols)
    downloadCSV(csv, `crm_rep_performance_${startDate}_${endDate}.csv`)
  }

  // ── Render ──────────────────────────────────────────────
  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const maxVelocity = Math.max(...pipelineVelocity.map(v => v.count), 1)
  const maxMonthRevenue = Math.max(...monthlyTrend.map(m => m.revenue), 1)
  const maxFunnelReached = funnelData.length > 0 ? funnelData[0]?.reached || 1 : 1

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2><span className="header-icon"><BarChart2 size={22} /></span> CRM 報表分析</h2>
          <p>銷售數據、業績分析與趨勢追蹤</p>
        </div>
        <button className="btn btn-secondary" onClick={handleExportRepCSV} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Download size={14} /> 匯出業績 CSV
        </button>
      </div>

      {/* Date Range Filter */}
      <div style={{ ...cardStyle, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Filter size={16} style={{ color: 'var(--text-secondary)' }} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>篩選期間</span>
        <input
          type="date"
          value={startDate}
          onChange={e => handleDateChange('start', e.target.value)}
          style={inputStyle}
        />
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>至</span>
        <input
          type="date"
          value={endDate}
          onChange={e => handleDateChange('end', e.target.value)}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          {[
            { key: 'thisMonth', label: '本月' },
            { key: 'lastMonth', label: '上月' },
            { key: 'thisQuarter', label: '本季' },
            { key: 'thisYear', label: '本年' },
          ].map(r => (
            <button key={r.key} style={quickBtnStyle(quickRange === r.key)} onClick={() => applyRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
        <div style={kpiCardStyle('var(--accent-blue)')}>
          <div style={kpiLabelStyle}><Users size={15} /> 新增線索</div>
          <div style={kpiValueStyle}>{kpis.newLeads}</div>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 60, height: 60, background: 'var(--accent-blue)', opacity: 0.08, borderRadius: '0 12px 0 60px' }} />
        </div>
        <div style={kpiCardStyle('var(--accent-green)')}>
          <div style={kpiLabelStyle}><TrendingUp size={15} /> 成交商機</div>
          <div style={kpiValueStyle}>{kpis.wonDeals}</div>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 60, height: 60, background: 'var(--accent-green)', opacity: 0.08, borderRadius: '0 12px 0 60px' }} />
        </div>
        <div style={kpiCardStyle('var(--accent-purple)')}>
          <div style={kpiLabelStyle}><DollarSign size={15} /> 成交金額</div>
          <div style={kpiValueStyle}>$ {kpis.wonAmount.toLocaleString()}</div>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 60, height: 60, background: 'var(--accent-purple)', opacity: 0.08, borderRadius: '0 12px 0 60px' }} />
        </div>
        <div style={kpiCardStyle('var(--accent-orange)')}>
          <div style={kpiLabelStyle}><Calendar size={15} /> 平均成交天數</div>
          <div style={kpiValueStyle}>{kpis.avgCloseDays} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>天</span></div>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 60, height: 60, background: 'var(--accent-orange)', opacity: 0.08, borderRadius: '0 12px 0 60px' }} />
        </div>
      </div>

      {/* Pipeline Velocity + Conversion Funnel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Pipeline Velocity Chart */}
        <div style={cardStyle}>
          <div style={sectionTitleStyle}><BarChart2 size={18} style={{ color: 'var(--accent-blue)' }} /> 商機階段分布</div>
          {pipelineVelocity.every(v => v.count === 0) ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: 32 }}>期間內無商機資料</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pipelineVelocity.map(v => (
                <div key={v.stage}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{v.stage}</span>
                    <span style={{ display: 'flex', gap: 10 }}>
                      <span style={{ color: v.color, fontWeight: 700 }}>{v.count} 筆</span>
                      <span style={{ color: 'var(--text-secondary)' }}>$ {v.amount.toLocaleString()}</span>
                    </span>
                  </div>
                  <div style={{ height: 20, background: 'var(--bg-main)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.max(2, (v.count / maxVelocity) * 100)}%`,
                      background: v.color,
                      borderRadius: 6,
                      transition: 'width 0.4s ease',
                      opacity: 0.8,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Conversion Funnel */}
        <div style={cardStyle}>
          <div style={sectionTitleStyle}><Filter size={18} style={{ color: 'var(--accent-cyan)' }} /> 轉換漏斗</div>
          {funnelData.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: 32 }}>期間內無漏斗資料</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              {funnelData.map((item, idx) => {
                const widthPct = Math.max(20, (item.reached / maxFunnelReached) * 100)
                const prevItem = idx > 0 ? funnelData[idx - 1] : null
                const dropPct = prevItem && prevItem.reached > 0
                  ? Math.round(((prevItem.reached - item.reached) / prevItem.reached) * 100)
                  : 0
                const stageColors = {
                  '初步接觸': 'var(--accent-blue)',
                  '需求分析': 'var(--accent-cyan)',
                  '報價': 'var(--accent-purple)',
                  '議價': 'var(--accent-orange)',
                  '贏單': 'var(--accent-green)',
                }
                const color = stageColors[item.stage] || 'var(--accent-blue)'

                return (
                  <div key={item.stage} style={{ width: '100%', textAlign: 'center' }}>
                    {idx > 0 && dropPct > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--accent-red)', fontWeight: 600, margin: '2px 0' }}>
                        ▼ 流失 {dropPct}%
                      </div>
                    )}
                    <div style={{
                      width: `${widthPct}%`,
                      margin: '0 auto',
                      background: color,
                      opacity: 0.75,
                      borderRadius: 6,
                      padding: '8px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'width 0.4s ease',
                      minHeight: 36,
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{item.stage}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                        {item.reached} 筆
                        {item.conversionRate > 0 && <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.85 }}>({item.conversionRate}%)</span>}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Rep Performance Table */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ ...sectionTitleStyle, justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} style={{ color: 'var(--accent-purple)' }} /> 業務代表績效
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleExportRepCSV}
            disabled={repData.length === 0}
            style={{ fontSize: 12, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Download size={12} /> CSV
          </button>
        </div>
        {repData.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: 32 }}>期間內無業務資料</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>業務代表</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>成交數</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>營收</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>勝率</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>進行中</th>
                </tr>
              </thead>
              <tbody>
                {repData.map((r, idx) => (
                  <tr key={r.rep} style={{ borderBottom: '1px solid var(--border)', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-main)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{r.rep}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--accent-green)', fontWeight: 600 }}>{r.wonDeals}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>$ {r.totalRevenue.toLocaleString()}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        background: r.winRate >= 50 ? 'rgba(34,197,94,0.12)' : r.winRate >= 30 ? 'rgba(234,179,8,0.12)' : 'rgba(239,68,68,0.12)',
                        color: r.winRate >= 50 ? 'var(--accent-green)' : r.winRate >= 30 ? 'var(--accent-orange)' : 'var(--accent-red)',
                      }}>
                        {r.winRate}%
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--accent-blue)' }}>{r.activeDeals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monthly Trend */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={sectionTitleStyle}><TrendingUp size={18} style={{ color: 'var(--accent-green)' }} /> 近 6 個月成交趨勢</div>
        {monthlyTrend.every(m => m.revenue === 0) ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: 32 }}>尚無成交記錄</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {monthlyTrend.map(m => (
              <div key={m.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500, minWidth: 100 }}>{m.label}</span>
                  <span style={{ display: 'flex', gap: 10 }}>
                    <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{m.deals} 筆</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>$ {m.revenue.toLocaleString()}</span>
                  </span>
                </div>
                <div style={{ height: 18, background: 'var(--bg-main)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.max(2, (m.revenue / maxMonthRevenue) * 100)}%`,
                    background: 'linear-gradient(90deg, var(--accent-green), var(--accent-cyan))',
                    borderRadius: 6,
                    transition: 'width 0.4s ease',
                    opacity: 0.8,
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Revenue Forecast */}
      {forecast.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionTitleStyle}><DollarSign size={18} style={{ color: 'var(--accent-orange)' }} /> 未來 3 個月預測營收</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${forecast.length}, 1fr)`, gap: 12 }}>
            {forecast.map(f => (
              <div key={f.monthKey} style={{
                background: 'var(--bg-main)',
                borderRadius: 10,
                padding: 16,
                textAlign: 'center',
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{f.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-orange)' }}>$ {(f.weighted || 0).toLocaleString()}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{f.count || 0} 筆商機</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
