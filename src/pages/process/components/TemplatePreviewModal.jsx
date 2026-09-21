import { CheckSquare, Shield, FileText, Zap, X, Bell } from 'lucide-react';

// Priority label map
const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLOR = {
  high: 'var(--accent-red)',
  medium: 'var(--accent-orange)',
  low: 'var(--accent-green)',
};

// Status badge config
const STATUS_CFG = {
  draft:     { label: '草稿',   color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  published: { label: '已發佈', color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  archived:  { label: '已封存', color: 'var(--text-muted)',    dim: 'var(--bg-secondary)' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: cfg.dim,
        color: cfg.color,
      }}
    >
      {cfg.label}
    </span>
  );
}

function FeatureBadge({ icon: Icon, label, color, dimColor }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.72rem',
        fontWeight: 500,
        background: dimColor,
        color: color,
      }}
    >
      <Icon size={11} />
      {label}
    </span>
  );
}

function StepCard({ step, index, checklists, approvalChains, isLast }) {
  const stepChecklists = checklists.filter(
    (c) => Array.isArray(step.checklist_ids)
      ? step.checklist_ids.includes(c.id)
      : step.checklist_id === c.id
  );

  const stepApprovalChain = approvalChains.find(
    (a) => a.id === step.approval_chain_id
  );

  const hasForms    = Array.isArray(step.required_forms) && step.required_forms.length > 0;
  const hasTrigger  = step.trigger_process_id || step.trigger_template_id;
  const notifyStart = Array.isArray(step.notify_on_start) && step.notify_on_start.length > 0;
  const notifyDone  = Array.isArray(step.notify_on_complete) && step.notify_on_complete.length > 0;
  const hasTags     = Array.isArray(step.tags) && step.tags.length > 0;

  const priority      = step.priority ?? step.priority_level;
  const priorityLabel = PRIORITY_LABEL[priority] ?? priority;
  const priorityColor = PRIORITY_COLOR[priority] ?? 'var(--text-muted)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
      {/* Step card */}
      <div
        style={{
          display: 'flex',
          gap: '14px',
          padding: '14px 16px',
          borderRadius: '10px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        {/* Step number circle */}
        <div
          style={{
            flexShrink: 0,
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: 'var(--accent-cyan)',
            color: '#fff', /* inverse text on accent-cyan */
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 700,
            marginTop: '1px',
          }}
        >
          {index + 1}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '4px',
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: '0.95rem',
                color: 'var(--text-primary)',
              }}
            >
              {step.title ?? step.name}
            </span>

            {step.role && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                角色: {step.role}
              </span>
            )}

            {priority && (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: priorityColor,
                  background: 'transparent',
                  border: `1px solid ${priorityColor}`,
                  padding: '1px 6px',
                  borderRadius: '9999px',
                }}
              >
                優先: {priorityLabel}
              </span>
            )}
          </div>

          {/* Description */}
          {step.description && (
            <p
              style={{
                margin: '0 0 8px 0',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              {step.description}
            </p>
          )}

          {/* Feature badges */}
          {(stepChecklists.length > 0 || stepApprovalChain || hasForms || hasTrigger || notifyStart || notifyDone) && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                marginBottom: hasTags ? '8px' : 0,
              }}
            >
              {stepChecklists.map((cl) => (
                <FeatureBadge
                  key={cl.id}
                  icon={CheckSquare}
                  label={`${cl.name}${cl.items?.length ? ` (${cl.items.length} 項)` : ''}`}
                  color="var(--accent-green)"
                  dimColor="var(--accent-green-dim)"
                />
              ))}

              {stepApprovalChain && (
                <FeatureBadge
                  icon={Shield}
                  label={`簽核: ${stepApprovalChain.name}`}
                  color="var(--accent-purple)"
                  dimColor="var(--accent-purple-dim)"
                />
              )}

              {hasForms &&
                step.required_forms.map((form, fi) => (
                  <FeatureBadge
                    key={fi}
                    icon={FileText}
                    label={typeof form === 'string' ? form : (form.name ?? '表單')}
                    color="var(--accent-cyan)"
                    dimColor="var(--accent-cyan-dim)"
                  />
                ))}

              {hasTrigger && (
                <FeatureBadge
                  icon={Zap}
                  label={step.trigger_label ?? '觸發動作'}
                  color="var(--accent-orange)"
                  dimColor="var(--accent-orange-dim)"
                />
              )}

              {notifyStart && (
                <FeatureBadge
                  icon={Bell}
                  label="步驟開始通知"
                  color="var(--accent-blue)"
                  dimColor="var(--accent-blue-dim)"
                />
              )}

              {notifyDone && (
                <FeatureBadge
                  icon={Bell}
                  label="步驟完成通知"
                  color="var(--accent-blue)"
                  dimColor="var(--accent-blue-dim)"
                />
              )}
            </div>
          )}

          {/* Step-level tags */}
          {hasTags && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {step.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: '0.7rem',
                    padding: '1px 7px',
                    borderRadius: '9999px',
                    background: 'var(--accent-purple-dim)',
                    color: 'var(--accent-purple)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Relative due days */}
          {step.relative_due_days != null && (
            <p
              style={{
                margin: '6px 0 0 0',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
              }}
            >
              ⏱ 前步驟完成後 {step.relative_due_days} 天
            </p>
          )}
        </div>
      </div>

      {/* Arrow connector between steps */}
      {!isLast && (
        <div
          style={{
            textAlign: 'center',
            fontSize: '1.1rem',
            color: 'var(--text-muted)',
            lineHeight: '28px',
            userSelect: 'none',
          }}
        >
          ↓
        </div>
      )}
    </div>
  );
}

export default function TemplatePreviewModal({
  template,
  usageCount,
  checklists = [],
  approvalChains = [],
  onClose,
  onEdit,
  onDuplicate,
  onDeploy,
}) {
  if (!template) return null;

  const steps = Array.isArray(template.steps) ? template.steps : [];

  return (
    /* Full-screen overlay */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      {/* Dialog panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '14px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: '18px 20px 0 20px',
            flexShrink: 0,
          }}
        >
          {/* Title + close row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '1.15rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.3,
              }}
            >
              {template.name}
              <span
                style={{
                  fontWeight: 400,
                  color: 'var(--text-muted)',
                  marginLeft: '8px',
                }}
              >
                — 預覽
              </span>
            </h2>

            <button
              onClick={onClose}
              aria-label="關閉"
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <X size={18} />
            </button>
          </div>

          {/* Subheader meta row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '6px',
              marginTop: '6px',
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
            }}
          >
            {template.category && (
              <>
                <span>{template.category}</span>
                <span>·</span>
              </>
            )}
            <span>{steps.length} 步驟</span>
            {usageCount != null && (
              <>
                <span>·</span>
                <span>已部署 {usageCount} 次</span>
              </>
            )}
            {template.status && (
              <>
                <span>·</span>
                <StatusBadge status={template.status} />
              </>
            )}
          </div>

          {/* Template-level tags */}
          {Array.isArray(template.tags) && template.tags.length > 0 && (
            <div
              style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}
            >
              {template.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: '0.7rem',
                    padding: '1px 7px',
                    borderRadius: '9999px',
                    background: 'var(--accent-purple-dim)',
                    color: 'var(--accent-purple)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Divider */}
          <div
            style={{
              marginTop: '14px',
              height: '1px',
              background: 'var(--border-primary)',
            }}
          />
        </div>

        {/* ── Scrollable body ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0',
          }}
        >
          {/* Template description */}
          {template.description && (
            <p
              style={{
                margin: '0 0 16px 0',
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--text-muted)', marginRight: '6px' }}>
                說明:
              </span>
              {template.description}
            </p>
          )}

          {/* Step list */}
          {steps.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              此範本尚無步驟
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {steps.map((step, idx) => (
                <StepCard
                  key={step.id ?? idx}
                  step={step}
                  index={idx}
                  checklists={checklists}
                  approvalChains={approvalChains}
                  isLast={idx === steps.length - 1}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid var(--border-primary)',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <button
            onClick={onEdit}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
          >
            編輯
          </button>

          <button
            onClick={onDuplicate}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
          >
            複製此範本
          </button>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          <button
            onClick={onDeploy}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--accent-cyan)',
              color: '#fff', /* inverse text on accent-cyan background */
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            部署此流程 →
          </button>
        </div>
      </div>
    </div>
  );
}
