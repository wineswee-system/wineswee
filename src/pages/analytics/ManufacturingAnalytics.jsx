import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, ListChecks, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { KpiCard, SectionHeader, EmptyState, DataTable, NUM, PCT } from './components/AnalyticsCommon'

export default function ManufacturingAnalytics() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_manufacturing_analytics', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) setError(error.message); else setData(res)
      }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>
  if (!data) return <LoadingSpinner />

  const orders = data.orders_90d || {}
  const quality = data.quality || {}

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">🏭</span> 製造分析</h2>
            <p>生產達成率 · 不良率 · 製造單追蹤</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="近 90 天製造單" value={NUM(orders.total)} accent="cyan" />
        <KpiCard label="已完成" value={NUM(orders.completed)} accent="green" />
        <KpiCard label="生產中" value={NUM(orders.in_progress)} accent="orange" />
        <KpiCard label="達成率" value={PCT(orders.completion_pct)}
          accent={orders.completion_pct >= 80 ? 'green' : 'orange'} />
      </div>

      <SectionHeader icon={CheckCircle2} title="品質檢驗（近 90 天）" accent="green" />
      <div className="card" style={{ padding: 16 }}>
        {quality.unavailable ? <EmptyState msg="quality_inspections 表未啟用" /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>檢驗總量</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{NUM(quality.total_inspected)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>不良數</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-red)' }}>
                {NUM(quality.total_defects)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>不良率</div>
              <div style={{ fontSize: 24, fontWeight: 800,
                color: (quality.defect_rate_pct || 0) > 5 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                {PCT(quality.defect_rate_pct, 2)}
              </div>
            </div>
          </div>
        )}
      </div>

      <SectionHeader icon={ListChecks} title="近期製造單（最新 10 張）" accent="cyan" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.recent_orders || []}
          columns={[
            { key: 'mo_number', label: 'MO 編號' },
            { key: 'product', label: '產品' },
            { key: 'planned_qty', label: '計劃', render: v => NUM(v) },
            { key: 'actual_qty', label: '實際', render: v => NUM(v || 0) },
            { key: 'status', label: '狀態' },
            { key: 'created_at', label: '建立日期' },
          ]}
          emptyMsg="manufacturing_orders 表未啟用 或 無資料"
        />
      </div>

      <SectionHeader icon={AlertTriangle} title="尚待補資料" accent="purple" />
      <div className="card" style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
        以下指標需要採集相應資料源才能顯示：
        <ul style={{ paddingLeft: 16, marginTop: 8 }}>
          <li><b>設備稼動率 (OEE)</b>：需 equipment + machine_logs 表（目前未啟用）</li>
          <li><b>物料齊套率</b>：需 BOM × 即時庫存交叉比對的視圖</li>
          <li><b>單位人力產值</b>：需 manufacturing_orders + 工時打卡關聯</li>
          <li><b>不良原因分類</b>：需 quality_inspections.defect_category 欄位</li>
        </ul>
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
