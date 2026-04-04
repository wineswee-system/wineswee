import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import {
  calculateFunnelConversion,
  calculateRepPerformance,
  calculateCLV,
  toCSV,
  downloadCSV,
} from '../../lib/crmEngine'
import { Download, TrendingUp, Users, BarChart3, Target, Award, FileText } from 'lucide-react'

export default function CRMOverview() {
  const [customers, setCustomers] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [tickets, setTickets] = useState([])
  const [contacts, setContacts] = useState([])
  const [locations, setLocations] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [locFilter, setLocFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('customers').select('*'),
      supabase.from('opportunities').select('*'),
      supabase.from('service_tickets').select('*'),
      supabase.from('customer_contacts').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('locations').select('*'),
      supabase.from('marketing_campaigns').select('*'),
    ]).then(([c, o, t, ct, l, cam]) => {
      setCustomers(c.data || [])
      setOpportunities(o.data || [])
      setTickets(t.data || [])
      setContacts(ct.data || [])
      setLocations(l.data || [])
      setCampaigns(cam.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  // --- Filtered data ---
  const fCustomers = customers.filter(c => locFilter === '' || String(c.location_id) === locFilter)
  const fOpps = opportunities.filter(o => locFilter === '' || String(o.location_id) === locFilter)
  const fTickets = tickets.filter(t => locFilter === '' || String(t.location_id) === locFilter)

  // --- KPI calculations ---
  const totalOppValue = fOpps.filter(o => !['贏單', '輸單'].includes(o.stage)).reduce((s, o) => s + (o.amount || 0), 0)
  const forecastValue = fOpps.filter(o => !['贏單', '輸單'].includes(o.stage)).reduce((s, o) => s + (o.amount || 0) * ((o.probability || 0) / 100), 0)
  const openTickets = fTickets.filter(t => t.status !== '已解決').length

  // --- Funnel conversion ---
  const funnelData = calculateFunnelConversion(fOpps)

  // --- Rep performance ---
  const repNames = [...new Set(fOpps.map(o => o.assignee).filter(Boolean))]
  const repPerformance = calculateRepPerformance(fOpps, repNames).sort((a, b) => b.totalRevenue - a.totalRevenue)

  // --- CLV for top customers ---
  const clvData = fCustomers.map(cust => {
    const custOrders = fOpps.filter(o => o.stage === '贏單' && o.customer_name === cust.name)
    const clvResult = calculateCLV(cust, custOrders, 24)
    return { ...cust, ...clvResult }
  }).sort((a, b) => b.clv - a.clv).slice(0, 5)

  // --- Campaign ROI ---
  const totalCampaigns = campaigns.length
  const totalSent = campaigns.reduce((s, c) => s + (c.sent_count || c.audience_size || 0), 0)
  const avgOpenRate = totalCampaigns > 0
    ? Math.round(campaigns.reduce((s, c) => s + (c.open_rate || 0), 0) / totalCampaigns)
    : 0
  const totalCampaignCost = campaigns.reduce((s, c) => s + (c.cost || c.budget || 0), 0)
  const totalCampaignRevenue = campaigns.reduce((s, c) => s + (c.revenue || 0), 0)
  const estimatedROI = totalCampaignCost > 0
    ? Math.round(((totalCampaignRevenue - totalCampaignCost) / totalCampaignCost) * 100)
    : 0

  // --- Stage config ---
  const STAGES = ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單']
  const stageColors = { '初步接觸': 'var(--accent-blue)', '需求分析': 'var(--accent-cyan)', '報價': 'var(--accent-purple)', '議價': 'var(--accent-orange)', '贏單': 'var(--accent-green)', '輸單': 'var(--accent-red)' }
  const contactTypeIcon = { call: '📞', email: '📧', line: '💬', meeting: '🤝' }

  const filterBtnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  // --- Export handlers ---
  const handleExportCustomers = () => {
    const cols = ['name', 'company', 'phone', 'email', 'status', 'tags', 'total_spent', 'outstanding_amount']
    const csv = toCSV(fCustomers, cols)
    downloadCSV(csv, 'crm_customers.csv')
  }

  const handleExportPipeline = () => {
    const cols = ['name', 'customer_name', 'stage', 'amount', 'probability', 'assignee', 'expected_close_date']
    const csv = toCSV(fOpps, cols)
    downloadCSV(csv, 'crm_pipeline.csv')
  }

  const handleExportTickets = () => {
    const cols = ['id', 'customer_name', 'subject', 'type', 'priority', 'assignee', 'status']
    const csv = toCSV(fTickets, cols)
    downloadCSV(csv, 'crm_tickets.csv')
  }

  // --- CLV bar helper ---
  const maxCLV = clvData.length > 0 ? clvData[0].clv : 1

  return (
    <div className="fade-in">
      {/* Page Header + Export Buttons */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2><span className="header-icon">🤝</span> CRM 客戶關係管理</h2>
          <p>客戶 360 度視圖、銷售漏斗與行銷自動化</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={handleExportCustomers} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <Download size={14} /> 客戶 CSV
          </button>
          <button className="btn" onClick={handleExportPipeline} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <Download size={14} /> 商機 CSV
          </button>
          <button className="btn" onClick={handleExportTickets} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <Download size={14} /> 工單 CSV
          </button>
        </div>
      </div>

      {/* Location Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={filterBtnStyle(locFilter === '')} onClick={() => setLocFilter('')}>全部分店</button>
        {locations.map(l => (
          <button key={l.id} style={filterBtnStyle(locFilter === String(l.id))} onClick={() => setLocFilter(String(l.id))}>{l.name}</button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label"><Users size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />客戶總數</div>
          <div className="stat-card-value">{fCustomers.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label"><BarChart3 size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />進行中商機金額</div>
          <div className="stat-card-value">$ {totalOppValue.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label"><TrendingUp size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />預計成交金額</div>
          <div className="stat-card-value">$ {Math.round(forecastValue).toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label"><FileText size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />待處理客服工單</div>
          <div className="stat-card-value">{openTickets}</div>
        </div>
      </div>

      {/* Row: Funnel Conversion + Rep Performance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Funnel Conversion Analytics */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Target size={16} /></span> 銷售漏斗轉換率</div>
          </div>
          <div style={{ padding: '8px 16px 16px' }}>
            {funnelData.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 16 }}>尚無商機資料</div>
            ) : funnelData.map((item, idx) => {
              const maxReached = funnelData[0]?.reached || 1
              const barWidth = Math.max(8, (item.reached / maxReached) * 100)
              const prevItem = idx > 0 ? funnelData[idx - 1] : null
              const dropPct = prevItem && prevItem.reached > 0
                ? Math.round(((prevItem.reached - item.reached) / prevItem.reached) * 100)
                : 0
              return (
                <div key={item.stage} style={{ marginBottom: 12 }}>
                  {idx > 0 && dropPct > 0 && (
                    <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--accent-red)', margin: '-4px 0 4px', fontWeight: 600 }}>
                      ▼ 流失 {dropPct}%
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{item.stage}</span>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ color: stageColors[item.stage] || 'var(--text-primary)', fontWeight: 700 }}>
                        {item.reached} 筆
                      </span>
                      <span style={{
                        background: item.conversionRate >= 70 ? 'var(--accent-green)' : item.conversionRate >= 40 ? 'var(--accent-orange)' : 'var(--accent-red)',
                        color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700,
                      }}>
                        {item.conversionRate}%
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>$ {item.value.toLocaleString()}</span>
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--glass-light)', borderRadius: 4 }}>
                    <div style={{
                      height: '100%',
                      width: `${barWidth}%`,
                      background: stageColors[item.stage] || 'var(--accent-blue)',
                      borderRadius: 4,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Sales Rep Performance Leaderboard */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Award size={16} /></span> 業務排行榜</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>業務</th>
                  <th>總商機</th>
                  <th>成交</th>
                  <th>營收</th>
                  <th>勝率</th>
                  <th>平均單價</th>
                </tr>
              </thead>
              <tbody>
                {repPerformance.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無業務資料</td></tr>
                )}
                {repPerformance.map((r, i) => (
                  <tr key={r.rep}>
                    <td style={{ fontWeight: 700, color: i === 0 ? 'var(--accent-orange)' : i === 1 ? 'var(--text-secondary)' : i === 2 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </td>
                    <td style={{ fontWeight: 600 }}>{r.rep}</td>
                    <td>{r.totalDeals}</td>
                    <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{r.wonDeals}</td>
                    <td style={{ fontWeight: 700 }}>$ {r.totalRevenue.toLocaleString()}</td>
                    <td>
                      <span style={{
                        background: r.winRate >= 60 ? 'var(--accent-green)' : r.winRate >= 30 ? 'var(--accent-orange)' : 'var(--accent-red)',
                        color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                      }}>
                        {r.winRate}%
                      </span>
                    </td>
                    <td>$ {r.avgDealSize.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Row: CLV + Campaign ROI */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Customer Lifetime Value */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><TrendingUp size={16} /></span> 客戶終身價值 Top 5</div>
          </div>
          <div style={{ padding: '8px 16px 16px' }}>
            {clvData.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 16 }}>尚無客戶資料</div>
            ) : clvData.map((c, idx) => (
              <div key={c.id || idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: idx < clvData.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: idx === 0 ? 'var(--accent-orange)' : idx === 1 ? 'var(--accent-cyan)' : 'var(--accent-purple)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                }}>
                  {idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    月均 $ {(c.avgMonthly || 0).toLocaleString()} / 頻率 {c.frequency || 0} 次/月
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-green)' }}>$ {(c.clv || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>已消費 $ {(c.totalSpent || 0).toLocaleString()}</div>
                </div>
                {/* Sparkline-style bar indicator */}
                <div style={{ width: 60, height: 8, background: 'var(--glass-light)', borderRadius: 4, flexShrink: 0 }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round((c.clv / maxCLV) * 100)}%`,
                    background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-green))',
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Campaign ROI */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📣</span> 行銷活動成效</div>
          </div>
          <div style={{ padding: '8px 16px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>活動總數</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent-purple)' }}>{totalCampaigns}</div>
              </div>
              <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>總發送數</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent-cyan)' }}>{totalSent.toLocaleString()}</div>
              </div>
              <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>平均開信率</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: avgOpenRate >= 30 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>{avgOpenRate}%</div>
              </div>
              <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>預估 ROI</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: estimatedROI >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {estimatedROI >= 0 ? '+' : ''}{estimatedROI}%
                </div>
              </div>
            </div>
            {totalCampaigns > 0 && (
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
                <span>總成本: $ {totalCampaignCost.toLocaleString()}</span>
                <span>總收入: $ {totalCampaignRevenue.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row: Recent Activity + Tickets */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Recent Contacts / Activity */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📝</span> 最新互動紀錄</div>
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            {contacts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 16 }}>尚無互動紀錄</div>
            ) : contacts.slice(0, 6).map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 18 }}>{contactTypeIcon[c.type] || '📋'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.content?.slice(0, 40)}{c.content?.length > 40 ? '...' : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.operator} · {new Date(c.created_at).toLocaleString('zh-TW')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Legacy Sales Funnel (simple bar view) */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📊</span> 銷售漏斗</div>
          </div>
          <div style={{ padding: '8px 16px 16px' }}>
            {STAGES.map(stage => {
              const count = fOpps.filter(o => o.stage === stage).length
              const value = fOpps.filter(o => o.stage === stage).reduce((s, o) => s + (o.amount || 0), 0)
              const maxCount = Math.max(...STAGES.map(s => fOpps.filter(o => o.stage === s).length), 1)
              return (
                <div key={stage} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{stage}</span>
                    <span style={{ color: stageColors[stage], fontWeight: 700 }}>{count} 筆 · ${value.toLocaleString()}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--glass-light)', borderRadius: 4 }}>
                    <div style={{ height: '100%', width: `${(count / maxCount) * 100}%`, background: stageColors[stage], borderRadius: 4, transition: 'width 0.3s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Ticket Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🎫</span> 客服工單概況</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>工單編號</th><th>客戶</th><th>主旨</th><th>類型</th><th>優先度</th><th>負責人</th><th>狀態</th></tr></thead>
            <tbody>
              {fTickets.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無工單</td></tr>}
              {fTickets.slice(0, 8).map(t => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>#{String(t.id).padStart(4, '0')}</td>
                  <td>{t.customer_name}</td>
                  <td>{t.subject}</td>
                  <td style={{ fontSize: 12 }}>{t.type}</td>
                  <td><span className={`badge ${t.priority === '緊急' ? 'badge-danger' : t.priority === '高' ? 'badge-warning' : 'badge-neutral'}`}><span className="badge-dot"></span>{t.priority}</span></td>
                  <td>{t.assignee}</td>
                  <td><span className={`badge ${t.status === '已解決' ? 'badge-success' : t.status === '處理中' ? 'badge-info' : 'badge-warning'}`}><span className="badge-dot"></span>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
