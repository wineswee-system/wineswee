import { useState, useEffect, useRef } from 'react'
import { Send, Bot, User, Sparkles, RefreshCw, BarChart2, Table } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryHRNL, isConfigured } from '../../lib/ai/hrAI'
import LoadingSpinner from '../../components/LoadingSpinner'

const SUGGESTED_QUERIES = [
  '目前在職員工有幾人？各部門分佈如何？',
  '這個月有誰請假超過 3 天？',
  '最近 30 天遲到最多的員工是誰？',
  '哪些員工薪資低於部門平均？',
  '績效分數最高和最低的前 5 名？',
  '下週有多少人請假？會影響排班嗎？',
  '本月加班時數最多的是哪個部門？',
  '新進員工（半年內）有幾位？',
]

export default function HRAssistant() {
  const [loading, setLoading] = useState(true)
  const [context, setContext] = useState({})
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const chatRef = useRef(null)
  const inputRef = useRef(null)

  // Load HR context data once
  useEffect(() => {
    const now = new Date()
    const d30 = new Date(now)
    d30.setDate(d30.getDate() - 30)
    const since = d30.toISOString().slice(0, 10)
    const thisMonth = now.toISOString().slice(0, 7)

    Promise.all([
      supabase.from('employees').select('id, name, dept, store, department_id, position, store_id, join_date, status, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name'),
      supabase.from('attendance_records').select('employee_id, date, status, hours, employees(name)').gte('date', since),
      supabase.from('leave_requests').select('employee_id, type, start_date, end_date, days, status, employees(name)').gte('created_at', d30.toISOString()),
      supabase.from('salary_records').select('employee_id, month, base_salary, net_salary, employees(name)').like('month', `${thisMonth}%`),
      supabase.from('performance_reviews').select('employee, period, overall_score, rating').order('period', { ascending: false }),
      supabase.from('departments').select('*').order('name'),
    ]).then(([e, a, l, s, p, d]) => {
      setContext({
        employees: e.data || [],
        attendance: a.data || [],
        leaves: l.data || [],
        salaries: s.data || [],
        performance: p.data || [],
        departments: d.data || [],
      })
    }).catch(err => console.error('Failed to load HR context:', err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  const handleAsk = async (question) => {
    const q = question || input.trim()
    if (!q || asking) return

    setMessages(prev => [...prev, { role: 'user', text: q }])
    setInput('')
    setAsking(true)

    try {
      const result = await queryHRNL(q, context)
      setMessages(prev => [...prev, { role: 'ai', ...result }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', answer: `查詢失敗：${err.message}`, intent: 'error', data: [], suggestions: [] }])
    } finally {
      setAsking(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }

  if (!isConfigured()) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Bot size={48} style={{ color: 'var(--text-muted)', marginBottom: 16 }} />
        <h3>AI 助理未啟用</h3>
        <p style={{ color: 'var(--text-muted)' }}>請在 .env 設定 VITE_GEMINI_API_KEY 以使用 HR AI 助理</p>
      </div>
    )
  }

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🤖</span> HR AI 助理</h2>
            <p>用自然語言查詢出勤、請假、薪資、績效等人資數據</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              資料範圍：{context.employees?.length || 0} 位員工 · 近30天出勤 · 當月薪資
            </span>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div ref={chatRef} style={{
        flex: 1, overflowY: 'auto', padding: '16px 0',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {/* Welcome state */}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Sparkles size={40} style={{ color: 'var(--accent-cyan)', marginBottom: 12 }} />
            <h3 style={{ marginBottom: 8 }}>HR 智慧查詢助理</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
              直接用自然語言提問，我會從出勤、請假、薪資、績效資料中找到答案
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 700, margin: '0 auto' }}>
              {SUGGESTED_QUERIES.map((q, i) => (
                <button key={i} onClick={() => handleAsk(q)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-medium)',
                  background: 'var(--bg-card)', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}
                  onMouseEnter={e => { e.target.style.borderColor = 'var(--accent-cyan)'; e.target.style.color = 'var(--accent-cyan)' }}
                  onMouseLeave={e => { e.target.style.borderColor = 'var(--border-medium)'; e.target.style.color = 'var(--text-secondary)' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12, padding: '0 16px',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            {msg.role === 'ai' && (
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-cyan)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Bot size={16} color="#fff" />
              </div>
            )}
            <div style={{
              maxWidth: '75%', padding: '12px 16px', borderRadius: 12,
              background: msg.role === 'user' ? 'var(--accent-cyan)' : 'var(--bg-card)',
              color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
              border: msg.role === 'ai' ? '1px solid var(--border-medium)' : 'none',
            }}>
              {msg.role === 'user' ? (
                <div style={{ fontSize: 14 }}>{msg.text}</div>
              ) : (
                <div>
                  {/* Answer text */}
                  <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.answer}</div>

                  {/* Data points */}
                  {msg.data && msg.data.length > 0 && (
                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                      {msg.data.map((d, j) => (
                        <div key={j} style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-cyan)' }}>{d.value}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Simple table chart */}
                  {msg.chart && msg.chart.type === 'table' && msg.chart.labels?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="data-table-wrapper">
                        <table className="data-table" style={{ fontSize: 12 }}>
                          <thead><tr>{msg.chart.labels.map((l, j) => <th key={j}>{l}</th>)}</tr></thead>
                          <tbody>
                            {(msg.chart.rows || []).map((row, j) => (
                              <tr key={j}>{row.map((cell, k) => <td key={k}>{cell}</td>)}</tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Bar chart visualization */}
                  {msg.chart && msg.chart.type === 'bar' && msg.chart.labels?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      {msg.chart.labels.map((label, j) => {
                        const val = msg.chart.values?.[j] || 0
                        const max = Math.max(...(msg.chart.values || [1]))
                        return (
                          <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ width: 80, fontSize: 12, textAlign: 'right', color: 'var(--text-muted)' }}>{label}</span>
                            <div style={{ flex: 1, height: 18, borderRadius: 4, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                              <div style={{ width: `${(val / max) * 100}%`, height: '100%', borderRadius: 4, background: 'var(--accent-cyan)' }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 600, width: 40 }}>{val}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Actionable */}
                  {msg.actionable && msg.actionable.action !== 'none' && (
                    <div style={{
                      marginTop: 10, padding: '8px 12px', borderRadius: 8,
                      background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)',
                      fontSize: 12, color: 'var(--accent-cyan)',
                    }}>
                      <strong>建議動作：</strong> {msg.actionable.details}
                    </div>
                  )}

                  {/* Follow-up suggestions */}
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {msg.suggestions.map((s, j) => (
                        <button key={j} onClick={() => handleAsk(s)} style={{
                          padding: '4px 10px', borderRadius: 14, border: '1px solid var(--border-subtle)',
                          background: 'transparent', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)',
                        }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-purple)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <User size={16} color="#fff" />
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {asking && (
          <div style={{ display: 'flex', gap: 12, padding: '0 16px' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-cyan)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Bot size={16} color="#fff" />
            </div>
            <div style={{
              padding: '12px 16px', borderRadius: 12, background: 'var(--bg-card)',
              border: '1px solid var(--border-medium)', display: 'flex', gap: 4, alignItems: 'center',
            }}>
              <span className="typing-dot" style={{ animationDelay: '0s' }} />
              <span className="typing-dot" style={{ animationDelay: '0.15s' }} />
              <span className="typing-dot" style={{ animationDelay: '0.3s' }} />
              <style>{`
                .typing-dot {
                  width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted);
                  animation: typingBounce 1s infinite;
                }
                @keyframes typingBounce {
                  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
                  40% { transform: translateY(-6px); opacity: 1; }
                }
              `}</style>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid var(--border-medium)',
        background: 'var(--bg-card)', display: 'flex', gap: 8,
      }}>
        <input
          ref={inputRef}
          className="form-input"
          style={{ flex: 1, fontSize: 14, padding: '10px 16px' }}
          placeholder="輸入 HR 相關問題，例如「這個月誰的加班時數最高？」"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={asking}
        />
        <button className="btn btn-primary" onClick={() => handleAsk()} disabled={asking || !input.trim()} style={{ padding: '10px 20px' }}>
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
