import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ModalOverlay } from '../../../components/Modal'
import {
  Mail, MessageSquare, Smartphone, Clock, GitBranch, X, Sparkles, Loader
} from 'lucide-react'
import { STEP_TYPES } from '../../../lib/dripCampaign'
import { generateCampaignCopy, isConfigured as isAIConfigured } from '../../../lib/ai/crmAI'

const STEP_ICON_MAP = {
  email: <Mail size={16} />,
  line: <MessageSquare size={16} />,
  sms: <Smartphone size={16} />,
  wait: <Clock size={16} />,
  condition: <GitBranch size={16} />,
}

export default function DripStepEditor({ editingStep, stepForm, setSF, onClose, onSave, campaignName }) {
  const [aiLoading, setAiLoading] = useState(false)
  const [aiGoal, setAiGoal] = useState('')
  const [aiError, setAiError] = useState(null)

  const handleAiDripContent = async () => {
    if (!aiGoal.trim()) return
    setAiLoading(true)
    setAiError(null)
    try {
      const result = await generateCampaignCopy({
        channel: stepForm.type === 'email' ? 'email' : stepForm.type === 'line' ? 'line' : 'sms',
        goal: aiGoal,
        audience: campaignName || '客戶',
        tone: '親切',
      })
      if (result.subject && stepForm.type === 'email') setSF('subject', result.subject)
      if (result.body) setSF('content', result.body)
      setAiGoal('')
    } catch (err) {
      setAiError(err.message || 'AI 產生失敗')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '100%', maxWidth: 520, boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>{editingStep !== null ? '編輯步驟' : '新增步驟'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>步驟類型</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {STEP_TYPES.map(t => (
                <button key={t.id} onClick={() => setSF('type', t.id)}
                  className={`btn ${stepForm.type === t.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 11, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {STEP_ICON_MAP[t.id]} {t.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>延遲天數</label>
              <input type="number" min={0} value={stepForm.delay_days} onChange={e => setSF('delay_days', parseInt(e.target.value) || 0)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>延遲小時</label>
              <input type="number" min={0} value={stepForm.delay_hours} onChange={e => setSF('delay_hours', parseInt(e.target.value) || 0)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>
          </div>

          {(stepForm.type === 'email') && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>郵件主旨</label>
              <input value={stepForm.subject} onChange={e => setSF('subject', e.target.value)} placeholder="輸入主旨行"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>
          )}

          {(stepForm.type === 'email' || stepForm.type === 'line' || stepForm.type === 'sms') && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>內容</label>
                {isAIConfigured() && (
                  <button type="button" onClick={() => setAiGoal(prev => prev ? '' : ' ')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-purple)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Sparkles size={12} /> AI 產生
                  </button>
                )}
              </div>
              {aiGoal !== '' && isAIConfigured() && (
                <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
                  <input value={aiGoal} onChange={e => setAiGoal(e.target.value)} placeholder="輸入這步驟的目標，例：歡迎新會員、提醒回購..."
                    style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--accent-purple)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                  <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap' }} onClick={handleAiDripContent} disabled={aiLoading || !aiGoal.trim()}>
                    {aiLoading ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={12} />}
                  </button>
                </div>
              )}
              {aiError && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginBottom: 6 }}>{aiError}</div>}
              <textarea value={stepForm.content} onChange={e => setSF('content', e.target.value)} placeholder="輸入訊息內容..." rows={4}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical' }} />
            </div>
          )}

          {stepForm.type === 'condition' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>欄位</label>
                  <select value={stepForm.field} onChange={e => setSF('field', e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    <option value="opened_email">已開信</option>
                    <option value="clicked_link">已點擊</option>
                    <option value="purchased">已購買</option>
                    <option value="tag_match">標籤</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>運算子</label>
                  <select value={stepForm.operator} onChange={e => setSF('operator', e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    <option value="eq">等於</option>
                    <option value="neq">不等於</option>
                    <option value="gt">大於</option>
                    <option value="contains">包含</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>值</label>
                  <input value={stepForm.value} onChange={e => setSF('value', e.target.value)} placeholder="true"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border-subtle)' }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={onSave}>儲存步驟</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
