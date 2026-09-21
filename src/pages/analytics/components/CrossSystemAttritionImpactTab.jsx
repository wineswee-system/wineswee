import { useEffect, useState } from 'react'
import { UserX, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { KpiCard, SectionHeader, EmptyState, DataTable, NT, NT_K, NUM } from './AnalyticsCommon'

// 第 8 個跨系統分析：離職員工資產追蹤
// 連結 employees (status=離職) × opportunities + tasks
export default function AttritionImpactTab() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_attrition_impact', { p_org_id: profile.organization_id })
      .then(({ data: res }) => setData(res))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>載入中…</div>
  if (!data) return <EmptyState />

  const items = data.items || []
  const totalOpps = items.reduce((s, i) => s + (i.open_opportunities || 0), 0)
  const totalValue = items.reduce((s, i) => s + Number(i.open_opp_value || 0), 0)
  const totalTasks = items.reduce((s, i) => s + (i.pending_tasks || 0), 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="離職員工待交接" value={NUM(items.length)}
          sub="近 12 月離職且名下還有事" accent="red" />
        <KpiCard label="待重分配商機數" value={NUM(totalOpps)} accent="orange" />
        <KpiCard label="待重分配商機金額" value={NT_K(totalValue)} accent="purple" />
        <KpiCard label="待重分配任務數" value={NUM(totalTasks)} accent="cyan" />
      </div>

      <SectionHeader icon={UserX} title="待交接清單（依風險排序）" accent="red" extra={
        <button className="btn btn-secondary" onClick={load} style={{ padding: '4px 10px', fontSize: 12 }}>
          <RefreshCw size={12} /> 重新載入
        </button>
      } />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={items}
          columns={[
            { key: 'name', label: '離職員工' },
            { key: 'dept', label: '原部門' },
            { key: 'terminated_at', label: '離職日期' },
            { key: 'open_opportunities', label: '未結商機', render: v => NUM(v) },
            { key: 'open_opp_value', label: '商機金額', render: v => NT(v) },
            { key: 'pending_tasks', label: '未結任務', render: v => NUM(v) },
          ]}
          emptyMsg="🎉 沒有離職員工有待交接的資產"
        />
      </div>

      {data.error === 'partial_data' && (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 8,
          background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)',
          color: 'var(--accent-orange)', fontSize: 12,
        }}>
          ⚠️ 部分資料表未啟用，分析結果可能不完整
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        💡 <b>用途</b>：員工離職後，HR 跟主管要把他名下的商機 / 任務重新指派給接手的人。
        這份清單告訴你「還有誰的事沒交接」，並按潛在影響金額排序。
      </div>
    </div>
  )
}
