// DashboardCharts — extracted from TeamDashboard.jsx
// 近 7 天出勤趨勢 (Line) + 部門人力分佈 (Bar) for the HR tab
import { useMemo } from 'react'
import { TrendingUp, Building2 } from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import { chartPalette, chartTextTokens } from '../../../lib/theme/tokens'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

const C = {
  cyan: 'var(--accent-cyan)',
  purple: 'var(--accent-purple)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  border: 'var(--border-medium)',
}

// Props:
//   last7Att: Array<{ label: string, normal: number, late: number, leave: number }>
//   deptCounts: Record<string, number>
export default function DashboardCharts({ last7Att, deptCounts }) {
  const chartC = useMemo(() => chartPalette(), [])
  const chartT = useMemo(() => chartTextTokens(), [])

  const chartOpts = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: chartT.tertiary, font: { size: 11, weight: 600 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 },
      },
      tooltip: {
        backgroundColor: chartT.card, titleColor: chartT.primary, bodyColor: chartT.secondary,
        borderColor: chartT.border, borderWidth: 1, padding: 10, cornerRadius: 8,
      },
    },
  }), [chartT])

  const chartGrid = useMemo(() => ({ color: chartT.border }), [chartT])
  const chartTick = useMemo(() => ({ color: chartT.tertiary, font: { size: 11 } }), [chartT])

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
      gap: 16,
    }} className="dash-two-col">
      {/* 近 7 天出勤趨勢 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={16} style={{ color: C.cyan }} /> 近 7 天出勤趨勢
        </h3>
        <div style={{ height: 220 }}>
          <Line
            data={{
              labels: last7Att.map(d => d.label),
              datasets: [
                {
                  label: '出勤', data: last7Att.map(d => d.normal),
                  borderColor: chartC.green, backgroundColor: `${chartC.green}20`,
                  fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: chartC.green, borderWidth: 2,
                },
                {
                  label: '請假', data: last7Att.map(d => d.leave || 0),
                  borderColor: chartC.cyan, backgroundColor: `${chartC.cyan}14`,
                  fill: false, tension: 0.35, pointRadius: 4, pointBackgroundColor: chartC.cyan, borderWidth: 2,
                },
                {
                  label: '遲到', data: last7Att.map(d => d.late),
                  borderColor: chartC.orange, backgroundColor: `${chartC.orange}14`,
                  fill: false, tension: 0.35, pointRadius: 4, pointBackgroundColor: chartC.orange, borderWidth: 2,
                },
              ],
            }}
            options={{
              ...chartOpts,
              scales: {
                x: { grid: { display: false }, ticks: chartTick },
                y: { beginAtZero: true, grid: chartGrid, ticks: { ...chartTick, stepSize: 1 } },
              },
            }}
          />
        </div>
      </div>

      {/* 部門人力分佈 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={16} style={{ color: C.purple }} /> 部門人力
        </h3>
        <div style={{ height: 220 }}>
          {Object.keys(deptCounts).length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: C.muted, fontSize: 13 }}>無資料</div>
          ) : (
            <Bar
              data={{
                labels: Object.keys(deptCounts),
                datasets: [{
                  data: Object.values(deptCounts),
                  backgroundColor: [chartC.cyan, chartC.blue, chartC.purple, chartC.green, chartC.orange, chartC.pink || chartC.red].map(c => `${c}cc`),
                  borderRadius: 6, barThickness: 24,
                }],
              }}
              options={{
                ...chartOpts,
                plugins: { ...chartOpts.plugins, legend: { display: false } },
                scales: {
                  x: { grid: { display: false }, ticks: chartTick },
                  y: { beginAtZero: true, grid: chartGrid, ticks: { ...chartTick, stepSize: 1 } },
                },
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
