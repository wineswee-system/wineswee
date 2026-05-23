import { useEffect, useState } from 'react'
import { Clock, CreditCard, MapPin, RefreshCw } from 'lucide-react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { KpiCard, SectionHeader, EmptyState, DataTable, NT, NT_K, NUM } from './components/AnalyticsCommon'

ChartJS.register(ArcElement, Tooltip, Legend)

const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六']
const PAYMENT_COLOR = ['#22d3ee', '#34d399', '#fb923c', '#a78bfa', '#f87171', '#fbbf24', '#3b82f6']

export default function POSAnalytics() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_pos_analytics', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) setError(error.message); else setData(res)
      }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>
  if (!data) return <LoadingSpinner />

  const wc = data.week_comparison || {}
  const wowChange = wc.last_week > 0 ? ((wc.this_week - wc.last_week) / wc.last_week) * 100 : 0
  const yoyChange = wc.last_year_same_week > 0 ? ((wc.this_week - wc.last_year_same_week) / wc.last_year_same_week) * 100 : 0

  // 熱力 grid：把資料轉成 7×24 矩陣
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0))
  const heatRevenue = Array.from({ length: 7 }, () => Array(24).fill(0))
  let maxCnt = 0
  for (const cell of (data.hour_heatmap || [])) {
    if (cell.weekday >= 0 && cell.weekday < 7 && cell.hour >= 0 && cell.hour < 24) {
      heatmap[cell.weekday][cell.hour] = cell.count
      heatRevenue[cell.weekday][cell.hour] = cell.revenue
      if (cell.count > maxCnt) maxCnt = cell.count
    }
  }

  const payment = data.payment_mix || []
  const paymentChart = {
    labels: payment.map(p => p.method),
    datasets: [{
      data: payment.map(p => p.amount),
      backgroundColor: payment.map((_, i) => PAYMENT_COLOR[i % PAYMENT_COLOR.length]),
      borderWidth: 0,
    }],
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">🛒</span> POS / 門市分析</h2>
            <p>同期業績比較 · 時段熱力圖 · 支付方式 · 門市排行</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="本週營收" value={NT_K(wc.this_week)} accent="cyan" />
        <KpiCard label="vs 上週" value={`${wowChange >= 0 ? '+' : ''}${wowChange.toFixed(1)}%`}
          sub={`上週 ${NT_K(wc.last_week)}`} accent={wowChange >= 0 ? 'green' : 'red'} />
        <KpiCard label="vs 去年同週" value={`${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}%`}
          sub={`去年 ${NT_K(wc.last_year_same_week)}`} accent={yoyChange >= 0 ? 'green' : 'red'} />
        <KpiCard label="活躍門市" value={NUM((data.store_rank || []).length)}
          sub="本月有交易" accent="purple" />
      </div>

      <SectionHeader icon={Clock} title="時段熱力圖（近 30 天交易次數）" accent="cyan" />
      <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
        {(data.hour_heatmap || []).length === 0 ? <EmptyState msg="無 POS 交易資料" /> : (
          <table style={{ borderCollapse: 'separate', borderSpacing: 2, minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ padding: 4, fontSize: 10, color: 'var(--text-muted)' }}></th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} style={{ padding: 4, fontSize: 10, color: 'var(--text-muted)', minWidth: 22, textAlign: 'center' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAY_LABEL.map((wd, wdi) => (
                <tr key={wd}>
                  <td style={{ padding: 4, fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>週{wd}</td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cnt = heatmap[wdi][h]
                    const intensity = maxCnt > 0 ? cnt / maxCnt : 0
                    return (
                      <td key={h} title={`週${wd} ${h}:00 - ${cnt} 筆 / NT$ ${Math.round(heatRevenue[wdi][h]).toLocaleString()}`}
                        style={{
                          padding: 0, height: 22, borderRadius: 2, minWidth: 22,
                          background: cnt > 0
                            ? `rgba(34,211,238,${Math.max(0.15, intensity)})`
                            : 'var(--bg-elevated)',
                          cursor: 'pointer',
                        }}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SectionHeader icon={CreditCard} title="本月支付方式分布" accent="purple" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          {payment.length === 0 ? <EmptyState msg="本月無交易" /> : (
            <div style={{ height: 240 }}>
              <Doughnut data={paymentChart} options={{
                responsive: true, maintainAspectRatio: false, cutout: '55%',
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } } },
              }} />
            </div>
          )}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <DataTable
            rows={payment}
            columns={[
              { key: 'method', label: '支付方式' },
              { key: 'count', label: '筆數', render: v => NUM(v) },
              { key: 'amount', label: '金額', render: v => NT(v) },
            ]}
          />
        </div>
      </div>

      <SectionHeader icon={MapPin} title="門市業績排行（本月）" accent="green" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.store_rank || []}
          columns={[
            { key: 'store', label: '門市' },
            { key: 'orders', label: '訂單數', render: v => NUM(v) },
            { key: 'revenue', label: '營收', render: v => NT(v) },
            { key: 'avg_ticket', label: '客單價', render: v => NT(v) },
          ]}
          emptyMsg="本月無門市交易"
        />
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
