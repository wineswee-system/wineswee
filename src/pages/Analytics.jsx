import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, Minus, Download, RefreshCw,
  DollarSign, Users, AlertCircle, Activity, ArrowRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from '../components/LoadingSpinner'
import { exportToCSV } from '../lib/exportUtils'

// ════════════════════════════════════════════════════════════════
// 老闆首頁 — 4 區塊：今日營運 / 本月財務 / 人力健康 / 要處理的事
// 一支 RPC fn_dashboard_overview 全部聚合好回 JSON，前端只做渲染
// ════════════════════════════════════════════════════════════════

const NT = (n) => `NT$ ${Math.round(Number(n) || 0).toLocaleString()}`
const NT_K = (n) => {
  const v = Math.round(Number(n) || 0)
  if (v >= 1_000_000) return `NT$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `NT$${(v / 1_000).toFixed(0)}K`
  return `NT$${v}`
}
const PCT = (n) => `${(Number(n) || 0).toFixed(1)}%`

// 相對比較箭頭 + 顏色
function TrendBadge({ current, baseline, suffix = '', invert = false }) {
  if (!baseline || baseline === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>無上期資料</span>
  }
  const diff = current - baseline
  const pct = (diff / Math.abs(baseline)) * 100
  const isUp = diff > 0
  // invert=true：例如 AR 餘額越低越好，上升=紅
  const good = invert ? !isUp : isUp
  const color = Math.abs(pct) < 0.5 ? 'var(--text-muted)'
                : good ? 'var(--accent-green)' : 'var(--accent-red)'
  const Icon = Math.abs(pct) < 0.5 ? Minus : (isUp ? TrendingUp : TrendingDown)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color, fontWeight: 600 }}>
      <Icon size={12} />
      {Math.abs(pct).toFixed(1)}%{suffix}
    </span>
  )
}

function KpiCard({ label, value, sub, baselineLabel, current, baseline, invert, accent = 'cyan', onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12, padding: 16,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        borderLeft: `3px solid var(--accent-${accent})`,
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.borderColor = `var(--accent-${accent})` }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {baseline !== undefined && current !== undefined && (
          <TrendBadge current={current} baseline={baseline} invert={invert} />
        )}
        {sub && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>}
        {baselineLabel && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>vs {baselineLabel}</span>}
      </div>
    </div>
  )
}

function SectionHeader({ icon: Icon, title, accent = 'cyan' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 20 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: `var(--accent-${accent}-dim)`, color: `var(--accent-${accent})`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} />
      </div>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
    </div>
  )
}

function TodoRow({ count, label, sub, accent, onClick }) {
  if (!count || count === 0) return null
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 8,
        background: `var(--accent-${accent}-dim)`,
        border: `1px solid var(--accent-${accent})`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{
        fontSize: 22, fontWeight: 800, color: `var(--accent-${accent})`,
        minWidth: 50, textAlign: 'center',
      }}>{count}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      {onClick && <ArrowRight size={16} style={{ color: `var(--accent-${accent})` }} />}
    </div>
  )
}

export default function Analytics() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_dashboard_overview', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) { setError(error.message); return }
        setData(res)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  const exportKpi = () => {
    if (!data) return
    const rows = [
      { 區塊: '今日營運', 指標: '營收', 數值: data.today_ops.revenue.today, 上期: data.today_ops.revenue.yesterday },
      { 區塊: '今日營運', 指標: '訂單數', 數值: data.today_ops.orders.today, 上期: data.today_ops.orders.yesterday },
      { 區塊: '今日營運', 指標: '平均客單', 數值: data.today_ops.avg_ticket.today, 上期: data.today_ops.avg_ticket.yesterday },
      { 區塊: '本月財務', 指標: 'AR 餘額', 數值: data.month_finance.ar_balance },
      { 區塊: '本月財務', 指標: 'AP 餘額', 數值: data.month_finance.ap_balance },
      { 區塊: '本月財務', 指標: '本月毛利率', 數值: data.month_finance.margin_pct + '%', 上期: data.month_finance.last_month_margin_pct + '%' },
      { 區塊: '人力健康', 指標: '在職人數', 數值: data.hr_health.active_count },
      { 區塊: '人力健康', 指標: '本月離職', 數值: data.hr_health.term_this_month },
      { 區塊: '人力健康', 指標: '出勤率', 數值: data.hr_health.attendance_rate_today + '%' },
      { 區塊: '人力健康', 指標: '加班總時數', 數值: data.hr_health.month_ot_hours },
      { 區塊: '要處理', 指標: '逾期 AR 筆數', 數值: data.todos.ar_overdue.count },
      { 區塊: '要處理', 指標: '低庫存 SKU', 數值: data.todos.low_stock_count },
      { 區塊: '要處理', 指標: '簽核卡關 > 3 天', 數值: data.todos.stuck_tasks_count },
      { 區塊: '要處理', 指標: '合約 30 天內到期', 數值: data.todos.expiring_contracts_30d },
    ]
    const cols = [{ key: '區塊', label: '區塊' }, { key: '指標', label: '指標' }, { key: '數值', label: '數值' }, { key: '上期', label: '上期' }]
    exportToCSV(rows, cols, `老闆首頁_${data.today}`)
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>載入失敗：{error}</h3>
      <button className="btn btn-primary" onClick={load} style={{ marginTop: 16 }}>重試</button>
    </div>
  )
  if (!data) return <LoadingSpinner />

  const t = data.today_ops
  const f = data.month_finance
  const h = data.hr_health
  const todos = data.todos

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">📊</span> 營運總覽</h2>
            <p>今日 {data.today} · 一頁掃完公司健康度</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} /> 重新載入
          </button>
          <button className="btn btn-primary" onClick={exportKpi} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={14} /> 匯出 CSV
          </button>
        </div>
      </div>

      {/* ─── 區塊 1: 今日營運 ────────────────────────────────────── */}
      <SectionHeader icon={Activity} title="🎯 今日營運" accent="cyan" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard
          label="今日營收"
          value={NT_K(t.revenue.today)}
          current={t.revenue.today}
          baseline={t.revenue.yesterday}
          baselineLabel="昨日"
          accent="cyan"
          onClick={() => navigate('/pos')}
        />
        <KpiCard
          label="今日訂單數"
          value={t.orders.today}
          current={t.orders.today}
          baseline={t.orders.yesterday}
          baselineLabel="昨日"
          accent="blue"
        />
        <KpiCard
          label="平均客單"
          value={NT(t.avg_ticket.today)}
          current={t.avg_ticket.today}
          baseline={t.avg_ticket.yesterday}
          baselineLabel="昨日"
          accent="purple"
        />
        <KpiCard
          label="vs 上週同日"
          value={NT_K(t.revenue.today)}
          current={t.revenue.today}
          baseline={t.revenue.last_week_same}
          baselineLabel="上週同日"
          accent="green"
        />
      </div>

      {/* ─── 區塊 2: 本月財務 ────────────────────────────────────── */}
      <SectionHeader icon={DollarSign} title="💰 本月財務" accent="green" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard
          label="應收餘額"
          value={NT_K(f.ar_balance)}
          sub={`逾期 ${todos.ar_overdue.count} 筆`}
          accent="orange"
          onClick={() => navigate('/finance')}
        />
        <KpiCard
          label="應付餘額"
          value={NT_K(f.ap_balance)}
          accent="red"
          onClick={() => navigate('/finance/ap')}
        />
        <KpiCard
          label="本月毛利率"
          value={PCT(f.margin_pct)}
          current={f.margin_pct}
          baseline={f.last_month_margin_pct}
          baselineLabel="上月"
          accent="green"
        />
        <KpiCard
          label="本月營收"
          value={NT_K(f.revenue)}
          current={f.revenue}
          baseline={f.last_month_revenue}
          baselineLabel="上月"
          accent="cyan"
        />
      </div>

      {/* ─── 區塊 3: 人力健康度 ──────────────────────────────────── */}
      <SectionHeader icon={Users} title="👥 人力健康度" accent="purple" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard
          label="在職人數"
          value={h.active_count}
          sub={`本月離職 ${h.term_this_month} 人 (${PCT(h.term_rate_pct)})`}
          accent="purple"
          onClick={() => navigate('/hr')}
        />
        <KpiCard
          label="今日出勤率"
          value={PCT(h.attendance_rate_today)}
          sub={`${h.today_attend_count} / ${h.should_attend_count} 人`}
          accent={h.attendance_rate_today >= 90 ? 'green' : 'orange'}
        />
        <KpiCard
          label="本月加班時數"
          value={`${h.month_ot_hours} 小時`}
          sub={h.active_count > 0 ? `人均 ${(h.month_ot_hours / h.active_count).toFixed(1)} h` : ''}
          accent={h.month_ot_hours > 46 * h.active_count ? 'red' : 'cyan'}
        />
        <KpiCard
          label="離職率"
          value={PCT(h.term_rate_pct)}
          sub={`本月 ${h.term_this_month} 人離職`}
          accent={h.term_rate_pct > 5 ? 'red' : 'green'}
        />
      </div>

      {/* ─── 區塊 4: 要處理的事 ──────────────────────────────────── */}
      <SectionHeader icon={AlertCircle} title="⚠️ 要處理的事" accent="red" />
      <div style={{ display: 'grid', gap: 8 }}>
        <TodoRow
          count={todos.ar_overdue.count}
          accent="red"
          label={`逾期應收：${todos.ar_overdue.count} 筆，總額 ${NT_K(todos.ar_overdue.amount)}`}
          sub="點擊查看帳齡分析 + 催收清單"
          onClick={() => navigate('/finance')}
        />
        <TodoRow
          count={todos.low_stock_count}
          accent="orange"
          label={`低庫存 SKU：${todos.low_stock_count} 個品項已低於安全庫存`}
          sub="點擊查看補貨建議"
          onClick={() => navigate('/wms')}
        />
        <TodoRow
          count={todos.stuck_tasks_count}
          accent="orange"
          label={`簽核卡關 > 3 天：${todos.stuck_tasks_count} 件`}
          sub="點擊查看簽核中心"
          onClick={() => navigate('/approval-center')}
        />
        <TodoRow
          count={todos.expiring_contracts_30d}
          accent="cyan"
          label={`合約 30 天內到期：${todos.expiring_contracts_30d} 份`}
          sub="點擊查看員工合約管理"
          onClick={() => navigate('/hr/contracts')}
        />
        {todos.doc_expiring_30d > 0 && (
          <TodoRow
            count={todos.doc_expiring_30d}
            accent="cyan"
            label={`移工證件 30 天內到期：${todos.doc_expiring_30d} 份`}
            sub="點擊查看外籍員工管理"
            onClick={() => navigate('/hr/foreign-workers')}
          />
        )}
        {todos.ar_overdue.count === 0 && todos.low_stock_count === 0
          && todos.stuck_tasks_count === 0 && todos.expiring_contracts_30d === 0 && (
          <div style={{
            padding: 24, borderRadius: 12, background: 'var(--accent-green-dim)',
            border: '1px solid var(--accent-green)', textAlign: 'center',
            color: 'var(--accent-green)', fontWeight: 700,
          }}>
            🎉 目前沒有待處理事項
          </div>
        )}
      </div>

      {/* 入口列：跳到更深的分析 */}
      <SectionHeader icon={ArrowRight} title="🔍 深入分析" accent="cyan" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: '預警中心', path: '/analytics/alerts', accent: 'red', desc: '完整預警清單' },
          { label: '財務分析', path: '/analytics/finance', accent: 'green', desc: 'AR/AP/毛利/預算' },
          { label: '人資分析', path: '/analytics/hr', accent: 'purple', desc: '出勤/薪資/離職' },
          { label: '跨系統分析', path: '/analytics/cross-system', accent: 'cyan', desc: '7 種跨域洞見' },
        ].map(item => (
          <div key={item.path}
            onClick={() => navigate(item.path)}
            style={{
              padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderLeft: `3px solid var(--accent-${item.accent})`,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{item.label} →</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{item.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
