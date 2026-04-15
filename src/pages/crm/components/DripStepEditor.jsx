import {
  Mail, MessageSquare, Smartphone, Clock, GitBranch, X
} from 'lucide-react'
import { STEP_TYPES } from '../../../lib/dripCampaign'

const STEP_ICON_MAP = {
  email: <Mail size={16} />,
  line: <MessageSquare size={16} />,
  sms: <Smartphone size={16} />,
  wait: <Clock size={16} />,
  condition: <GitBranch size={16} />,
}

export default function DripStepEditor({ editingStep, stepForm, setSF, onClose, onSave }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
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
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>內容</label>
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
    </div>
  )
}
