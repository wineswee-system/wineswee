import { Doughnut, Radar } from 'react-chartjs-2'
import { colors, chartOpts, gridStyle, tickStyle } from './crossSystemConstants'

export default function SupplyRiskTab({ data, StatCard, EmptyState }) {
  if (!data) return <EmptyState msg="無供應鏈資料" />
  const { vendors, summary, lotsNearExpiry } = data

  const riskDist = {
    labels: ['高風險', '中風險', '低風險'],
    datasets: [{
      data: [summary.highRisk, summary.mediumRisk, summary.lowRisk],
      backgroundColor: [colors.red + 'cc', colors.yellow + 'cc', colors.green + 'cc'],
      borderWidth: 0,
    }]
  }

  const top10 = vendors.slice(0, 10)
  const radarData = {
    labels: top10.map(v => v.name?.slice(0, 8)),
    datasets: [{
      label: '風險分數',
      data: top10.map(v => v.riskScore),
      backgroundColor: colors.red + '33',
      borderColor: colors.red,
      borderWidth: 2,
      pointBackgroundColor: top10.map(v => v.riskLevel === 'high' ? colors.red : v.riskLevel === 'medium' ? colors.yellow : colors.green),
    }]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <StatCard label="供應商總數" value={summary.totalVendors} color="blue" />
        <StatCard label="高風險" value={summary.highRisk} color="red" />
        <StatCard label="中風險" value={summary.mediumRisk} color="orange" />
        <StatCard label="低風險" value={summary.lowRisk} color="green" />
        <StatCard label="即期批號" value={lotsNearExpiry} color="yellow" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>風險分布</h4>
          <div style={{ height: 280, display: 'flex', justifyContent: 'center' }}>
            <Doughnut data={riskDist} options={{ ...chartOpts, cutout: '65%' }} />
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>Top 10 供應商風險雷達</h4>
          <div style={{ height: 280 }}>
            <Radar data={radarData} options={{
              ...chartOpts,
              scales: { r: { beginAtZero: true, max: 100, grid: gridStyle, ticks: { ...tickStyle, stepSize: 25 }, pointLabels: tickStyle } },
            }} />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>供應商風險明細</h4>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>供應商</th><th>交貨分數</th><th>品質分數</th><th>QC 不合格</th><th>風險分數</th><th>風險等級</th></tr></thead>
            <tbody>
              {vendors.map((v, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{v.name}</td>
                  <td>{v.deliveryScore}</td>
                  <td>{v.qualityScore}</td>
                  <td>{v.qcFailures}</td>
                  <td style={{ fontWeight: 700 }}>{v.riskScore}</td>
                  <td><span className={`badge ${v.riskLevel === 'high' ? 'badge-danger' : v.riskLevel === 'medium' ? 'badge-warning' : 'badge-success'}`}>
                    <span className="badge-dot"></span>{v.riskLevel === 'high' ? '高' : v.riskLevel === 'medium' ? '中' : '低'}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
