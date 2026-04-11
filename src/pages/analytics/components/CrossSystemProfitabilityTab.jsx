import { Bar } from 'react-chartjs-2'
import { colors, chartOpts, gridStyle, tickStyle } from './crossSystemConstants'

export default function ProfitabilityTab({ data, StatCard, EmptyState }) {
  if (!data) return <EmptyState msg="無利潤分析資料" />
  const { byProduct, byCustomer, summary } = data

  const topProducts = byProduct.slice(0, 10)
  const productChart = {
    labels: topProducts.map(p => p.name?.slice(0, 12) || p.code),
    datasets: [
      { label: '營收', data: topProducts.map(p => p.revenue), backgroundColor: colors.cyan + '99', borderColor: colors.cyan, borderWidth: 1 },
      { label: '成本', data: topProducts.map(p => p.cogs), backgroundColor: colors.red + '99', borderColor: colors.red, borderWidth: 1 },
    ]
  }

  const marginChart = {
    labels: topProducts.map(p => p.name?.slice(0, 12) || p.code),
    datasets: [{
      label: '毛利率 %',
      data: topProducts.map(p => p.margin),
      backgroundColor: topProducts.map(p => p.margin >= 30 ? colors.green + '99' : p.margin >= 15 ? colors.yellow + '99' : colors.red + '99'),
      borderColor: topProducts.map(p => p.margin >= 30 ? colors.green : p.margin >= 15 ? colors.yellow : colors.red),
      borderWidth: 1,
    }]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard label="總營收" value={`NT$ ${summary.totalRevenue.toLocaleString()}`} color="cyan" />
        <StatCard label="總成本" value={`NT$ ${summary.totalCogs.toLocaleString()}`} color="red" />
        <StatCard label="毛利" value={`NT$ ${summary.grossProfit.toLocaleString()}`} color="green" />
        <StatCard label="毛利率" value={`${summary.margin}%`} color="blue" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>Top 10 產品 營收 vs 成本</h4>
          <div style={{ height: 300 }}>
            <Bar data={productChart} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>產品毛利率分布</h4>
          <div style={{ height: 300 }}>
            <Bar data={marginChart} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle, max: 100 } } }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>產品利潤明細</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>產品</th><th>銷量</th><th>營收</th><th>成本</th><th>毛利</th><th>毛利率</th></tr></thead>
              <tbody>
                {byProduct.slice(0, 15).map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{p.name || p.code}</td>
                    <td>{p.qty}</td>
                    <td>NT$ {p.revenue.toLocaleString()}</td>
                    <td>NT$ {p.cogs.toLocaleString()}</td>
                    <td style={{ color: p.grossProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>NT$ {p.grossProfit.toLocaleString()}</td>
                    <td><span className={`badge ${p.margin >= 30 ? 'badge-success' : p.margin >= 15 ? 'badge-warning' : 'badge-danger'}`}>{p.margin}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>客戶利潤排行</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>客戶</th><th>訂單數</th><th>營收</th><th>平均客單</th><th>回收率</th></tr></thead>
              <tbody>
                {byCustomer.slice(0, 15).map((c, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>{c.orders}</td>
                    <td>NT$ {c.revenue.toLocaleString()}</td>
                    <td>NT$ {c.avgOrderValue.toLocaleString()}</td>
                    <td><span className={`badge ${c.collectionRate >= 80 ? 'badge-success' : c.collectionRate >= 50 ? 'badge-warning' : 'badge-danger'}`}>{c.collectionRate}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
