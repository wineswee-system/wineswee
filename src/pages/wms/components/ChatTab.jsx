import { useState, useRef, useEffect } from 'react'
import { Bot, Send, Loader2, Zap } from 'lucide-react'
import { queryInventoryNL } from '../../../lib/aiInventory'
import { KVTable } from './AIInventoryHelpers'

const INITIAL_MESSAGE = { role: 'ai', text: '你好！我是庫存 AI 助理。請用中文問我任何庫存相關問題，例如：「台中倉還有多少 SKU-001？」' }

export default function ChatTab({ skus, stockLevels, transactions, warehouses }) {
  const [loading, setLoading] = useState(false)
  const [chatMessages, setChatMessages] = useState([INITIAL_MESSAGE])
  const [chatInput, setChatInput] = useState('')
  const chatEndRef = useRef(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])

  const handleChat = async () => {
    if (!chatInput.trim() || loading) return
    const q = chatInput.trim()
    setChatMessages(prev => [...prev, { role: 'user', text: q }])
    setChatInput('')
    setLoading(true)
    try {
      const result = await queryInventoryNL(q, {
        skus, stockLevels, recentTransactions: transactions.slice(0, 30),
        warehouses: warehouses.map(w => w.name || w.code),
      })
      const answer = result.answer || result.raw || JSON.stringify(result)
      const suggestions = result.suggestions || []
      setChatMessages(prev => [...prev, { role: 'ai', text: answer, data: result.data, suggestions, actionable: result.actionable }])
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'ai', text: `Error: ${e.message}` }])
    }
    setLoading(false)
  }

  return (
    <div className="card" style={{ height: 520, display: 'flex', flexDirection: 'column' }}>
      <div className="card-header"><div className="card-title"><Bot size={16} /> AI 庫存問答</div></div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {chatMessages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 12, background: msg.role === 'user' ? 'var(--accent-cyan)' : 'var(--glass-medium)', color: msg.role === 'user' ? '#fff' : 'var(--text-primary)', fontSize: 13 }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
              {msg.data && msg.data.length > 0 && (
                <div style={{ marginTop: 8, padding: 8, background: 'var(--glass-light)', borderRadius: 6 }}>
                  <KVTable data={msg.data} />
                </div>
              )}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {msg.suggestions.map((s, j) => (
                    <button key={j} className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 6px' }}
                      onClick={() => { setChatInput(s) }}>{s}</button>
                  ))}
                </div>
              )}
              {msg.actionable && msg.actionable.action !== 'none' && (
                <div style={{ marginTop: 6, padding: '4px 8px', background: 'var(--accent-green)22', borderRadius: 4, fontSize: 11 }}>
                  <Zap size={10} style={{ display: 'inline', marginRight: 4 }} />
                  建議操作：{msg.actionable.details}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div style={{ textAlign: 'center', padding: 8 }}><Loader2 size={20} className="spin" style={{ color: 'var(--accent-cyan)' }} /></div>}
        <div ref={chatEndRef} />
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--glass-light)', display: 'flex', gap: 8 }}>
        <input className="form-input" style={{ flex: 1 }} placeholder="問我任何庫存問題... 如：「哪些品項需要補貨？」" value={chatInput}
          onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} />
        <button className="btn btn-primary" onClick={handleChat} disabled={loading}><Send size={14} /></button>
      </div>
    </div>
  )
}
