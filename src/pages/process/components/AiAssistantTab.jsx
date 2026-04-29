import { useState, useRef } from 'react'
import { Mic, MicOff } from 'lucide-react'

const AI_EXAMPLES = [
  '我需要一個新員工入職訓練流程',
  '設計一個每月庫存盤點的工作流程',
  '建立一個客戶活動企劃執行流程',
  '建立一個新店開幕準備流程',
]

const PRIORITIES = ['高', '中', '低']
const PRIORITY_COLOR = { 高: 'var(--accent-red)', 中: 'var(--accent-orange)', 低: 'var(--accent-green)' }

function useSpeechInput(onResult) {
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)

  const toggle = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRec) {
      alert('您的瀏覽器不支援語音輸入（請使用 Chrome）')
      return
    }
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = new SpeechRec()
    rec.lang = 'zh-TW'
    rec.continuous = false
    rec.interimResults = false
    rec.onstart = () => setListening(true)
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.onresult = (e) => onResult(e.results[0][0].transcript)
    rec.start()
    recRef.current = rec
  }

  return { listening, toggle }
}

function StepInterviewCard({ step, stepIndex, totalSteps, employees, onConfirm }) {
  const [form, setForm] = useState({
    title: step.title || '',
    role: step.role || '',
    priority: step.priority || '中',
    description: step.description || '',
  })

  return (
    <div style={{
      border: '2px solid var(--accent-cyan)',
      borderRadius: 14,
      padding: '16px 20px',
      background: 'var(--bg-card)',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{
          background: 'var(--accent-cyan)', color: '#fff',
          borderRadius: '50%', width: 28, height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, flexShrink: 0,
        }}>{stepIndex + 1}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            確認第 {stepIndex + 1} / {totalSteps} 步詳情
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>填寫或修改以下欄位後按確認</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>步驟名稱 *</label>
          <input
            className="form-input"
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            style={{ fontSize: 13 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>負責角色 / 人員</label>
          <input
            className="form-input"
            list={`emp-list-${stepIndex}`}
            value={form.role}
            onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
            placeholder="例：店長、HR 人員、系統自動..."
            style={{ fontSize: 13 }}
          />
          <datalist id={`emp-list-${stepIndex}`}>
            {(employees || []).map(e => <option key={e.id} value={e.name} />)}
          </datalist>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>優先程度</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {PRIORITIES.map(p => (
              <button
                key={p}
                onClick={() => setForm(prev => ({ ...prev, priority: p }))}
                style={{
                  padding: '6px 20px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                  fontWeight: form.priority === p ? 700 : 400,
                  background: form.priority === p ? PRIORITY_COLOR[p] : 'var(--bg-secondary)',
                  color: form.priority === p ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${form.priority === p ? PRIORITY_COLOR[p] : 'var(--border-subtle)'}`,
                  transition: 'all 0.15s',
                }}
              >{p}</button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>說明（選填）</label>
          <textarea
            className="form-input"
            rows={2}
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="補充注意事項或作業細節..."
            style={{ fontSize: 13, resize: 'none' }}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ borderRadius: 10, marginTop: 4, alignSelf: 'flex-end', padding: '10px 24px' }}
          onClick={() => onConfirm(stepIndex, { ...step, ...form })}
          disabled={!form.title.trim()}
        >
          {stepIndex + 1 < totalSteps ? `確認，下一步 →` : `完成確認 ✓`}
        </button>
      </div>
    </div>
  )
}

export default function AiAssistantTab({
  aiPrompt, setAiPrompt, aiLoading, aiMessages, aiResult,
  onGenerate, onSaveResult, onSkipResult,
  aiPhase, aiStepIndex, aiDraftSteps, onStepConfirm,
  employees,
}) {
  const { listening, toggle: toggleMic } = useSpeechInput(text => {
    setAiPrompt(prev => prev ? prev + ' ' + text : text)
  })

  const canSubmit = !aiLoading && aiPrompt.trim() && aiPhase !== 'collecting'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 500 }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px', marginBottom: 16, borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(6,182,212,0.05), rgba(139,92,246,0.05))',
        border: '1px solid var(--border-medium)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>AI 流程助手</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              用自然語言或語音描述需求，AI 幫你生成流程並逐步確認每個步驟細節
            </div>
          </div>
        </div>
      </div>

      {/* Message area */}
      <div style={{ flex: 1, marginBottom: 16 }}>
        {/* Empty state */}
        {aiMessages.length === 0 && aiPhase === 'idle' && (
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

        {/* Chat bubbles */}
        {aiMessages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
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

              {/* Steps preview */}
              {msg.data && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
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

        {/* Thinking indicator */}
        {aiLoading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)', padding: '12px 0' }}>
            <div className="spinner" style={{ width: 16, height: 16 }} /> AI 正在設計流程...
          </div>
        )}

        {/* Step interview — one step at a time */}
        {aiPhase === 'collecting' && aiDraftSteps && aiDraftSteps[aiStepIndex] && (
          <StepInterviewCard
            key={aiStepIndex}
            step={aiDraftSteps[aiStepIndex]}
            stepIndex={aiStepIndex}
            totalSteps={aiDraftSteps.length}
            employees={employees}
            onConfirm={onStepConfirm}
          />
        )}

        {/* Save / skip after all steps confirmed */}
        {aiPhase === 'done' && aiResult && !aiLoading && (
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

      {/* Sticky input bar */}
      <div style={{
        display: 'flex', gap: 10, padding: '14px 0',
        borderTop: '1px solid var(--border-subtle)',
        position: 'sticky', bottom: 0, background: 'var(--bg-primary)',
      }}>
        <button
          onClick={toggleMic}
          title={listening ? '停止語音輸入' : '語音輸入（zh-TW）'}
          style={{
            borderRadius: 12, padding: '12px 14px', cursor: 'pointer', flexShrink: 0,
            background: listening ? 'var(--accent-red)' : 'var(--bg-secondary)',
            border: `1px solid ${listening ? 'var(--accent-red)' : 'var(--border-medium)'}`,
            color: listening ? '#fff' : 'var(--text-muted)',
            display: 'flex', alignItems: 'center',
            transition: 'all 0.2s',
            boxShadow: listening ? '0 0 0 3px rgba(239,68,68,0.2)' : 'none',
          }}
        >
          {listening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        <input
          className="form-input"
          type="text"
          style={{ flex: 1, fontSize: 14, padding: '12px 16px', borderRadius: 12 }}
          placeholder={
            listening ? '🎙️ 正在聆聽...' :
            aiPhase === 'collecting' ? '請先完成步驟確認...' :
            '描述你需要的流程，或按麥克風語音輸入'
          }
          value={aiPrompt}
          onChange={e => setAiPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && canSubmit && onGenerate(aiPrompt)}
          disabled={aiLoading || aiPhase === 'collecting'}
        />

        <button
          className="btn btn-primary"
          style={{ borderRadius: 12, padding: '12px 16px' }}
          onClick={() => onGenerate(aiPrompt)}
          disabled={!canSubmit}
        >
          🚀
        </button>
      </div>
    </div>
  )
}
