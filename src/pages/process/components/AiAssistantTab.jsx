const AI_EXAMPLES = [
  '我需要一個新員工入職訓練流程',
  '設計一個每月庫存盤點的工作流程',
  '建立一個客戶活動企劃執行流程',
  '建立一個新店開幕準備流程',
]

export default function AiAssistantTab({
  aiPrompt, setAiPrompt, aiLoading, aiMessages, aiResult,
  onGenerate, onSaveResult, onSkipResult,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 500 }}>
      {/* Header card */}
      <div style={{
        padding: '20px 24px', marginBottom: 16, borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(6,182,212,0.05), rgba(139,92,246,0.05))',
        border: '1px solid var(--border-medium)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 24 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>AI 流程助手</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>用自然語言描述你需要的流程，AI 會幫你設計</div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, marginBottom: 16 }}>
        {aiMessages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🧑‍💼</div>
            <div style={{ color: 'var(--text-muted)', marginBottom: 24 }}>告訴我你想建立什麼流程，例如：</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400, margin: '0 auto' }}>
              {AI_EXAMPLES.map((ex, i) => (
                <button key={i} onClick={() => onGenerate(ex)} style={{
                  padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border-medium)',
                  background: 'var(--bg-card)', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 13, textAlign: 'left',
                }}>
                  💡 「{ex}」
                </button>
              ))}
            </div>
          </div>
        )}

        {aiMessages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 12,
          }}>
            <div style={{
              maxWidth: '80%', padding: '12px 16px', borderRadius: 14,
              background: msg.role === 'user' ? 'var(--accent-cyan)' : msg.error ? 'rgba(239,68,68,0.1)' : 'var(--bg-card)',
              color: msg.role === 'user' ? '#fff' : msg.error ? 'var(--accent-red)' : 'var(--text-primary)',
              border: msg.role === 'user' ? 'none' : '1px solid var(--border-medium)',
              fontSize: 14,
            }}>
              {msg.text}

              {/* Show generated steps preview */}
              {msg.data && (
                <div style={{ marginTop: 12, padding: '12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{msg.data.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    <span className="badge badge-cyan">{msg.data.category}</span> {msg.data.description}
                  </div>
                  {(msg.data.steps || []).map((s, j) => (
                    <div key={j} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, minWidth: 20 }}>{j + 1}.</span>
                      <span style={{ fontWeight: 600 }}>{s.title}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{s.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {aiLoading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)', padding: '12px 0' }}>
            <div className="spinner" style={{ width: 16, height: 16 }} /> AI 正在設計流程...
          </div>
        )}

        {/* Save button when result is ready */}
        {aiResult && !aiLoading && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={onSaveResult}>
              💾 儲存到流程範本
            </button>
            <button className="btn btn-secondary" onClick={onSkipResult}>
              略過
            </button>
          </div>
        )}
      </div>

      {/* Input bar (sticky bottom) */}
      <div style={{
        display: 'flex', gap: 10, padding: '14px 0',
        borderTop: '1px solid var(--border-subtle)',
        position: 'sticky', bottom: 0, background: 'var(--bg-primary)',
      }}>
        <input
          className="form-input"
          type="text"
          style={{ flex: 1, fontSize: 14, padding: '12px 16px', borderRadius: 12 }}
          placeholder="描述你需要的流程..."
          value={aiPrompt}
          onChange={e => setAiPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !aiLoading && onGenerate(aiPrompt)}
          disabled={aiLoading}
        />
        <button
          className="btn btn-primary"
          style={{ borderRadius: 12, padding: '12px 16px' }}
          onClick={() => onGenerate(aiPrompt)}
          disabled={aiLoading || !aiPrompt.trim()}
        >
          🚀
        </button>
      </div>
    </div>
  )
}
