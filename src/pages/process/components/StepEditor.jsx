import { useState } from 'react'
import { CheckSquare, Shield, FileText, Zap, ChevronDown, ChevronRight, GitBranch, GitMerge, Bell, Clock } from 'lucide-react'
import { Field } from '../../../components/Modal'
import BoundFormsField from '../../../components/tasks/BoundFormsField'

/**
 * Collapsible section used inside StepEditor for optional configuration blocks.
 */
function Section({ icon, label, color, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '9px 12px',
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg-secondary)', border: 'none',
          color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ color }}>{icon}</span>
        {label}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && (
        <div style={{ padding: '12px', background: 'var(--bg-card)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * StepEditor — Right-panel detail editor for a single SOP step.
 *
 * Props:
 *   step           — step data object (see sop_templates.steps schema)
 *   onChange       — (updatedStep) => void
 *   checklists     — Array<{ id, name, items }>
 *   approvalChains — Array<{ id, name, steps }>
 *   templates      — Array<{ id, name }> — for trigger picker (pass without current template)
 *   steps          — Array of all steps (for conditional branch pickers)
 *   stepIndex      — 0-based index of the current step (to exclude self from pickers)
 */
export default function StepEditor({ step, onChange, checklists = [], approvalChains = [], templates = [], steps = [], stepIndex = -1, departments = [], employees = [] }) {
  if (!step) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 10, color: 'var(--text-muted)',
        padding: 40,
      }}>
        <div style={{ fontSize: 44 }}>✏️</div>
        <div style={{ fontSize: 14 }}>點選左側步驟以編輯詳細內容</div>
      </div>
    )
  }

  const set = (k, v) => onChange({ ...step, [k]: v })

  // Helper for array fields: splits comma-separated string into trimmed, non-empty array
  const setArray = (k, rawValue) => {
    const arr = rawValue.split(',').map(s => s.trim()).filter(Boolean)
    onChange({ ...step, [k]: arr })
  }

  return (
    <div style={{ padding: '20px 28px', overflowY: 'auto', flex: 1 }}>

      {/* ── Basic fields ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <Field label="步驟名稱" required>
          <input
            className="form-input"
            type="text"
            style={{ width: '100%' }}
            placeholder="例：人事資料建檔"
            value={step.title}
            onChange={e => set('title', e.target.value)}
          />
        </Field>
        <Field label="優先度">
          <select
            className="form-input"
            style={{ width: '100%' }}
            value={step.priority}
            onChange={e => set('priority', e.target.value)}
          >
            <option value="高">高</option>
            <option value="中">中</option>
            <option value="低">低</option>
          </select>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <Field label="負責人">
          <input
            className="form-input"
            type="text"
            style={{ width: '100%' }}
            placeholder="例：王小明、人資主管"
            value={step.assignee || ''}
            onChange={e => set('assignee', e.target.value)}
          />
        </Field>
        <Field label="負責角色 / 部門">
          <select
            className="form-input"
            style={{ width: '100%' }}
            value={step.role || ''}
            onChange={e => set('role', e.target.value)}
          >
            <option value="">未指定</option>
            {departments.map(d => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
            {step.role && !departments.some(d => d.name === step.role) && (
              <option value={step.role}>{step.role}</option>
            )}
          </select>
        </Field>
      </div>

      <div style={{ marginBottom: 22 }}>
        <Field label="說明">
          <textarea
            className="form-input"
            style={{ width: '100%', minHeight: 80, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
            placeholder="詳細說明此步驟的工作內容、注意事項..."
            value={step.description}
            onChange={e => set('description', e.target.value)}
          />
        </Field>
      </div>

      {/* ── Advanced sections (each collapsible) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* 查核清單 */}
        <Section
          icon={<CheckSquare size={13} />}
          label="掛載查核清單"
          color="var(--accent-green)"
          defaultOpen={!!step.checklist_id}
        >
          <Field label="選擇清單">
            <select
              className="form-input"
              style={{ width: '100%' }}
              value={step.checklist_id || ''}
              onChange={e => set('checklist_id', e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">無</option>
              {checklists.map(cl => (
                <option key={cl.id} value={cl.id}>
                  {cl.name}（{cl.items ?? 0} 項）
                </option>
              ))}
            </select>
          </Field>
        </Section>

        {/* 簽核鏈 */}
        <Section
          icon={<Shield size={13} />}
          label="步驟完成後需要簽核"
          color="var(--accent-purple)"
          defaultOpen={!!step.approval_chain_id}
        >
          <Field label="簽核鏈">
            <select
              className="form-input"
              style={{ width: '100%' }}
              value={step.approval_chain_id || ''}
              onChange={e => set('approval_chain_id', e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">不需要</option>
              {approvalChains.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.steps ?? 0} 關）
                </option>
              ))}
            </select>
          </Field>
        </Section>

        {/* 必填表單 */}
        <Section
          icon={<FileText size={13} />}
          label="必填表單（完成此步驟前需填完）"
          color="var(--accent-cyan)"
          defaultOpen={(step.required_forms?.length || 0) > 0}
        >
          <BoundFormsField
            value={step.required_forms || []}
            onChange={v => set('required_forms', v)}
            employees={employees}
            templateMode
          />
        </Section>

        {/* 完成後觸發另一流程 */}
        <Section
          icon={<Zap size={13} />}
          label="完成後自動觸發另一流程"
          color="var(--accent-orange)"
          defaultOpen={!!step.trigger_template_id}
        >
          <Field label="觸發流程範本">
            <select
              className="form-input"
              style={{ width: '100%' }}
              value={step.trigger_template_id || ''}
              onChange={e => set('trigger_template_id', e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">不觸發</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            此步驟完成後，系統自動建立新的流程實例（最多觸發 5 層）
          </div>
        </Section>

        {/* 條件分支 — 只有設了簽核鏈才有意義 */}
        {step.approval_chain_id && steps.length > 1 && (
          <Section
            icon={<GitBranch size={13} />}
            label="條件分支（核准 / 退回後跳至…）"
            color="var(--accent-red)"
            defaultOpen={!!(step.branch_on_approved || step.branch_on_rejected)}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="✅ 核准後繼續">
                <select
                  className="form-input"
                  style={{ width: '100%' }}
                  value={step.branch_on_approved || ''}
                  onChange={e => set('branch_on_approved', e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">順序執行（預設）</option>
                  {steps.map((s, i) => i === stepIndex ? null : (
                    <option key={i} value={i + 1}>
                      步驟 {i + 1}：{s.title || '（未命名）'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="❌ 退回後跳至">
                <select
                  className="form-input"
                  style={{ width: '100%' }}
                  value={step.branch_on_rejected || ''}
                  onChange={e => set('branch_on_rejected', e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">停留此步驟（預設）</option>
                  {steps.map((s, i) => i === stepIndex ? null : (
                    <option key={i} value={i + 1}>
                      步驟 {i + 1}：{s.title || '（未命名）'}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
              核准後若有設定跳轉，系統會直接啟動目標步驟（繞過中間步驟）。退回後可指定重工或補件的起點步驟。
            </div>
          </Section>
        )}

        {/* 通知設定 */}
        <Section
          icon={<Bell size={13} />}
          label="通知設定"
          color="var(--accent-blue)"
          defaultOpen={(step.notify_on_start?.length > 0) || (step.notify_on_complete?.length > 0)}
        >
          <Field label="步驟開始時通知">
            <input
              className="form-input"
              type="text"
              style={{ width: '100%' }}
              placeholder="例：王小明, 人資主管, 業務部"
              value={(step.notify_on_start || []).join(', ')}
              onChange={e => setArray('notify_on_start', e.target.value)}
            />
          </Field>
          <div style={{ marginTop: 10 }}>
            <Field label="步驟完成時通知">
              <input
                className="form-input"
                type="text"
                style={{ width: '100%' }}
                placeholder="例：王小明, 人資主管, 業務部"
                value={(step.notify_on_complete || []).join(', ')}
                onChange={e => setArray('notify_on_complete', e.target.value)}
              />
            </Field>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            輸入姓名或角色，多筆以逗號分隔
          </div>
        </Section>

        {/* 時間設定 */}
        <Section
          icon={<Clock size={13} />}
          label="時間設定"
          color="var(--accent-orange)"
          defaultOpen={step.relative_due_days != null}
        >
          <Field label="相對截止天數（前步驟完成後 N 天）">
            <input
              className="form-input"
              type="number"
              min={0}
              max={365}
              style={{ width: '100%' }}
              placeholder="例：3"
              value={step.relative_due_days ?? ''}
              onChange={e => {
                const raw = e.target.value
                set('relative_due_days', raw === '' ? null : Math.min(365, Math.max(0, Number(raw))))
              }}
            />
          </Field>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            留空表示不設定自動截止日
          </div>
        </Section>

        {/* 前置條件 */}
        <Section
          icon={<GitMerge size={13} />}
          label="前置條件"
          color="var(--accent-red)"
          defaultOpen={(step.preconditions?.length > 0)}
        >
          <Field label="條件清單">
            <textarea
              className="form-input"
              style={{ width: '100%', minHeight: 80, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
              placeholder={'例：前一步驟已核准\n倉庫已備料完成'}
              value={(step.preconditions || []).join('\n')}
              onChange={e => set('preconditions', e.target.value.split('\n').filter(Boolean))}
            />
          </Field>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            每行一條條件（目前為純文字，未來版本將支援自動判斷）
          </div>
        </Section>

      </div>
    </div>
  )
}

