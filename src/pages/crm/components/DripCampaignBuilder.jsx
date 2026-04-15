import { createPortal } from 'react-dom'
import { ModalOverlay } from '../../../components/Modal'
import {
  Plus, Play, Send, ChevronRight, Mail, MessageSquare, Smartphone, Clock,
  GitBranch, Zap, Sparkles, Check, X, Edit3, RefreshCw, Wand2, BarChart3, Trash2
} from 'lucide-react'
import { TRIGGER_TYPES, STEP_TYPES } from '../../../lib/dripCampaign'
import { EMAIL_DESIGN_PRESETS } from '../../../lib/aiTemplateEngine'

const STEP_ICON_MAP = {
  email: <Mail size={16} />,
  line: <MessageSquare size={16} />,
  sms: <Smartphone size={16} />,
  wait: <Clock size={16} />,
  condition: <GitBranch size={16} />,
}

const STEP_COLOR_MAP = {
  email: '#6366f1',
  line: '#06c755',
  sms: '#f59e0b',
  wait: '#94a3b8',
  condition: '#ec4899',
}

const AUDIENCES = ['全部客戶', 'VIP 客戶', '半年未購買', '生日當月', '潛力客戶', '老客戶']

const PURPOSES = [
  { id: 'welcome', label: '歡迎信' },
  { id: 'promotion', label: '促銷活動' },
  { id: 'newsletter', label: '電子報' },
  { id: 'announcement', label: '公告' },
  { id: 'follow_up', label: '後續跟進' },
  { id: 'thank_you', label: '感謝信' },
  { id: 'feedback', label: '問卷回饋' },
  { id: 'reactivation', label: '喚回沉睡' },
  { id: 'event_invitation', label: '活動邀請' },
  { id: 'product_launch', label: '新品上市' },
]

const TONES = [
  { id: 'professional', label: '專業' },
  { id: 'friendly', label: '親切' },
  { id: 'urgent', label: '急迫' },
  { id: 'luxurious', label: '高級' },
  { id: 'playful', label: '活潑' },
]

const IMPROVEMENT_TYPES = [
  { id: 'shorter', label: '更精簡' },
  { id: 'more_urgent', label: '更緊迫' },
  { id: 'more_friendly', label: '更親切' },
  { id: 'add_social_proof', label: '加社會證明' },
  { id: 'add_scarcity', label: '加稀缺感' },
  { id: 'more_professional', label: '更專業' },
]

export default function DripCampaignBuilder({
  editingCampaign,
  form, set,
  steps, onOpenStepEditor, onDeleteStep, onMoveStep,
  builderTab, setBuilderTab,
  onClose, onSave,
  onShowTemplates,
  // AI state & handlers
  aiPurpose, setAiPurpose, aiTone, setAiTone, aiDesign, setAiDesign,
  generatedTemplate, subjectLines, ctaVariations,
  improveType, setImproveType, improveInput, setImproveInput, improvedResult,
  templateScore,
  onGenerate, onSubjectLines, onCTAVariations, onImprove,
  stepForm, setSF, editingStep,
  // Preview state & handlers
  previewDevice, setPreviewDevice,
  simulationResult, testSent,
  onSimulate, onSendTest,
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '100%', maxWidth: 920, maxHeight: '92vh', overflow: 'hidden', boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>{editingCampaign ? '編輯活動' : '建立新活動'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', padding: '0 24px', gap: 0 }}>
          {['基本設定', '流程設計', 'AI 範本助手', '預覽與測試'].map((tab, i) => (
            <button key={i} onClick={() => setBuilderTab(i)}
              style={{ padding: '12px 20px', fontSize: 13, fontWeight: builderTab === i ? 700 : 400, color: builderTab === i ? 'var(--color-primary)' : 'var(--text-secondary)', background: 'none', border: 'none', borderBottom: builderTab === i ? '2px solid var(--color-primary)' : '2px solid transparent', cursor: 'pointer', transition: 'all 0.15s' }}>
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>

          {/* Tab 0: Basic Setup */}
          {builderTab === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>活動名稱</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="例: 新會員歡迎系列"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 14, background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>活動說明</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="描述此活動的目標與內容" rows={2}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical' }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, display: 'block', color: 'var(--text-secondary)' }}>觸發條件</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {TRIGGER_TYPES.map(t => (
                    <div key={t.id} onClick={() => set('trigger', t.id)}
                      style={{ padding: '12px 14px', border: form.trigger === t.id ? '2px solid var(--color-primary)' : '1px solid var(--border-medium)', borderRadius: 10, cursor: 'pointer', background: form.trigger === t.id ? 'var(--bg-tertiary)' : 'var(--bg-primary)', transition: 'all 0.15s' }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{t.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{t.description.substring(0, 30)}...</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>目標受眾</label>
                  <select value={form.audience} onChange={e => set('audience', e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    {AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block', color: 'var(--text-secondary)' }}>排程方式</label>
                  <select value={form.scheduleMode} onChange={e => set('scheduleMode', e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    <option value="immediate">觸發後立即開始</option>
                    <option value="delayed">延遲啟動</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Tab 1: Flow Designer */}
          {builderTab === 1 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700 }}>行銷流程 ({steps.length} 步驟)</h4>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary" onClick={onShowTemplates} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Sparkles size={12} /> 套用範本
                  </button>
                  <button className="btn btn-primary" onClick={() => onOpenStepEditor()} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Plus size={12} /> 新增步驟
                  </button>
                </div>
              </div>

              {steps.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-secondary)', border: '2px dashed var(--border-medium)', borderRadius: 12 }}>
                  <Zap size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                  <div style={{ fontSize: 14, fontWeight: 600 }}>尚未設定步驟</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>點擊「新增步驟」開始建立行銷流程</div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {steps.map((step, idx) => {
                  const typeInfo = STEP_TYPES.find(t => t.id === step.type)
                  const color = STEP_COLOR_MAP[step.type] || '#6b7280'
                  return (
                    <div key={step.id || idx}>
                      {idx > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                          <div style={{ width: 2, height: 24, background: 'var(--border-medium)' }} />
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                            {idx + 1}
                          </div>
                        </div>
                        <div style={{ flex: 1, padding: '12px 16px', border: '1px solid var(--border-medium)', borderRadius: 10, background: 'var(--bg-primary)', borderLeft: `3px solid ${color}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color }}>{STEP_ICON_MAP[step.type]}</span>
                              <span style={{ fontSize: 13, fontWeight: 600 }}>{typeInfo?.name || step.type}</span>
                              {(step.delay_days > 0 || step.delay_hours > 0) && (
                                <span style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 4 }}>
                                  <Clock size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                                  {step.delay_days > 0 ? `${step.delay_days}天` : ''}{step.delay_hours > 0 ? `${step.delay_hours}小時` : ''}後
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => onMoveStep(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontSize: 14, color: 'var(--text-secondary)' }}>↑</button>
                              <button onClick={() => onMoveStep(idx, 1)} disabled={idx === steps.length - 1} style={{ background: 'none', border: 'none', cursor: idx === steps.length - 1 ? 'default' : 'pointer', opacity: idx === steps.length - 1 ? 0.3 : 1, fontSize: 14, color: 'var(--text-secondary)' }}>↓</button>
                              <button onClick={() => onOpenStepEditor(step, idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)' }}><Edit3 size={13} /></button>
                              <button onClick={() => onDeleteStep(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={13} /></button>
                            </div>
                          </div>
                          {step.type === 'email' && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>主旨: {step.subject}</div>}
                          {(step.type === 'email' || step.type === 'line' || step.type === 'sms') && step.content && (
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>{step.content.substring(0, 80)}...</div>
                          )}
                          {step.type === 'condition' && (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                條件: {step.field} {step.operator} {String(step.value)}
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                                <div style={{ padding: '6px 10px', borderRadius: 6, background: '#dcfce7', border: '1px solid #bbf7d0', fontSize: 11 }}>
                                  <span style={{ fontWeight: 600, color: '#16a34a' }}>True:</span> {step.true_branch_step?.type || step.true_step?.type || '-'}
                                </div>
                                <div style={{ padding: '6px 10px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 11 }}>
                                  <span style={{ fontWeight: 600, color: '#dc2626' }}>False:</span> {step.false_branch_step?.type || step.false_step?.type || '-'}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tab 2: AI Template Assistant */}
          {builderTab === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Quick Generate */}
              <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Wand2 size={16} style={{ color: 'var(--color-primary)' }} /> 快速生成
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>郵件目的</label>
                    <select value={aiPurpose} onChange={e => setAiPurpose(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                      {PURPOSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>語氣</label>
                    <select value={aiTone} onChange={e => setAiTone(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                      {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>設計風格</label>
                    <select value={aiDesign} onChange={e => setAiDesign(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-medium)', borderRadius: 6, fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                      {Object.entries(EMAIL_DESIGN_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.nameZh}</option>)}
                    </select>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={onGenerate} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <Sparkles size={14} /> AI 生成
                </button>

                {generatedTemplate && (
                  <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>生成結果</div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}><strong>主旨:</strong> {generatedTemplate.subject}</div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}><strong>預覽:</strong> {generatedTemplate.preheader}</div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}><strong>問候:</strong> {generatedTemplate.greeting}</div>
                    <div style={{ fontSize: 12, marginBottom: 4, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}><strong>正文:</strong><br />{generatedTemplate.body}</div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}><strong>CTA:</strong> {generatedTemplate.cta_text}</div>
                    <div style={{ fontSize: 12 }}><strong>結語:</strong> {generatedTemplate.closing}</div>
                    <button className="btn btn-secondary" style={{ marginTop: 8, fontSize: 11 }}
                      onClick={() => {
                        if (editingStep !== null) {
                          setSF('subject', generatedTemplate.subject)
                          setSF('content', `${generatedTemplate.greeting}\n\n${generatedTemplate.body}\n\n${generatedTemplate.cta_text}\n\n${generatedTemplate.closing}`)
                        }
                      }}>
                      套用到當前步驟
                    </button>
                  </div>
                )}
              </div>

              {/* Subject Line Generator + CTA Generator side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 16, background: 'var(--bg-primary)' }}>
                  <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Mail size={14} /> 主旨行生成
                  </h4>
                  <button className="btn btn-secondary" onClick={onSubjectLines} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    <RefreshCw size={12} /> 生成 5 個建議
                  </button>
                  {subjectLines.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {subjectLines.map((line, i) => (
                        <div key={i} onClick={() => setSF('subject', line)}
                          style={{ padding: '8px 10px', fontSize: 12, border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer', background: stepForm.subject === line ? 'var(--bg-tertiary)' : 'var(--bg-secondary)', transition: 'background 0.1s' }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 16, background: 'var(--bg-primary)' }}>
                  <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Zap size={14} /> CTA 生成
                  </h4>
                  <button className="btn btn-secondary" onClick={onCTAVariations} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    <RefreshCw size={12} /> 生成 5 個變體
                  </button>
                  {ctaVariations.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {ctaVariations.map((cta, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-secondary)' }}>
                          <span className={`badge ${cta.style === 'urgent' ? 'badge-danger' : cta.style === 'primary' ? 'badge-success' : 'badge-info'}`} style={{ fontSize: 10 }}>{cta.style}</span>
                          <span>{cta.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Content Improver */}
              <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Edit3 size={16} style={{ color: '#f59e0b' }} /> 內容優化
                </h4>
                <textarea value={improveInput} onChange={e => setImproveInput(e.target.value)} placeholder="貼上或輸入要優化的內容..." rows={3}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical', marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {IMPROVEMENT_TYPES.map(t => (
                    <button key={t.id} onClick={() => setImproveType(t.id)}
                      className={`btn ${improveType === t.id ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: 11, padding: '4px 10px' }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary" onClick={onImprove} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Wand2 size={12} /> AI 優化
                </button>
                {improvedResult && (
                  <div style={{ marginTop: 12, padding: 14, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>改善項目:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                      {improvedResult.changes.map((c, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Check size={10} /> {c}
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', padding: 10, background: 'var(--bg-primary)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                      {improvedResult.improved}
                    </div>
                  </div>
                )}
              </div>

              {/* Template Score */}
              {templateScore && (
                <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <BarChart3 size={16} style={{ color: '#6366f1' }} /> 範本評分
                    <span style={{ fontSize: 24, fontWeight: 800, marginLeft: 'auto', color: templateScore.score >= 70 ? '#22c55e' : templateScore.score >= 40 ? '#f59e0b' : '#ef4444' }}>{templateScore.score}/100</span>
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {templateScore.breakdown.map((item, i) => (
                      <div key={i}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                          <span>{item.criterion}</span>
                          <span style={{ fontWeight: 600 }}>{item.score}/{item.max}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                          <div style={{ width: `${(item.score / item.max) * 100}%`, height: '100%', borderRadius: 3, background: (item.score / item.max) >= 0.7 ? '#22c55e' : (item.score / item.max) >= 0.4 ? '#f59e0b' : '#ef4444', transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{item.suggestion}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Design Preset Selector */}
              <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>設計風格預覽</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                  {Object.entries(EMAIL_DESIGN_PRESETS).map(([key, preset]) => (
                    <div key={key} onClick={() => setAiDesign(key)}
                      style={{ padding: 12, borderRadius: 10, border: aiDesign === key ? '2px solid var(--color-primary)' : '1px solid var(--border-medium)', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s' }}>
                      <div style={{ width: '100%', height: 48, borderRadius: 6, marginBottom: 8, background: preset.bgColor, border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: '60%', height: 8, borderRadius: 4, background: preset.primaryColor }} />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{preset.nameZh}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{preset.layoutDescription.substring(0, 16)}...</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Preview & Test */}
          {builderTab === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ display: 'flex', border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden' }}>
                  <button onClick={() => setPreviewDevice('desktop')}
                    style={{ padding: '6px 14px', fontSize: 12, fontWeight: previewDevice === 'desktop' ? 700 : 400, background: previewDevice === 'desktop' ? 'var(--color-primary)' : 'var(--bg-primary)', color: previewDevice === 'desktop' ? '#fff' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}>
                    桌面版
                  </button>
                  <button onClick={() => setPreviewDevice('mobile')}
                    style={{ padding: '6px 14px', fontSize: 12, fontWeight: previewDevice === 'mobile' ? 700 : 400, background: previewDevice === 'mobile' ? 'var(--color-primary)' : 'var(--bg-primary)', color: previewDevice === 'mobile' ? '#fff' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}>
                    手機版
                  </button>
                </div>
                <button className="btn btn-secondary" onClick={onSimulate} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Play size={12} /> 模擬執行
                </button>
                <button className="btn btn-primary" onClick={onSendTest} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Send size={12} /> {testSent ? '已發送測試信 ✓' : '發送測試信'}
                </button>
              </div>

              {/* Email Preview */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{
                  width: previewDevice === 'desktop' ? '100%' : 375,
                  maxWidth: '100%',
                  border: '1px solid var(--border-medium)',
                  borderRadius: previewDevice === 'mobile' ? 24 : 8,
                  overflow: 'hidden',
                  background: '#fff',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                  transition: 'width 0.3s',
                }}>
                  <div style={{ padding: '10px 16px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>B</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>我們的品牌</div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>noreply@brand.com</div>
                    </div>
                  </div>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                      {generatedTemplate?.subject || (steps[0]?.subject) || '(尚未設定主旨)'}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      {generatedTemplate?.preheader || '預覽文字會顯示在這裡'}
                    </div>
                  </div>
                  <div style={{ padding: '20px 16px', fontSize: 13, color: '#334155', lineHeight: 1.8, minHeight: 200, whiteSpace: 'pre-wrap' }}>
                    {generatedTemplate ? (
                      <>
                        <p>{generatedTemplate.greeting}</p>
                        <p style={{ marginTop: 12 }}>{generatedTemplate.body}</p>
                        <div style={{ textAlign: 'center', margin: '20px 0' }}>
                          <span style={{ display: 'inline-block', padding: '10px 28px', background: '#6366f1', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                            {generatedTemplate.cta_text}
                          </span>
                        </div>
                        <p>{generatedTemplate.closing}</p>
                      </>
                    ) : steps[0]?.content ? (
                      <p>{steps[0].content}</p>
                    ) : (
                      <p style={{ color: '#94a3b8', textAlign: 'center', paddingTop: 40 }}>使用「AI 範本助手」生成內容，或在流程設計中添加步驟後在此預覽</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Simulation Result */}
              {simulationResult && (
                <div style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 20, background: 'var(--bg-primary)' }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>模擬結果</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                    <div style={{ textAlign: 'center', padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{simulationResult.stats.total_contacts}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>聯絡人</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{simulationResult.stats.emails_to_send}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>待發Email</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{simulationResult.stats.line_messages || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>LINE訊息</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{simulationResult.stats.estimated_duration_days}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>預估天數</div>
                    </div>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>執行時間軸</div>
                  <div style={{ maxHeight: 200, overflow: 'auto' }}>
                    <table className="data-table" style={{ width: '100%', fontSize: 11 }}>
                      <thead>
                        <tr><th>聯絡人</th><th>步驟</th><th>動作</th><th>排程時間</th></tr>
                      </thead>
                      <tbody>
                        {simulationResult.timeline.slice(0, 20).map((t, i) => (
                          <tr key={i}>
                            <td>{t.contact_name}</td>
                            <td>#{t.step_index + 1}</td>
                            <td>{t.action}</td>
                            <td>{new Date(t.scheduled_at).toLocaleString('zh-TW')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {simulationResult.timeline.length > 20 && (
                    <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                      ...共 {simulationResult.timeline.length} 筆紀錄
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 24px', borderTop: '1px solid var(--border-subtle)' }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {builderTab < 3 && <button className="btn btn-secondary" onClick={() => setBuilderTab(builderTab + 1)}>下一步 <ChevronRight size={12} /></button>}
            <button className="btn btn-primary" onClick={onSave}>儲存活動</button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
