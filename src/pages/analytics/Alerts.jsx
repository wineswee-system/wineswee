import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, AlertCircle, Info, TrendingUp, RefreshCw,
  ArrowRight, CheckCircle2, DollarSign, Package, GitBranch, Users, BarChart3,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

// ════════════════════════════════════════════════════════════════
// 預警中心 — 老闆每天早上開的那頁
// 4 級分類：critical(紅) / warning(橘) / info(黃) / forecast(藍)
// 全部走 fn_compute_alerts 一支 RPC，前端只渲染
// ════════════════════════════════════════════════════════════════

const SEVERITY_CONFIG = {
  critical: {
    label: '🔴 立即處理',
    accent: 'red',
    icon: AlertTriangle,
    desc: '今天就要處理，否則會直接影響營運',
  },
  warning: {
    label: '🟠 本週留意',
    accent: 'orange',
    icon: AlertCircle,
    desc: '本週內排程處理，避免變成緊急事件',
  },
  info: {
    label: '🟡 趨勢警示',
    accent: 'cyan',
    icon: Info,
    desc: '數據異常或趨勢轉變，建議深入了解',
  },
  forecast: {
    label: '🔮 預測警示',
    accent: 'blue',
    icon: TrendingUp,
    desc: '未來 7 天內預計會發生的事',
  },
}

const CATEGORY_ICON = {
  finance: DollarSign,
  inventory: Package,
  process: GitBranch,
  hr: Users,
  forecast: BarChart3,
}

const CATEGORY_LABEL = {
  finance: '財務',
  inventory: '庫存',
  process: '流程',
  hr: '人資',
  forecast: '預測',
}

export default function Alerts() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all') // all / critical / warning / info / forecast

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    setError(null)
    supabase.rpc('fn_compute_alerts', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) { setError(error.message); return }
        setData(res)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>載入失敗：{error}</h3>
      <button className="btn btn-primary" onClick={load} style={{ marginTop: 16 }}>重試</button>
    </div>
  )
  if (!data) return <LoadingSpinner />

  const alerts = data.alerts || []
  const counts = data.counts || { critical: 0, warning: 0, info: 0, forecast: 0, total: 0 }
  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.severity === filter)

  // 按 severity 分組
  const grouped = ['critical', 'warning', 'info', 'forecast'].reduce((acc, sev) => {
    acc[sev] = filtered.filter(a => a.severity === sev)
    return acc
  }, {})

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">⚠️</span> 預警中心</h2>
            <p>共 {counts.total} 項事件需要關注 · {data.today}</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} /> 重新載入
          </button>
        </div>
      </div>

      {/* 4 級數量 summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        <SummaryChip label="全部" count={counts.total} accent="cyan"
          active={filter === 'all'} onClick={() => setFilter('all')} />
        {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
          <SummaryChip key={key} label={cfg.label} count={counts[key]} accent={cfg.accent}
            active={filter === key} onClick={() => setFilter(key)} />
        ))}
      </div>

      {/* 空狀態 */}
      {counts.total === 0 && (
        <div style={{
          padding: 48, borderRadius: 16, background: 'var(--accent-green-dim)',
          border: '1px solid var(--accent-green)', textAlign: 'center',
        }}>
          <CheckCircle2 size={48} style={{ color: 'var(--accent-green)' }} />
          <h3 style={{ marginTop: 16, color: 'var(--accent-green)' }}>太好了！目前沒有任何預警事件</h3>
          <p style={{ color: 'var(--text-secondary)' }}>公司運作健康，繼續加油 🎉</p>
        </div>
      )}

      {data.error === 'partial_data' && (
        <div style={{
          padding: 14, borderRadius: 10, marginBottom: 16,
          background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)',
          color: 'var(--accent-orange)', fontSize: 13,
        }}>
          ⚠️ 部分資料來源尚未建立（例如庫存異動表），預警可能不完整
        </div>
      )}

      {/* 4 級分組顯示 */}
      {['critical', 'warning', 'info', 'forecast'].map(sev => {
        const cfg = SEVERITY_CONFIG[sev]
        const items = grouped[sev]
        if (!items || items.length === 0) return null
        const Icon = cfg.icon
        return (
          <div key={sev} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: `var(--accent-${cfg.accent}-dim)`, color: `var(--accent-${cfg.accent})`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={18} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {cfg.label}（{items.length}）
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cfg.desc}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {items.map((alert, idx) => (
                <AlertCard key={`${sev}_${idx}`} alert={alert} navigate={navigate} />
              ))}
            </div>
          </div>
        )
      })}

      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}

function SummaryChip({ label, count, accent, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
        background: active ? `var(--accent-${accent}-dim)` : 'var(--bg-card)',
        border: active ? `1px solid var(--accent-${accent})` : '1px solid var(--border-subtle)',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: count > 0 ? `var(--accent-${accent})` : 'var(--text-muted)' }}>
        {count}
      </div>
    </div>
  )
}

function AlertCard({ alert, navigate }) {
  const sev = SEVERITY_CONFIG[alert.severity]
  const CatIcon = CATEGORY_ICON[alert.category] || Info
  return (
    <div
      onClick={() => alert.link && navigate(alert.link)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px', borderRadius: 10,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderLeft: `4px solid var(--accent-${sev.accent})`,
        cursor: alert.link ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => { if (alert.link) e.currentTarget.style.borderLeftWidth = '6px' }}
      onMouseLeave={(e) => { if (alert.link) e.currentTarget.style.borderLeftWidth = '4px' }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 8,
        background: `var(--accent-${sev.accent}-dim)`, color: `var(--accent-${sev.accent})`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <CatIcon size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{alert.title}</span>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 10,
            background: `var(--accent-${sev.accent}-dim)`, color: `var(--accent-${sev.accent})`,
            fontWeight: 700,
          }}>{CATEGORY_LABEL[alert.category] || alert.category}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{alert.detail}</div>
      </div>
      {alert.link && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          color: `var(--accent-${sev.accent})`, fontSize: 12, fontWeight: 700,
        }}>
          處理 <ArrowRight size={14} />
        </div>
      )}
    </div>
  )
}
