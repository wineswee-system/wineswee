import { useState, useRef, useEffect } from 'react'
import { Bot, Send, Sparkles, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react'
import { chat, clearSession, isConfigured } from '../../lib/gemini'

const suggestedPrompts = [
  '幫我分析本月出勤狀況',
  '列出待審核的假單',
  '本月薪資總支出是多少？',
  '哪個部門人數最多？',
  '有哪些流程正在執行中？',
  '最近的操作紀錄有哪些？',
  '幫我檢查薪資計算是否合規',
  '分析應收帳款帳齡',
  '庫存周轉率建議',
]

const initialMessages = [
  {
    role: 'assistant',
    content: '你好！我是 SME Ops AI 助理，由 Gemini 驅動。我可以幫你分析財務資料、檢查薪資合規、預測需求、評估供應商，或回答任何關於 ERP 系統操作的問題。請問有什麼可以幫你的？',
    time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
  }
]

export default function AgentConsole() {
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef(null)
  const configured = isConfigured()

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const getNow = () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })

  const handleSend = async () => {
    if (!input.trim() || loading) return
    const userMessage = input.trim()
    const userMsg = { role: 'user', content: userMessage, time: getNow() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const response = await chat(userMessage)
      setMessages(prev => [...prev, { role: 'assistant', content: response, time: getNow() }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `抱歉，發生錯誤：${err.message}`,
        time: getNow(),
        error: true,
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleReset = () => {
    clearSession()
    setMessages(initialMessages)
  }

  return (
    <div className="fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent-cyan-dim), var(--accent-purple-dim))',
            border: '1px solid var(--accent-cyan)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bot size={18} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>Agent 控制台</h2>
            <p style={{ margin: 0, fontSize: 12 }}>AI 智慧助理 — Powered by Gemini</p>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={handleReset} title="重新開始對話">
          <RefreshCw size={14} /> 重新開始
        </button>
      </div>

      {/* API Key Warning */}
      {!configured && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)',
          fontSize: 13, color: '#eab308',
        }}>
          <AlertTriangle size={16} />
          請在 .env 檔案中設定 VITE_GEMINI_API_KEY 以啟用 AI 功能
        </div>
      )}

      {/* Suggested Prompts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {suggestedPrompts.map((p, i) => (
          <button
            key={i}
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 12px' }}
            onClick={() => setInput(p)}
          >
            <Sparkles size={11} />
            {p}
          </button>
        ))}
      </div>

      {/* Chat Window */}
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              gap: 10, alignItems: 'flex-start',
            }}>
              {msg.role === 'assistant' && (
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: msg.error
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'linear-gradient(135deg, var(--accent-cyan-dim), var(--accent-purple-dim))',
                  border: `1px solid ${msg.error ? 'rgba(239, 68, 68, 0.4)' : 'var(--accent-cyan)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {msg.error
                    ? <AlertTriangle size={14} style={{ color: '#ef4444' }} />
                    : <Bot size={14} style={{ color: 'var(--accent-cyan)' }} />}
                </div>
              )}
              <div style={{
                maxWidth: '72%',
                background: msg.role === 'user' ? 'var(--accent-cyan-dim)' : 'var(--glass-medium)',
                border: `1px solid ${msg.role === 'user' ? 'var(--accent-cyan)' : msg.error ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-subtle)'}`,
                borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                padding: '10px 14px',
              }}>
                <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: msg.role === 'user' ? 'right' : 'left' }}>
                  {msg.time}
                </div>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: 'linear-gradient(135deg, var(--accent-cyan-dim), var(--accent-purple-dim))',
                border: '1px solid var(--accent-cyan)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Loader2 size={14} style={{ color: 'var(--accent-cyan)', animation: 'spin 1s linear infinite' }} />
              </div>
              <div style={{
                background: 'var(--glass-medium)', border: '1px solid var(--border-subtle)',
                borderRadius: '4px 12px 12px 12px', padding: '10px 14px',
                fontSize: 13, color: 'var(--text-muted)',
              }}>
                思考中...
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10 }}>
          <input
            className="form-input"
            style={{ flex: 1 }}
            placeholder="輸入問題，按 Enter 送出..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button className="btn btn-primary" onClick={handleSend} disabled={!input.trim() || loading}>
            {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
