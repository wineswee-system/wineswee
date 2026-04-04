import { useState, useCallback } from 'react'
import { Monitor, Wifi, WifiOff, Activity, Thermometer, Gauge, AlertTriangle, CheckCircle, RefreshCw, Zap, Clock, Settings } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

const colors = { cyan: '#22d3ee', blue: '#3b82f6', purple: '#a78bfa', green: '#34d399', orange: '#fb923c', red: '#f87171', pink: '#f472b6', yellow: '#fbbf24' }
const chartOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11, weight: 600 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 } }, tooltip: { backgroundColor: 'rgba(15,23,55,0.95)', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: 'rgba(148,163,184,0.15)', borderWidth: 1, padding: 12, cornerRadius: 10 } } }

const STATUS_MAP = { running: { label: '運行中', icon: '🟢', color: colors.green }, stopped: { label: '停機', icon: '🔴', color: colors.red }, idle: { label: '待機', icon: '🟡', color: colors.yellow }, maintenance: { label: '維修中', icon: '🔧', color: colors.orange } }

const DEMO_EQUIPMENT = [
  { id: 'M01', name: 'CNC-01 立式加工中心', status: 'running', product: 'AL-7075 機殼', efficiency: 92, temp: 42, uptime: 7.3, oee: 88, speed: 4500 },
  { id: 'M02', name: '沖壓機-02', status: 'running', product: 'SUS304 支架', efficiency: 87, temp: 38, uptime: 6.8, oee: 82, speed: 120 },
  { id: 'M03', name: '射出機-03', status: 'running', product: 'PA66 外殼', efficiency: 95, temp: 195, uptime: 7.5, oee: 91, speed: 60 },
  { id: 'M04', name: 'CNC-04 車床', status: 'idle', product: '—', efficiency: 0, temp: 28, uptime: 3.2, oee: 65, speed: 0 },
  { id: 'M05', name: '雷射切割機-05', status: 'running', product: 'SPCC 面板', efficiency: 78, temp: 55, uptime: 5.1, oee: 74, speed: 8 },
  { id: 'M06', name: '焊接機器人-06', status: 'maintenance', product: '—', efficiency: 0, temp: 25, uptime: 0, oee: 70, speed: 0 },
  { id: 'M07', name: '表面處理線-07', status: 'running', product: '陽極處理批次 B-42', efficiency: 83, temp: 62, uptime: 6.0, oee: 79, speed: 30 },
  { id: 'M08', name: 'SMT 貼片機-08', status: 'stopped', product: '—', efficiency: 0, temp: 26, uptime: 1.5, oee: 58, speed: 0 },
]

const DEMO_ALERTS = [
  { id: 1, time: '14:32', level: 'warning', machine: '射出機-03', msg: '模具溫度偏高 (195°C)，接近上限 200°C' },
  { id: 2, time: '13:15', level: 'info', machine: 'CNC-01', msg: '刀具壽命剩餘 12%，建議安排更換' },
  { id: 3, time: '12:48', level: 'error', machine: 'SMT 貼片機-08', msg: '送料異常停機，等待人員排除' },
  { id: 4, time: '11:20', level: 'warning', machine: '雷射切割機-05', msg: '切割精度偏移 0.05mm，已自動補償' },
  { id: 5, time: '10:05', level: 'info', machine: '焊接機器人-06', msg: '排定預防性保養，預計 15:00 完成' },
  { id: 6, time: '09:30', level: 'success', machine: '沖壓機-02', msg: '換模完成，恢復正常生產' },
]

const HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00']
const HOURLY_OUTPUT = [120, 135, 128, 142, 80, 138, 145, 130]
const HOURLY_TARGET = [130, 130, 130, 130, 130, 130, 130, 130]

const alertLevelStyle = { error: { bg: 'rgba(248,113,113,0.12)', color: colors.red }, warning: { bg: 'rgba(251,191,36,0.12)', color: colors.yellow }, info: { bg: 'rgba(59,130,246,0.12)', color: colors.blue }, success: { bg: 'rgba(52,211,153,0.12)', color: colors.green } }

export default function ShopFloor() {
  const [equipment, setEquipment] = useState(DEMO_EQUIPMENT)
  const [alerts] = useState(DEMO_ALERTS)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const running = equipment.filter(e => e.status === 'running').length
  const stopped = equipment.filter(e => e.status === 'stopped').length
  const maint = equipment.filter(e => e.status === 'maintenance').length
  const todayOutput = HOURLY_OUTPUT.reduce((a, b) => a + b, 0)
  const avgYield = Math.round(equipment.filter(e => e.status === 'running').reduce((s, e) => s + e.efficiency, 0) / (running || 1))

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setTimeout(() => {
      setEquipment(prev => prev.map(e => e.status === 'running' ? { ...e, temp: e.temp + Math.round((Math.random() - 0.5) * 4), efficiency: Math.min(100, Math.max(60, e.efficiency + Math.round((Math.random() - 0.5) * 6))) } : e))
      setRefreshing(false)
    }, 600)
  }, [])

  const lineData = {
    labels: HOURS,
    datasets: [
      { label: '實際產量', data: HOURLY_OUTPUT, borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.1)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.cyan },
      { label: '目標產量', data: HOURLY_TARGET, borderColor: colors.orange, borderDash: [6, 4], tension: 0, pointRadius: 0, fill: false },
    ],
  }

  const oeeData = {
    labels: equipment.map(e => e.id),
    datasets: [{
      label: 'OEE %',
      data: equipment.map(e => e.oee),
      backgroundColor: equipment.map(e => e.oee >= 85 ? colors.green : e.oee >= 70 ? colors.yellow : colors.red),
      borderRadius: 6,
      barThickness: 28,
    }],
  }
  const oeeOpts = { ...chartOpts, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { min: 0, max: 100, ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: 'rgba(148,163,184,0.08)' } } } }

  const tempData = {
    labels: equipment.map(e => e.id),
    datasets: [{
      label: '溫度 (°C)',
      data: equipment.map(e => e.temp),
      backgroundColor: equipment.map(e => e.temp >= 150 ? colors.red : e.temp >= 50 ? colors.orange : colors.blue),
      borderRadius: 6,
      barThickness: 28,
    }],
  }
  const tempOpts = { ...chartOpts, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { min: 0, ticks: { color: '#94a3b8', callback: v => v + '°C' }, grid: { color: 'rgba(148,163,184,0.08)' } } } }

  const kpis = [
    { label: '設備總數', value: equipment.length, icon: Monitor, color: colors.blue },
    { label: '運行中', value: running, icon: CheckCircle, color: colors.green },
    { label: '停機中', value: stopped, icon: WifiOff, color: colors.red },
    { label: '待修', value: maint, icon: Settings, color: colors.orange },
    { label: '今日產量', value: todayOutput.toLocaleString(), icon: Zap, color: colors.cyan },
    { label: '良率', value: avgYield + '%', icon: Gauge, color: colors.purple },
  ]

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>🏭 生產現場監控</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} />
            {autoRefresh ? <Wifi size={14} /> : <WifiOff size={14} />} 自動更新
          </label>
          <button className="btn btn-primary" onClick={handleRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> 重新整理
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {kpis.map(k => (
          <div className="stat-card" key={k.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>{k.label}</span>
              <k.icon size={18} style={{ color: k.color }} />
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Equipment Status Grid */}
      <h3 style={{ margin: '24px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Activity size={18} /> 設備即時狀態</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {equipment.map(eq => {
          const st = STATUS_MAP[eq.status]
          const expanded = expandedId === eq.id
          return (
            <div className="card" key={eq.id} style={{ cursor: 'pointer', border: expanded ? `1px solid ${st.color}` : undefined, transition: 'border 0.2s' }} onClick={() => setExpandedId(expanded ? null : eq.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>{eq.name}</strong>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 8, background: `${st.color}22`, color: st.color }}>{st.icon} {st.label}</span>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>生產項目：{eq.product}</div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>
                  <span>效率</span><span>{eq.efficiency}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(148,163,184,0.12)' }}>
                  <div style={{ height: '100%', borderRadius: 3, width: `${eq.efficiency}%`, background: eq.efficiency >= 85 ? colors.green : eq.efficiency >= 60 ? colors.yellow : colors.red, transition: 'width 0.4s' }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                <span><Thermometer size={12} style={{ verticalAlign: -2 }} /> {eq.temp}°C</span>
                <span><Clock size={12} style={{ verticalAlign: -2 }} /> {eq.uptime}h</span>
              </div>
              {expanded && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(148,163,184,0.12)', fontSize: 12, color: '#94a3b8' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>OEE：<strong style={{ color: '#f1f5f9' }}>{eq.oee}%</strong></div>
                    <div>轉速/速度：<strong style={{ color: '#f1f5f9' }}>{eq.speed || '—'}</strong></div>
                    <div>設備編號：<strong style={{ color: '#f1f5f9' }}>{eq.id}</strong></div>
                    <div>運行時數：<strong style={{ color: '#f1f5f9' }}>{eq.uptime} 小時</strong></div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div className="card-header"><h3 className="card-title">📈 今日產線產量趨勢</h3></div>
          <div style={{ height: 280 }}><Line data={lineData} options={{ ...chartOpts, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.08)' } } } }} /></div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">📊 設備 OEE 比較</h3></div>
          <div style={{ height: 280 }}><Bar data={oeeData} options={oeeOpts} /></div>
        </div>
      </div>

      {/* Temperature + Alerts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div className="card-header"><h3 className="card-title">🌡️ 設備溫度監控</h3></div>
          <div style={{ height: 260 }}><Bar data={tempData} options={tempOpts} /></div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, display: 'flex', gap: 16 }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colors.blue, marginRight: 4, verticalAlign: -1 }} />正常 (&lt;50°C)</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colors.orange, marginRight: 4, verticalAlign: -1 }} />偏高 (50-150°C)</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colors.red, marginRight: 4, verticalAlign: -1 }} />警告 (&gt;150°C)</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title"><AlertTriangle size={16} style={{ verticalAlign: -2, marginRight: 6 }} />即時警報</h3></div>
          <div className="data-table-wrapper" style={{ maxHeight: 300 }}>
            <table className="data-table">
              <thead><tr><th>時間</th><th>設備</th><th>訊息</th></tr></thead>
              <tbody>
                {alerts.map(a => {
                  const s = alertLevelStyle[a.level]
                  return (
                    <tr key={a.id} style={{ background: s.bg }}>
                      <td style={{ whiteSpace: 'nowrap', color: s.color, fontWeight: 600 }}>{a.time}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{a.machine}</td>
                      <td style={{ fontSize: 12 }}>{a.msg}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
