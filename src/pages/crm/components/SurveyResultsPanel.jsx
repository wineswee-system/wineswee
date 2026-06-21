import { useState, useEffect, useMemo } from 'react'
import { X, MessageSquare } from 'lucide-react'
import { getSurveyResults, getSurveyInvitations } from '../../../lib/db'

export default function SurveyResultsPanel({ survey, onClose }) {
  const [responses, setResponses]       = useState([])
  const [invitations, setInvitations]   = useState([])
  const [loading, setLoading]           = useState(true)

  useEffect(() => {
    if (!survey?.id) return
    setLoading(true)
    Promise.all([
      getSurveyResults(survey.id),
      getSurveyInvitations(survey.id),
    ]).then(([rRes, iRes]) => {
      setResponses(rRes.data || [])
      setInvitations(iRes.data || [])
      setLoading(false)
    })
  }, [survey?.id])

  const stats = useMemo(() => {
    const sentCount      = invitations.filter(i => i.status !== 'pending').length
    const respondedCount = invitations.filter(i => i.status === 'responded').length
    const responseRate   = sentCount > 0 ? Math.round((respondedCount / sentCount) * 100) : 0

    const byQuestion = {}
    for (const r of responses) {
      const q = r.survey_questions
      if (!q) continue
      const key = q.id
      if (!byQuestion[key]) {
        byQuestion[key] = { question: q.question, type: q.type, sort_order: q.sort_order, values: [] }
      }
      if (q.type === 'nps' || q.type === 'rating') {
        if (r.answer_number != null) byQuestion[key].values.push(Number(r.answer_number))
      } else if (q.type === 'single_choice' || q.type === 'multi_choice') {
        const opts = Array.isArray(r.answer_options) ? r.answer_options : []
        byQuestion[key].values.push(...opts)
      } else if (q.type === 'text') {
        if (r.answer_text) byQuestion[key].values.push(r.answer_text)
      }
    }

    const questions = Object.values(byQuestion).sort((a, b) => a.sort_order - b.sort_order)

    let npsScore = null
    const npsQ = questions.find(q => q.type === 'nps')
    if (npsQ && npsQ.values.length > 0) {
      const promoters  = npsQ.values.filter(v => v >= 9).length
      const detractors = npsQ.values.filter(v => v <= 6).length
      npsScore = Math.round(((promoters - detractors) / npsQ.values.length) * 100)
    }

    return { sentCount, respondedCount, responseRate, questions, npsScore }
  }, [responses, invitations])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px', width: '100%', maxWidth: '700px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-primary)' }}>
          <div>
            <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '1rem', margin: 0 }}>{survey.name}</h3>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>問卷結果分析</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem', fontSize: '0.9rem' }}>載入中…</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                <StatCard label="已發送" value={stats.sentCount} unit="份" color="var(--accent-blue)" />
                <StatCard label="已回覆" value={stats.respondedCount} unit="份" color="var(--accent-green)" />
                <StatCard label="回覆率" value={`${stats.responseRate}%`} unit="" color="var(--accent-cyan)" />
              </div>

              {stats.npsScore !== null && (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ textAlign: 'center', minWidth: '80px' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: stats.npsScore >= 50 ? 'var(--accent-green)' : stats.npsScore >= 0 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
                      {stats.npsScore}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>NPS 分數</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <NpsBar values={stats.questions.find(q => q.type === 'nps')?.values || []} />
                  </div>
                </div>
              )}

              {stats.questions.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', fontSize: '0.85rem' }}>尚無回覆資料</div>
              ) : stats.questions.map((q, i) => (
                <QuestionResult key={i} q={q} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, unit, color }) {
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '0.875rem', textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}<span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '2px' }}>{unit}</span></div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.2rem' }}>{label}</div>
    </div>
  )
}

function NpsBar({ values }) {
  const promoters  = values.filter(v => v >= 9).length
  const passives   = values.filter(v => v === 7 || v === 8).length
  const detractors = values.filter(v => v <= 6).length
  const total      = values.length
  if (total === 0) return null
  const pct = (n) => Math.round((n / total) * 100)
  return (
    <div>
      <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', marginBottom: '0.4rem' }}>
        <div style={{ width: `${pct(promoters)}%`, background: 'var(--accent-green)' }} />
        <div style={{ width: `${pct(passives)}%`, background: 'var(--accent-orange)' }} />
        <div style={{ width: `${pct(detractors)}%`, background: 'var(--accent-red)' }} />
      </div>
      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span><span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>推薦者</span> {promoters}人 ({pct(promoters)}%)</span>
        <span><span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>中立</span> {passives}人 ({pct(passives)}%)</span>
        <span><span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>批評者</span> {detractors}人 ({pct(detractors)}%)</span>
      </div>
    </div>
  )
}

function QuestionResult({ q }) {
  if (q.type === 'text') {
    return (
      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '0.875rem' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <MessageSquare size={14} /> {q.question}
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>{q.values.length} 則回應</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '200px', overflowY: 'auto' }}>
          {q.values.length === 0 ? (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>尚無文字回應</span>
          ) : q.values.map((v, i) => (
            <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '5px', padding: '0.4rem 0.625rem', color: 'var(--text-secondary)', fontSize: '0.82rem', borderLeft: '3px solid var(--accent-blue)' }}>
              {v}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (q.type === 'nps' || q.type === 'rating') {
    const avg    = q.values.length > 0 ? (q.values.reduce((a, b) => a + b, 0) / q.values.length).toFixed(1) : '—'
    const max    = q.type === 'nps' ? 10 : 5
    const counts = {}
    for (let i = 0; i <= max; i++) counts[i] = 0
    for (const v of q.values) { if (counts[v] !== undefined) counts[v]++ }
    const maxCount = Math.max(...Object.values(counts), 1)

    return (
      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '0.875rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600 }}>{q.question}</span>
          <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: '1rem' }}>平均 {avg}</span>
        </div>
        <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '60px' }}>
          {Object.entries(counts).map(([score, cnt]) => (
            <div key={score} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <div style={{ width: '100%', background: cnt > 0 ? 'var(--accent-cyan)' : 'var(--bg-tertiary)', borderRadius: '2px 2px 0 0', height: `${Math.round((cnt / maxCount) * 52)}px`, minHeight: cnt > 0 ? '4px' : '2px' }} />
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{score}</span>
            </div>
          ))}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.4rem' }}>{q.values.length} 份回覆</div>
      </div>
    )
  }

  // single_choice / multi_choice
  const counts = {}
  for (const v of q.values) counts[v] = (counts[v] || 0) + 1
  const total   = q.values.length
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])

  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '0.875rem' }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.75rem' }}>{q.question}</div>
      {entries.length === 0 ? (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>尚無回應</span>
      ) : entries.map(([opt, cnt], i) => {
        const pct = total > 0 ? Math.round((cnt / total) * 100) : 0
        return (
          <div key={i} style={{ marginBottom: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{opt}</span>
              <span style={{ color: 'var(--text-muted)' }}>{cnt} 票 ({pct}%)</span>
            </div>
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: '3px', height: '6px', overflow: 'hidden' }}>
              <div style={{ background: 'var(--accent-purple)', height: '100%', width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.4rem' }}>{total} 份回覆</div>
    </div>
  )
}
