import { useEffect, useState } from 'react'
import { GitBranch, Clock, AlertCircle, UserCheck, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { KpiCard, SectionHeader, DataTable, NUM, PCT } from './components/AnalyticsCommon'

export default function ProcessAnalytics() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!profile?.organization_id) return
    setLoading(true)
    supabase.rpc('fn_process_analytics', { p_org_id: profile.organization_id })
      .then(({ data: res, error }) => {
        if (error) setError(error.message); else setData(res)
      }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [profile?.organization_id]) // eslint-disable-line

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)' }}>{error}</div>
  if (!data) return <LoadingSpinner />

  const completion = data.task_completion_by_template || []
  const overall = completion.reduce((acc, c) => {
    acc.total += c.total; acc.done += c.done; return acc
  }, { total: 0, done: 0 })
  const overallPct = overall.total > 0 ? (overall.done / overall.total) * 100 : 0

  const overdue = data.overdue_tasks_top20 || []
  const speed = data.signoff_speed_by_type || []
  const rejection = data.rejection_rate_by_template || []
  const extras = data.extra_signers_by_type || []

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">⚙️</span> 流程效率分析</h2>
            <p>任務完成率 · 逾期任務 · 簽核耗時 · 退回率 · 加簽次數</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="近 90 天任務" value={NUM(overall.total)}
          sub={`已完成 ${overall.done}`} accent="cyan" />
        <KpiCard label="整體完成率" value={PCT(overallPct)}
          accent={overallPct >= 80 ? 'green' : 'orange'} />
        <KpiCard label="逾期任務" value={NUM(overdue.length)}
          accent={overdue.length > 0 ? 'red' : 'green'} />
        <KpiCard label="平均簽核耗時"
          value={speed.length > 0 ? `${(speed.reduce((s, x) => s + (x.avg_hours || 0), 0) / speed.length).toFixed(1)} h` : '-'}
          sub={`涵蓋 ${speed.length} 類表單`} accent="purple" />
      </div>

      <SectionHeader icon={GitBranch} title="任務完成率（依工作流模板）" accent="cyan" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={completion}
          columns={[
            { key: 'template', label: '模板' },
            { key: 'total', label: '總數', render: v => NUM(v) },
            { key: 'done', label: '已完成', render: v => NUM(v) },
            { key: 'completion_pct', label: '完成率', render: v => PCT(v) },
          ]}
          emptyMsg="近 90 天無工作流任務"
        />
      </div>

      <SectionHeader icon={AlertCircle} title="逾期任務 Top 20" accent="red" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={overdue}
          columns={[
            { key: 'title', label: '任務' },
            { key: 'assignee', label: '負責人' },
            { key: 'due_date', label: '原定截止日' },
            { key: 'days_overdue', label: '逾期', render: v => `${v} 天` },
            { key: 'status', label: '狀態' },
          ]}
          emptyMsg="無逾期任務 🎉"
        />
      </div>

      <SectionHeader icon={Clock} title="平均簽核耗時（依表單類型，近 90 天）" accent="orange" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={speed}
          columns={[
            { key: 'request_type', label: '表單類型' },
            { key: 'count', label: '已簽完件數', render: v => NUM(v) },
            { key: 'avg_hours', label: '平均時數', render: v => `${v} h` },
          ]}
          emptyMsg="approval_step_history 表未啟用 或 無紀錄"
        />
      </div>

      <SectionHeader icon={AlertCircle} title="表單退回率（依模板）" accent="orange" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={rejection}
          columns={[
            { key: 'template', label: '模板' },
            { key: 'total', label: '送出總數', render: v => NUM(v) },
            { key: 'rejected', label: '被退回', render: v => NUM(v) },
            { key: 'reject_pct', label: '退回率', render: v => PCT(v) },
          ]}
          emptyMsg="無 form_submission 資料"
        />
      </div>

      <SectionHeader icon={UserCheck} title="加簽次數排行（看哪些表單流程設計不良）" accent="purple" />
      <div className="card" style={{ padding: 16 }}>
        <DataTable
          rows={extras}
          columns={[
            { key: 'request_type', label: '表單類型' },
            { key: 'extra_step_count', label: '加簽次數', render: v => NUM(v) },
          ]}
          emptyMsg="無加簽紀錄"
        />
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        資料更新時間：{new Date(data.generated_at).toLocaleString('zh-TW')}
      </div>
    </div>
  )
}
