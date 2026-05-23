import { useEffect, useState } from 'react'
import { Target, Award, FileCheck, Receipt, RefreshCw } from 'lucide-react'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { KpiCard, SectionHeader, EmptyState, DataTable, NT, NT_K, NUM, PCT } from './components/AnalyticsCommon'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
    tooltip: { backgroundColor: 'rgba(15,23,55,0.95)' },
  },
}

export default function SalesPerformance() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_sales_analytics', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) setError(error.message); else setData(res)
      }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>
  if (!data) return <LoadingSpinner />

  const funnel = data.funnel || []
  const wonStage = funnel.find(f => f.stage === '贏單')
  const totalOpps = funnel.reduce((s, f) => s + f.count, 0)
  const totalAmt = funnel.reduce((s, f) => s + Number(f.amount || 0), 0)

  const funnelChart = {
    labels: funnel.map(f => f.stage),
    datasets: [{
      label: '商機數',
      data: funnel.map(f => f.count),
      backgroundColor: ['#3b82f6', '#22d3ee', '#a78bfa', '#fb923c', '#34d399', '#f87171'],
      borderRadius: 6,
    }],
  }

  const td = data.ticket_distribution || {}

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">🏆</span> 銷售業績</h2>
            <p>銷售漏斗 · 業務員排行 · 報價轉化 · 客單價分布</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="商機總數" value={NUM(totalOpps)}
          sub={`總額 ${NT_K(totalAmt)}`} accent="cyan" />
        <KpiCard label="贏單金額" value={NT_K(wonStage?.amount || 0)}
          sub={`${wonStage?.count || 0} 件`} accent="green" />
        <KpiCard label="報價轉化率" value={data.quote_conversion?.unavailable ? '-' : PCT(data.quote_conversion?.conversion_pct)}
          sub={data.quote_conversion?.unavailable
            ? '無 quotations 資料'
            : `${data.quote_conversion?.sales_orders_count || 0} / ${data.quote_conversion?.quotations_count || 0}`}
          accent="purple" />
        <KpiCard label="本月平均客單" value={NT(td.avg)}
          sub={`中位數 ${NT(td.median)} · P90 ${NT(td.p90)}`} accent="orange" />
      </div>

      <SectionHeader icon={Target} title="銷售漏斗（按階段）" accent="cyan" />
      <div className="card" style={{ padding: 16 }}>
        {funnel.length === 0 ? <EmptyState msg="無商機資料" /> : (
          <div style={{ height: 280 }}>
            <Bar data={funnelChart} options={{ ...chartOpts, plugins: { legend: { display: false } },
              scales: { x: { ticks: { color: '#94a3b8' } }, y: { beginAtZero: true, ticks: { color: '#94a3b8', stepSize: 1 } } } }} />
          </div>
        )}
        {funnel.length > 0 && (
          <DataTable
            rows={funnel}
            columns={[
              { key: 'stage', label: '階段' },
              { key: 'count', label: '商機數', render: v => NUM(v) },
              { key: 'amount', label: '金額', render: v => NT(v) },
            ]}
          />
        )}
      </div>

      <SectionHeader icon={Award} title="業務員業績排行（按贏單金額）" accent="green" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.top_reps || []}
          columns={[
            { key: 'name', label: '業務員' },
            { key: 'total_count', label: '總商機', render: v => NUM(v) },
            { key: 'won_count', label: '贏單數', render: v => NUM(v) },
            { key: 'won_amount', label: '贏單金額', render: v => NT(v) },
            { key: '_winrate', label: '勝率', render: (_, r) => r.total_count > 0 ? PCT((r.won_count / r.total_count) * 100, 0) : '-' },
          ]}
          emptyMsg="無業務員資料"
        />
      </div>

      <SectionHeader icon={FileCheck} title="報價成功率（近 6 月）" accent="purple" />
      <div className="card" style={{ padding: 16 }}>
        {data.quote_conversion?.unavailable ? <EmptyState msg="quotations / sales_orders 表未啟用" /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>報價數</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{NUM(data.quote_conversion?.quotations_count)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>成交數</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-green)' }}>{NUM(data.quote_conversion?.sales_orders_count)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>轉化率</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-cyan)' }}>{PCT(data.quote_conversion?.conversion_pct)}</div>
            </div>
          </div>
        )}
      </div>

      <SectionHeader icon={Receipt} title="本月客單價分布" accent="orange" />
      <div className="card" style={{ padding: 16 }}>
        {(td.count || 0) === 0 ? <EmptyState msg="本月無 POS 交易" /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>筆數</div><div style={{ fontSize: 18, fontWeight: 700 }}>{NUM(td.count)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>平均</div><div style={{ fontSize: 18, fontWeight: 700 }}>{NT(td.avg)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>中位數</div><div style={{ fontSize: 18, fontWeight: 700 }}>{NT(td.median)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>P90</div><div style={{ fontSize: 18, fontWeight: 700 }}>{NT(td.p90)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>最大</div><div style={{ fontSize: 18, fontWeight: 700 }}>{NT(td.max)}</div></div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
