import { useState } from 'react'
import { X, ChevronLeft, ChevronRight, CheckSquare, Shield, FileText, Zap, Bell, User, AlertCircle, Play } from 'lucide-react'

const PRIORITY_COLOR = {
  高: 'var(--accent-red)',
  中: 'var(--accent-orange)',
  低: 'var(--accent-green)',
  high: 'var(--accent-red)',
  medium: 'var(--accent-orange)',
  low: 'var(--accent-green)',
}

function FeaturePill({ icon: Icon, label, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: `${color}22`, color,
    }}>
      <Icon size={11} /> {label}
    </span>
  )
}

function StepSimulation({ step, index, total, checklists = [], approvalChains = [] }) {
  const checklist = checklists.find(c => c.id === step.checklist_id)
  const chain = approvalChains.find(c => c.id === step.approval_chain_id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Step header */}
      <div style={{
        padding: '14px 16px', borderRadius: 10,
        background: 'var(--bg-card)', border: '1.5px solid var(--accent-cyan)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: 'var(--accent-cyan)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
            }}>
              {index + 1}
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              {step.title || '（未命名步驟）'}
            </span>
          </div>
          {step.priority && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
              background: `${PRIORITY_COLOR[step.priority]}22`, color: PRIORITY_COLOR[step.priority],
            }}>
              {step.priority}
            </span>
          )}
        </div>

        {step.description && (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px 32px', lineHeight: 1.5 }}>
            {step.description}
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 32 }}>
          {step.role && <FeaturePill icon={User} label={`角色：${step.role}`} color="var(--accent-blue)" />}
          {step.assignee && <FeaturePill icon={User} label={`指定：${step.assignee}`} color="var(--accent-purple)" />}
        </div>
      </div>

      {/* What would happen — simulation rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Forms */}
        {step.required_forms?.length > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <FileText size={13} color="var(--accent-cyan)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)' }}>必填表單</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 20 }}>
              {step.required_forms.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-cyan)', flexShrink: 0 }} />
                  {f.label || f.name || f}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, paddingLeft: 20 }}>
              完成此步驟前必須填寫以上表單
            </div>
          </div>
        )}

        {/* Checklist */}
        {checklist && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <CheckSquare size={13} color="var(--accent-green)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-green)' }}>清單：{checklist.name}</span>
            </div>
            {checklist.items?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 20 }}>
                {checklist.items.slice(0, 5).map((item, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-green)', flexShrink: 0 }} />
                    {item.label || item}
                  </div>
                ))}
                {checklist.items.length > 5 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>...還有 {checklist.items.length - 5} 項</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Approval chain */}
        {chain && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--accent-purple-dim)', border: '1px solid var(--accent-purple)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Shield size={13} color="var(--accent-purple)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-purple)' }}>簽核：{chain.name}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 20 }}>
              {chain.steps ? `${chain.steps} 個簽核步驟` : '需主管簽核才能完成此步驟'}
            </div>
          </div>
        )}

        {/* Trigger */}
        {step.trigger_template_id && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={13} color="var(--accent-orange)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-orange)' }}>完成後自動觸發其他工作流</span>
            </div>
          </div>
        )}

        {/* Notifications */}
        {((step.notify_on_start?.length > 0) || (step.notify_on_complete?.length > 0)) && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Bell size={13} color="var(--text-muted)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>通知</span>
            </div>
            {step.notify_on_start?.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 20 }}>
                開始時通知：{step.notify_on_start.join('、')}
              </div>
            )}
            {step.notify_on_complete?.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 20, marginTop: 2 }}>
                完成時通知：{step.notify_on_complete.join('、')}
              </div>
            )}
          </div>
        )}

        {/* No features */}
        {!step.required_forms?.length && !checklist && !chain && !step.trigger_template_id &&
          !step.notify_on_start?.length && !step.notify_on_complete?.length && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
            此步驟無特殊要求，完成後直接進入下一步
          </div>
        )}

        {/* Branch preview */}
        {(step.branch_on_approved || step.branch_on_rejected) && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>分支路徑</div>
            {step.branch_on_approved && (
              <div style={{ fontSize: 11, color: 'var(--accent-green)', paddingLeft: 8 }}>
                ✓ 通過 → {step.branch_on_approved}
              </div>
            )}
            {step.branch_on_rejected && (
              <div style={{ fontSize: 11, color: 'var(--accent-red)', paddingLeft: 8, marginTop: 3 }}>
                ✗ 退回 → {step.branch_on_rejected}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        步驟 {index + 1} / {total}
      </div>
    </div>
  )
}

export default function ShadowDeployModal({ template, checklists = [], approvalChains = [], onClose }) {
  const steps = template?.steps?.filter(s => s.title?.trim()) || []
  const [current, setCurrent] = useState(0)

  if (!template) return null

  const step = steps[current]

  const summary = {
    total: steps.length,
    withForms: steps.filter(s => s.required_forms?.length > 0).length,
    withApproval: steps.filter(s => s.approval_chain_id).length,
    withChecklist: steps.filter(s => s.checklist_id).length,
    withTrigger: steps.filter(s => s.trigger_template_id).length,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: 540, maxHeight: '90vh',
        background: 'var(--bg-primary)', borderRadius: 14, display: 'flex', flexDirection: 'column',
        border: '1px solid var(--border-medium)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 20px 14px',
          borderBottom: '1px solid var(--border-subtle)', gap: 12,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <Play size={15} color="var(--accent-cyan)" />
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                模擬部署：{template.name}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              此為預覽模式，不會建立任何實際任務或記錄
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Summary chips */}
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            共 <b style={{ color: 'var(--text-primary)' }}>{summary.total}</b> 步驟
          </span>
          {summary.withForms > 0 && <FeaturePill icon={FileText} label={`${summary.withForms} 個表單`} color="var(--accent-cyan)" />}
          {summary.withApproval > 0 && <FeaturePill icon={Shield} label={`${summary.withApproval} 個簽核`} color="var(--accent-purple)" />}
          {summary.withChecklist > 0 && <FeaturePill icon={CheckSquare} label={`${summary.withChecklist} 個清單`} color="var(--accent-green)" />}
          {summary.withTrigger > 0 && <FeaturePill icon={Zap} label={`${summary.withTrigger} 個觸發`} color="var(--accent-orange)" />}
        </div>

        {/* Step progress bar */}
        <div style={{ height: 3, background: 'var(--bg-secondary)' }}>
          <div style={{
            height: '100%', background: 'var(--accent-cyan)', transition: 'width 0.3s',
            width: steps.length > 0 ? `${((current + 1) / steps.length) * 100}%` : '0%',
          }} />
        </div>

        {/* Step content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {steps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <AlertCircle size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
              <div>此範本沒有有效的步驟</div>
            </div>
          ) : (
            <StepSimulation
              step={step}
              index={current}
              total={steps.length}
              checklists={checklists}
              approvalChains={approvalChains}
            />
          )}
        </div>

        {/* Navigation footer */}
        {steps.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px',
            borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
          }}>
            <button
              type="button"
              onClick={() => setCurrent(p => Math.max(0, p - 1))}
              disabled={current === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px',
                borderRadius: 8, border: '1px solid var(--border-medium)',
                background: 'var(--bg-card)', color: current === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                cursor: current === 0 ? 'not-allowed' : 'pointer', fontSize: 13,
              }}
            >
              <ChevronLeft size={15} /> 上一步
            </button>

            {/* Step dots */}
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {steps.slice(0, 10).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrent(i)}
                  style={{
                    width: i === current ? 18 : 8, height: 8, borderRadius: 4,
                    background: i === current ? 'var(--accent-cyan)' : 'var(--border-medium)',
                    border: 'none', cursor: 'pointer', padding: 0,
                    transition: 'all 0.2s',
                  }}
                />
              ))}
              {steps.length > 10 && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{steps.length - 10}</span>
              )}
            </div>

            {current < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrent(p => Math.min(steps.length - 1, p + 1))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px',
                  borderRadius: 8, background: 'var(--accent-cyan)', border: 'none',
                  color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >
                下一步 <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px',
                  borderRadius: 8, background: 'var(--accent-green)', border: 'none',
                  color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >
                完成預覽
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
