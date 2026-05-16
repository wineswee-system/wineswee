// DashboardAiChat — extracted from TeamDashboard.jsx
// Gemini AI 智慧洞察 section for the HR tab
import { useState, useCallback } from 'react'
import { Sparkles, Bot, RefreshCw } from 'lucide-react'
import { chat, isConfigured, clearSession } from '../../../lib/gemini'

const C = {
  purple: 'var(--accent-purple)',
  purpleDim: 'rgba(167,139,250,0.15)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  bg2: 'var(--bg-secondary)',
  border: 'var(--border-medium)',
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)

export default function DashboardAiChat({
  scopeStoreId,
  stores,
  kpi,
  monthLeaveDays,
  monthOtHours,
  monthTripCount,
  pendingUnified,
  alerts,
  activeWorkflows,
}) {
  const [aiInsight, setAiInsight] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  const fetchAiInsight = useCallback(async () => {
    if (!isConfigured()) return
    setAiLoading(true)
    try {
      clearSession('team-dashboard')
      const summary = {
        scope: scopeStoreId ? `門市 ${stores.find(s => s.id === scopeStoreId)?.name || scopeStoreId}` : '全公司',
        team: { total: kpi.total, presentToday: kpi.presentCount, attendRate: kpi.attendRate + '%' },
        today: { onLeave: kpi.leaveCount, ot: kpi.otCount, trip: kpi.tripCount, unclocked: kpi.lateCount },
        month: { leaveDays: monthLeaveDays, otHours: monthOtHours, tripCount: monthTripCount },
        approvals: {
          pending: kpi.pendingCount,
          avgPendingDays: kpi.avgPendingDays,
          overdueCount: pendingUnified.filter(p => p.daysOpen >= 3).length,
        },
        alerts: alerts.length,
        workflowsActive: activeWorkflows.length,
        workflowsStuck: activeWorkflows.filter(w => w.started_at && daysBetween(todayStr(), w.started_at.slice(0, 10)) >= 3).length,
      }
      const result = await chat(
        `你是 HR / 流程主管的助理。以下是 ${summary.scope} 今日的營運摘要 JSON，請給 3-5 條觀察與建議，每條 30 字內，用條列「•」開頭。\n${JSON.stringify(summary, null, 2)}`,
        'team-dashboard'
      )
      setAiInsight(result)
    } catch (e) {
      setAiInsight(`AI 分析失敗：${e.message}`)
    } finally {
      setAiLoading(false)
    }
  }, [scopeStoreId, stores, kpi, monthLeaveDays, monthOtHours, monthTripCount,
      pendingUnified, alerts, activeWorkflows])

  if (!isConfigured()) return null

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} style={{ color: C.purple }} /> AI 智慧洞察
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, background: C.purpleDim, padding: '2px 6px', borderRadius: 4 }}>
            Gemini
          </span>
        </h3>
        <button
          onClick={fetchAiInsight}
          disabled={aiLoading}
          style={{
            background: aiLoading ? C.bg2 : C.purpleDim,
            color: C.purple, border: 'none', borderRadius: 8,
            padding: '6px 14px', fontSize: 12, fontWeight: 600,
            cursor: aiLoading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {aiLoading
            ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> 分析中…</>
            : <><Bot size={12} /> {aiInsight ? '重新分析' : '產生洞察'}</>
          }
        </button>
      </div>
      {aiInsight ? (
        <div style={{
          fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)',
          background: C.bg2, padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap',
        }}>{aiInsight}</div>
      ) : (
        <div style={{ fontSize: 12, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bot size={14} style={{ opacity: 0.5 }} /> 點「產生洞察」讓 Gemini 分析當日營運摘要並給建議
        </div>
      )}
    </div>
  )
}
