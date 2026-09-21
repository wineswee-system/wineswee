import { Bar, Doughnut } from 'react-chartjs-2'
import { colors, chartOpts, gridStyle, tickStyle } from './crossSystemConstants'

export default function CycleTimeTab({ data, StatCard, EmptyState }) {
  if (!data) return <EmptyState msg="無流程效率資料" />
  const { cycleTime, tasks } = data

  const cycleChartData = {
    labels: ['訂單→出貨', '採購→入庫', '製令週期'],
    datasets: [{
      label: '平均天數',
      data: [cycleTime.orderToShip.avg, cycleTime.poToGR.avg, cycleTime.moCycle.avg],
      backgroundColor: [colors.cyan + '99', colors.orange + '99', colors.purple + '99'],
      borderColor: [colors.cyan, colors.orange, colors.purple],
      borderWidth: 1,
    }]
  }

  const taskDist = {
    labels: ['已完成', '進行中', '逾期'],
    datasets: [{
      data: [tasks.completed, tasks.total - tasks.completed - tasks.overdue, tasks.overdue],
      backgroundColor: [colors.green + 'cc', colors.blue + 'cc', colors.red + 'cc'],
      borderWidth: 0,
    }]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard label="訂單→出貨 (天)" value={`${cycleTime.orderToShip.avg} 天`} color="cyan" />
        <StatCard label="採購→入庫 (天)" value={`${cycleTime.poToGR.avg} 天`} color="orange" />
        <StatCard label="製令週期 (天)" value={`${cycleTime.moCycle.avg} 天`} color="purple" />
        <StatCard label="任務完成率" value={`${tasks.completionRate}%`} color="green" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>平均流程週期</h4>
          <div style={{ height: 300 }}>
            <Bar data={cycleChartData} options={{ ...chartOpts, indexAxis: 'y', scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>任務狀態</h4>
          <div style={{ height: 300, display: 'flex', justifyContent: 'center' }}>
            <Doughnut data={taskDist} options={{ ...chartOpts, cutout: '65%' }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>訂單→出貨明細 (近20筆)</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>客戶</th><th>天數</th></tr></thead>
              <tbody>
                {cycleTime.orderToShip.data.map((o, i) => (
                  <tr key={i}>
                    <td>{o.customer || `訂單 #${o.orderId}`}</td>
                    <td style={{ fontWeight: 600, color: o.days > 7 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{o.days} 天</td>
                  </tr>
                ))}
                {cycleTime.orderToShip.data.length === 0 && <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無資料</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>採購→入庫明細 (近20筆)</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>供應商</th><th>天數</th></tr></thead>
              <tbody>
                {cycleTime.poToGR.data.map((o, i) => (
                  <tr key={i}>
                    <td>{o.supplier || `PO #${o.poId}`}</td>
                    <td style={{ fontWeight: 600, color: o.days > 14 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{o.days} 天</td>
                  </tr>
                ))}
                {cycleTime.poToGR.data.length === 0 && <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無資料</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
