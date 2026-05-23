import { useEffect, useState } from 'react'
import { Package, AlertTriangle, Layers, Snowflake, RefreshCw } from 'lucide-react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { KpiCard, SectionHeader, EmptyState, DataTable, NUM } from './components/AnalyticsCommon'

ChartJS.register(ArcElement, Tooltip, Legend)

const ABC_COLOR = { 'A': '#f87171', 'B': '#fb923c', 'C': '#94a3b8' }

export default function InventoryAnalytics() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_inventory_analytics', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) setError(error.message); else setData(res)
      }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>
  if (!data) return <LoadingSpinner />

  const abc = data.abc_segments || {}
  const abcLabels = Object.keys(abc)
  const abcChart = {
    labels: abcLabels,
    datasets: [{
      data: Object.values(abc),
      backgroundColor: abcLabels.map(l => ABC_COLOR[l] || '#94a3b8'),
      borderWidth: 0,
    }],
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">📦</span> 庫存分析</h2>
            <p>SKU 統計 · ABC 分析 · 庫存週轉 · 滯銷品</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="總 SKU 數" value={NUM(data.total_skus)}
          sub={`總庫存 ${NUM(Math.round(data.total_qty))}`} accent="cyan" />
        <KpiCard label="低庫存" value={NUM(data.low_stock_count)}
          sub="量低於安全庫存" accent={data.low_stock_count > 0 ? 'orange' : 'green'} />
        <KpiCard label="缺貨" value={NUM(data.out_of_stock_count)}
          sub="量歸零" accent={data.out_of_stock_count > 0 ? 'red' : 'green'} />
        <KpiCard label="滯銷品" value={NUM((data.slow_movers || []).length)}
          sub="90 天無出貨" accent="purple" />
      </div>

      <SectionHeader icon={Layers} title="ABC 分析（近 90 天出貨累計，80/15/5）" accent="cyan" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          {abcLabels.length === 0 ? <EmptyState msg="inventory_transactions 表未啟用" /> : (
            <div style={{ height: 240 }}>
              <Doughnut data={abcChart} options={{
                responsive: true, maintainAspectRatio: false, cutout: '55%',
                plugins: { legend: { labels: { color: '#94a3b8' } } },
              }} />
            </div>
          )}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>ABC 等級意義</h4>
          <ul style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 16 }}>
            <li><b style={{ color: ABC_COLOR['A'] }}>A 級（前 80%）</b>：主力品項，必須隨時保有充足庫存</li>
            <li><b style={{ color: ABC_COLOR['B'] }}>B 級（80-95%）</b>：次要品項，定期補貨即可</li>
            <li><b style={{ color: ABC_COLOR['C'] }}>C 級（後 5%）</b>：低貢獻品項，可考慮停產或減量</li>
          </ul>
        </div>
      </div>

      <SectionHeader icon={Package} title="庫存週轉率 Top 10（近 30 天）" accent="blue" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.turnover_top10 || []}
          columns={[
            { key: 'sku_code', label: 'SKU' },
            { key: 'out_qty', label: '30 天出貨', render: v => NUM(v) },
            { key: 'avg_stock', label: '平均庫存', render: v => NUM(Math.round(v)) },
            { key: 'turnover', label: '週轉率', render: v => `${v}x` },
          ]}
          emptyMsg="inventory_transactions 表未啟用"
        />
      </div>

      <SectionHeader icon={Snowflake} title="滯銷品 Top 20（90 天無出貨）" accent="purple" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.slow_movers || []}
          columns={[
            { key: 'sku_code', label: 'SKU' },
            { key: 'warehouse', label: '倉別' },
            { key: 'quantity', label: '帳面庫存', render: v => NUM(v) },
          ]}
          emptyMsg="無滯銷品"
        />
      </div>

      <SectionHeader icon={AlertTriangle} title="各倉庫存分布" accent="orange" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.by_warehouse || []}
          columns={[
            { key: 'warehouse', label: '倉別' },
            { key: 'sku_count', label: 'SKU 數', render: v => NUM(v) },
            { key: 'total_qty', label: '總庫存', render: v => NUM(Math.round(v)) },
          ]}
          emptyMsg="無倉庫資料"
        />
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
