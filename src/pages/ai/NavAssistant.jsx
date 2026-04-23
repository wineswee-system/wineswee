import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Send, User, Sparkles, ArrowRight, Trash2, Info } from 'lucide-react'
import { ask, isAiEnabled, resetChat } from '../../lib/navAssistant/engine'
import { QUICK_PROMPTS } from '../../lib/navAssistant/knowledgeBase'

const INITIAL_MESSAGE = {
  role: 'assistant',
  reply: '您好，我是 HR 與工作流程的 AI 導覽助理。請問您想做什麼？例如「我要請特休」、「怎麼建立新流程」、「如何幫員工排班」…',
  steps: [],
  links: [],
  suggestions: ['我要請特休', '漏打卡怎麼辦', '怎麼建立新流程'],
}

export default function NavAssistant() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const aiEnabled = useMemo(() => isAiEnabled(), [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  const send = async (raw) => {
    const text = (raw ?? input).trim()
    if (!text || busy) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setBusy(true)
    const answer = await ask(text)
    setMessages(prev => [...prev, { role: 'assistant', ...answer }])
    setBusy(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const clearChat = () => {
    resetChat()
    setMessages([INITIAL_MESSAGE])
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2>
            <span className="header-icon"><Bot size={22} style={{ verticalAlign: -4 }} /></span>
            HR 與流程 AI 助理
          </h2>
          <p>用自然語言問「怎麼做某件事」，助理會引導您到正確的頁面並告訴您操作步驟。</p>
        </div>
        <button
          onClick={clearChat}
          title="清除對話"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
            fontSize: 13, cursor: 'pointer',
          }}
        >
          <Trash2 size={14} /> 清除對話
        </button>
      </div>

      {!aiEnabled && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-orange)', fontSize: 13 }}>
            <Info size={16} /> 未設定 VITE_GEMINI_API_KEY，目前使用關鍵字比對模式（仍可正常指引頁面）。
          </div>
        </div>
      )}

      <div className="grid-2" style={{ gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'stretch' }}>
        {/* ── Chat panel ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 240px)', minHeight: 480 }}>
          <div
            ref={scrollRef}
            style={{
              flex: 1, overflowY: 'auto', padding: 20,
              display: 'flex', flexDirection: 'column', gap: 16,
              background: 'var(--bg-main)',
            }}
          >
            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} onSuggest={send} onNavigate={navigate} />
            ))}
            {busy && (
              <MessageBubble
                message={{ role: 'assistant', reply: '思考中…', steps: [], links: [], suggestions: [] }}
                onSuggest={send}
                onNavigate={navigate}
                typing
              />
            )}
          </div>

          <div style={{
            padding: 12, borderTop: '1px solid var(--border-color)',
            display: 'flex', gap: 8, alignItems: 'flex-end',
            background: 'var(--bg-secondary)',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="輸入問題… (Enter 送出，Shift+Enter 換行)"
              disabled={busy}
              rows={2}
              style={{
                flex: 1, resize: 'none', padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-main)', color: 'var(--text-primary)',
                fontSize: 14, fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              style={{
                padding: '10px 16px', borderRadius: 8, border: 'none',
                background: busy || !input.trim() ? 'var(--bg-tertiary)' : 'var(--accent-cyan)',
                color: '#fff', cursor: busy || !input.trim() ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500,
              }}
            >
              <Send size={14} /> 送出
            </button>
          </div>
        </div>

        {/* ── Quick actions panel ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <div className="card-title">
              <Sparkles size={14} style={{ verticalAlign: -2, marginRight: 4, color: 'var(--accent-cyan)' }} />
              快速提問
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
            {QUICK_PROMPTS.map((qp, i) => (
              <button
                key={i}
                onClick={() => send(qp.query)}
                disabled={busy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-main)', color: 'var(--text-primary)',
                  fontSize: 13, textAlign: 'left', cursor: busy ? 'default' : 'pointer',
                  transition: 'background var(--transition-fast)',
                }}
                onMouseEnter={e => { if (!busy) e.currentTarget.style.background = 'var(--bg-tertiary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-main)' }}
              >
                <span style={{ fontSize: 16 }}>{qp.icon}</span>
                <span>{qp.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message, onSuggest, onNavigate, typing }) {
  const isUser = message.role === 'user'
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: isUser ? 'row-reverse' : 'row' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: isUser ? 'var(--accent-cyan)' : 'var(--accent-purple)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      }}>
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          padding: '10px 14px', borderRadius: 12,
          background: isUser ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
          color: isUser ? '#fff' : 'var(--text-primary)',
          border: isUser ? 'none' : '1px solid var(--border-color)',
          fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap',
          opacity: typing ? 0.7 : 1,
        }}>
          {isUser ? message.content : message.reply}
        </div>

        {!isUser && message.steps?.length > 0 && (
          <div style={{
            padding: 12, borderRadius: 10,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>操作步驟</div>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {message.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        )}

        {!isUser && message.links?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {message.links.map((link, i) => (
              <button
                key={i}
                onClick={() => onNavigate(link.path)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '10px 14px', borderRadius: 10,
                  border: '1px solid var(--accent-cyan)',
                  background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                  fontSize: 13, cursor: 'pointer', textAlign: 'left',
                  transition: 'background var(--transition-fast)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{link.label}</span>
                  {link.tip && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>💡 {link.tip}</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{link.path}</span>
                </div>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        )}

        {!isUser && message.suggestions?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {message.suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSuggest(s)}
                style={{
                  padding: '5px 10px', borderRadius: 14,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-main)', color: 'var(--text-secondary)',
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
