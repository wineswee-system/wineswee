import { useEffect, useState } from 'react'
import { DollarSign, TrendingUp, AlertTriangle, ArrowLeftRight, RefreshCw } from 'lucide-react'
import { Doughnut, Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { KpiCard, SectionHeader, EmptyState, DataTable, NT, NT_K, PCT } from './components/AnalyticsCommon'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
    tooltip: { backgroundColor: 'rgba(15,23,55,0.95)' },
  },
}

export default function FinanceAnalytics() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_finance_analytics', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) setError(error.message); else setData(res)
      }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>
  if (!data) return <LoadingSpinner />

  const ar = data.ar_aging || {}
  const ap = data.ap_aging || {}
  const trend = data.monthly_trend || []
  const cf = data.cashflow_forecast || {}

  const arDoughnut = {
    labels: ['未到期', '1-30 天', '31-60 天', '60 天+'],
    datasets: [{
      data: [ar.current || 0, ar.d1_30 || 0, ar.d31_60 || 0, ar.d60plus || 0],
      backgroundColor: ['#34d399', '#fbbf24', '#fb923c', '#f87171'],
      borderWidth: 0,
    }],
  }
  const apDoughnut = {
    labels: ['未到期', '1-30 天', '31-60 天', '60 天+'],
    datasets: [{
      data: [ap.current || 0, ap.d1_30 || 0, ap.d31_60 || 0, ap.d60plus || 0],
      backgroundColor: ['#34d399', '#fbbf24', '#fb923c', '#f87171'],
      borderWidth: 0,
    }],
  }
  const trendChart = {
    labels: trend.map(t => t.month.slice(5) + '月'),
    datasets: [
      { label: '營收', data: trend.map(t => t.revenue), borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.1)', fill: true, tension: 0.4 },
      { label: '成本', data: trend.map(t => t.cost), borderColor: '#fb923c', backgroundColor: 'rgba(251,146,60,0.1)', fill: true, tension: 0.4 },
      { label: '毛利', data: trend.map(t => t.gross_profit), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)', fill: false, tension: 0.4, borderDash: [4, 2] },
    ],
  }

  const cashflow30 = (cf.d0_30_in || 0) - (cf.d0_30_out || 0)
  const cashflow60 = (cf.d31_60_in || 0) - (cf.d31_60_out || 0)
  const cashflow90 = (cf.d61_90_in || 0) - (cf.d61_90_out || 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">💰</span> 財務分析</h2>
            <p>AR/AP 帳齡 · 毛利趨勢 · 現金流預測 · 費用結構</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="應收餘額" value={NT_K(ar.total_balance)}
          sub={`60 天+ ${NT_K(ar.d60plus || 0)}`} accent="orange" />
        <KpiCard label="應付餘額" value={NT_K(ap.total_balance)}
          sub={`60 天+ ${NT_K(ap.d60plus || 0)}`} accent="red" />
        <KpiCard label="30 天淨現金流" value={NT_K(cashflow30)}
          sub={`收 ${NT_K(cf.d0_30_in)} - 付 ${NT_K(cf.d0_30_out)}`}
          accent={cashflow30 >= 0 ? 'green' : 'red'} />
        <KpiCard label="本月毛利率" value={PCT(trend[trend.length - 1]?.margin_pct || 0)}
          sub={trend.length > 1 ? `上月 ${PCT(trend[trend.length - 2]?.margin_pct || 0)}` : ''} accent="green" />
      </div>

      <SectionHeader icon={DollarSign} title="應收 / 應付 帳齡分布" accent="orange" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: 13 }}>應收帳款</h4>
          <div style={{ height: 220 }}>
            {(ar.total_balance || 0) === 0 ? <EmptyState msg="無應收" /> : (
              <Doughnut data={arDoughnut} options={{ ...chartOpts, cutout: '55%' }} />
            )}
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: 13 }}>應付帳款</h4>
          <div style={{ height: 220 }}>
            {(ap.total_balance || 0) === 0 ? <EmptyState msg="無應付" /> : (
              <Doughnut data={apDoughnut} options={{ ...chartOpts, cutout: '55%' }} />
            )}
          </div>
        </div>
      </div>

      <SectionHeader icon={TrendingUp} title="近 12 月 營收 / 成本 / 毛利" accent="cyan" />
      <div className="card" style={{ padding: 16 }}>
        {trend.length === 0 ? <EmptyState /> : (
          <div style={{ height: 280 }}>
            <Line data={trendChart} options={{ ...chartOpts, scales: { x: { ticks: { color: '#94a3b8' } }, y: { beginAtZero: true, ticks: { color: '#94a3b8' } } } }} />
          </div>
        )}
      </div>

      <SectionHeader icon={ArrowLeftRight} title="現金流預測（未來 90 天）" accent="green" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: '0-30 天', inFlow: cf.d0_30_in, outFlow: cf.d0_30_out, net: cashflow30 },
          { label: '31-60 天', inFlow: cf.d31_60_in, outFlow: cf.d31_60_out, net: cashflow60 },
          { label: '61-90 天', inFlow: cf.d61_90_in, outFlow: cf.d61_90_out, net: cashflow90 },
        ].map(p => (
          <div key={p.label} className="card" style={{ padding: 16, borderLeft: `3px solid var(--accent-${p.net >= 0 ? 'green' : 'red'})` }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{p.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: p.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', margin: '6px 0' }}>
              {NT_K(p.net)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              收 {NT_K(p.inFlow)} · 付 {NT_K(p.outFlow)}
            </div>
          </div>
        ))}
      </div>

      <SectionHeader icon={AlertTriangle} title="Top 10 欠款客戶" accent="orange" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.top_ar_customers || []}
          columns={[
            { key: 'customer', label: '客戶' },
            { key: 'balance', label: '未收餘額', render: v => NT(v) },
            { key: 'count', label: '筆數' },
          ]}
          emptyMsg="無欠款"
        />
      </div>

      <SectionHeader icon={AlertTriangle} title="Top 10 應付供應商" accent="red" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.top_ap_suppliers || []}
          columns={[
            { key: 'supplier', label: '供應商' },
            { key: 'balance', label: '未付餘額', render: v => NT(v) },
            { key: 'count', label: '筆數' },
          ]}
          emptyMsg="無應付"
        />
      </div>

      <SectionHeader icon={DollarSign} title="本月費用結構（Top 10 科目）" accent="purple" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.expense_by_category || []}
          columns={[
            { key: 'category', label: '科目' },
            { key: 'amount', label: '金額', render: v => NT(v) },
            { key: 'count', label: '筆數' },
          ]}
          emptyMsg="本月無費用"
        />
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
