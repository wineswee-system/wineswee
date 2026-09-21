import { useEffect, useState } from 'react'
import { Users, TrendingUp, Clock, GraduationCap, UserX, RefreshCw } from 'lucide-react'
import { Bar, Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend, Filler } from 'chart.js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { KpiCard, SectionHeader, BarRow, EmptyState, DataTable, NUM, PCT } from './components/AnalyticsCommon'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend, Filler)

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
    tooltip: { backgroundColor: 'rgba(15,23,55,0.95)' },
  },
}

export default function HRAnalytics() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_hr_analytics', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) setError(error.message)
        else setData(res)
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>
  if (!data) return <LoadingSpinner />

  const maxStruct = Math.max(...(data.structure_by_dept || []).map(s => s.count), 1)
  const trend = data.salary_trend || []
  const salaryChart = {
    labels: trend.map(t => t.month.slice(5) + '月'),
    datasets: [
      { label: '薪資總額', data: trend.map(t => t.total),
        borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.1)',
        fill: true, tension: 0.4, pointRadius: 3 },
    ],
  }
  const attrition = data.attrition?.by_month || []
  const attritionChart = {
    labels: attrition.map(a => a.month.slice(5) + '月'),
    datasets: [{ label: '離職人數', data: attrition.map(a => a.count), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 }],
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">👥</span> 人資分析</h2>
            <p>員工結構 · 薪資 · 出勤 · 離職 · 加班 · 培訓</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="在職人數" value={NUM(data.active_count)} accent="cyan" />
        <KpiCard label="今年離職率" value={PCT(data.attrition?.rate_pct)}
          sub={`累計 ${data.attrition?.ytd_terms || 0} 人`}
          accent={data.attrition?.rate_pct > 10 ? 'red' : 'green'} />
        <KpiCard label="本月加班時數" value={`${data.overtime?.this_month_total_hours || 0} h`}
          sub={`人均 ${data.overtime?.per_employee_avg || 0} h`}
          accent={data.overtime?.per_employee_avg > 46 ? 'red' : 'cyan'} />
        <KpiCard label="人均培訓堂數" value={`${data.training?.avg_per_employee || 0} 堂/年`}
          sub={data.training?.unavailable ? '培訓表未啟用' : `今年完成 ${data.training?.completed_this_year || 0} 堂`}
          accent="purple" />
      </div>

      <SectionHeader icon={Users} title="員工結構（依部門）" accent="cyan" />
      <div className="card" style={{ padding: 16 }}>
        {(data.structure_by_dept || []).length === 0 ? <EmptyState /> :
          (data.structure_by_dept || []).map(s => (
            <BarRow key={s.dept} label={s.dept} value={s.count} max={maxStruct} accent="cyan" />
          ))
        }
      </div>

      <SectionHeader icon={TrendingUp} title="月薪資成本趨勢（近 12 月）" accent="green" />
      <div className="card" style={{ padding: 16 }}>
        {trend.length === 0 ? <EmptyState msg="無薪資資料" /> : (
          <div style={{ height: 240 }}>
            <Line data={salaryChart} options={{ ...chartOpts, scales: { x: { ticks: { color: '#94a3b8' } }, y: { beginAtZero: true, ticks: { color: '#94a3b8' } } } }} />
          </div>
        )}
      </div>

      <SectionHeader icon={Clock} title="本月出勤狀況（依部門）" accent="blue" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.attendance_by_dept || []}
          columns={[
            { key: 'dept', label: '部門' },
            { key: 'attendance_days', label: '出勤人日', render: v => NUM(v) },
            { key: 'absence_days', label: '缺勤', render: v => NUM(v) },
            { key: 'late_count', label: '遲到', render: v => NUM(v) },
          ]}
          emptyMsg="本月無出勤紀錄"
        />
      </div>

      <SectionHeader icon={UserX} title="離職趨勢（近 12 月）" accent="red" />
      <div className="card" style={{ padding: 16 }}>
        {attrition.length === 0 ? <EmptyState msg="無離職紀錄" /> : (
          <div style={{ height: 200 }}>
            <Bar data={attritionChart} options={{ ...chartOpts, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { beginAtZero: true, ticks: { color: '#94a3b8', stepSize: 1 } } } }} />
          </div>
        )}
      </div>

      <SectionHeader icon={Clock} title="加班時數 Top 5（本月，已核准）" accent="orange" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.overtime?.top_overtimers || []}
          columns={[
            { key: 'name', label: '員工' },
            { key: 'hours', label: '加班時數', render: v => `${v} h` },
          ]}
          emptyMsg="本月無加班"
        />
      </div>

      {data.training?.unavailable && (
        <SectionHeader icon={GraduationCap} title="培訓資料" accent="purple" extra={
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>training_enrollments 表未啟用，補完即顯示</span>
        } />
      )}

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
