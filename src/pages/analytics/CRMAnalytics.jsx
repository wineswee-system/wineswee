import { useEffect, useState } from 'react'
import { Users, Award, AlertTriangle, UserPlus, RefreshCw } from 'lucide-react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { KpiCard, SectionHeader, EmptyState, DataTable, NT, NT_K, NUM } from './components/AnalyticsCommon'

ChartJS.register(ArcElement, Tooltip, Legend)

const SEGMENT_COLOR = {
  'VIP': '#a78bfa',
  '常客': '#22d3ee',
  '一般': '#34d399',
  '流失風險': '#f87171',
}

export default function CRMAnalytics() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_crm_analytics', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) setError(error.message); else setData(res)
      }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>
  if (!data) return <LoadingSpinner />

  const rfm = data.rfm_segments || {}
  const segLabels = Object.keys(rfm)
  const segValues = Object.values(rfm)

  const rfmDoughnut = {
    labels: segLabels,
    datasets: [{
      data: segValues,
      backgroundColor: segLabels.map(l => SEGMENT_COLOR[l] || '#94a3b8'),
      borderWidth: 0,
    }],
  }

  const nvo = data.new_vs_old || {}
  const nvoTotal = (nvo.new_revenue || 0) + (nvo.old_revenue || 0)
  const newPct = nvoTotal > 0 ? (nvo.new_revenue / nvoTotal) * 100 : 0

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">🤝</span> CRM 分析</h2>
            <p>客戶分級 (RFM) · Top 貢獻 · 流失風險 · 新客 vs 老客</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="顧客總數" value={NUM(data.total_customers)}
          sub={`本月新增 ${data.new_this_month} 人`} accent="cyan" />
        <KpiCard label="VIP 顧客" value={NUM(rfm['VIP'] || 0)}
          sub="近 30 天活躍 + 高消費" accent="purple" />
        <KpiCard label="流失風險" value={NUM(data.churn_risk?.count || 0)}
          sub={`平均歷史消費 ${NT_K(data.churn_risk?.last_spent_avg || 0)}`}
          accent={data.churn_risk?.count > 0 ? 'red' : 'green'} />
        <KpiCard label="本月新客佔比" value={`${newPct.toFixed(1)}%`}
          sub={`新客 ${NT_K(nvo.new_revenue)} / 老客 ${NT_K(nvo.old_revenue)}`} accent="green" />
      </div>

      <SectionHeader icon={Users} title="客戶分級（RFM）" accent="purple" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          {segLabels.length === 0 ? <EmptyState msg="尚無會員消費資料" /> : (
            <div style={{ height: 240 }}>
              <Doughnut data={rfmDoughnut} options={{
                responsive: true, maintainAspectRatio: false, cutout: '55%',
                plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
              }} />
            </div>
          )}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-primary)' }}>分級規則</h4>
          <ul style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: 16 }}>
            <li><b style={{ color: SEGMENT_COLOR['VIP'] }}>VIP</b>：30 天內消費 + 12 月內 5 次以上 + 累計 10K+</li>
            <li><b style={{ color: SEGMENT_COLOR['常客'] }}>常客</b>：60 天內消費 + 12 月內 3 次以上</li>
            <li><b style={{ color: SEGMENT_COLOR['一般'] }}>一般</b>：90 天內消費</li>
            <li><b style={{ color: SEGMENT_COLOR['流失風險'] }}>流失風險</b>：90 天以上未消費</li>
          </ul>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            * 以 POS 交易 + member_id 為基準，僅含近 12 月資料
          </div>
        </div>
      </div>

      <SectionHeader icon={Award} title="Top 10 高貢獻顧客（近 12 月）" accent="green" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={data.top_value_customers || []}
          columns={[
            { key: 'member_id', label: '會員 ID' },
            { key: 'total_spent', label: '累計消費', render: v => NT(v) },
            { key: 'visit_count', label: '到訪次數', render: v => NUM(v) },
            { key: 'last_visit', label: '上次到訪' },
          ]}
          emptyMsg="尚無會員消費資料"
        />
      </div>

      <SectionHeader icon={AlertTriangle} title="流失風險顧客（>90 天未消費）" accent="red" />
      <div className="card" style={{ padding: 16 }}>
        {(data.churn_risk?.count || 0) === 0 ? (
          <EmptyState msg="目前沒有流失風險顧客 🎉" />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>流失風險顧客數</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent-red)' }}>{data.churn_risk.count}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>歷史平均消費</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{NT(data.churn_risk.last_spent_avg)}</div>
            </div>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
              💡 建議：用滴漏行銷或客製優惠喚回這群人
            </div>
          </div>
        )}
      </div>

      <SectionHeader icon={UserPlus} title="本月新客 vs 老客 營收占比" accent="cyan" />
      <div className="card" style={{ padding: 16 }}>
        {nvoTotal === 0 ? <EmptyState msg="本月無會員消費" /> : (
          <div>
            <div style={{ display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{
                width: `${newPct}%`, background: 'var(--accent-green)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12,
              }}>
                {newPct > 8 && `${newPct.toFixed(1)}%`}
              </div>
              <div style={{
                width: `${100 - newPct}%`, background: 'var(--accent-blue)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12,
              }}>
                {(100 - newPct) > 8 && `${(100 - newPct).toFixed(1)}%`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div>
                <span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--accent-green)', borderRadius: 2, marginRight: 6, verticalAlign: -1 }} />
                新客：{NT(nvo.new_revenue)}
              </div>
              <div>
                <span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--accent-blue)', borderRadius: 2, marginRight: 6, verticalAlign: -1 }} />
                老客：{NT(nvo.old_revenue)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
