import { useState, useEffect } from 'react'
import { ShieldCheck, X as XIcon } from 'lucide-react'
import Modal, { Field } from '../Modal'
import SearchableSelect, { empOptions } from '../SearchableSelect'
import BoundFormsField from './BoundFormsField'

/**
 * 通用快速建任務 Modal — 給 Projects / 其他需要快速建任務的地方共用
 *
 * Props:
 *   open      — bool
 *   title     — 顯示用 modal 標題（例「新增工作流程任務」/「新增專案任務」）
 *   employees — 員工清單
 *   stores    — 門市清單（可不傳，內部會接收）
 *   defaultStore — 預設門市名稱
 *   onClose   — () => void
 *   onSubmit  — (formData) => Promise<boolean>  回 true 代表成功 modal 自關
 */
export default function TaskQuickCreateModal({
  open, title = '新增任務', employees = [], stores = [],
  defaultStore = '', approvalChains = [], departments = [], onClose, onSubmit,
}) {
  const [form, setForm] = useState(initialForm(defaultStore))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (open) {
      setForm(initialForm(defaultStore))
      setErrors({})
    }
  }, [open, defaultStore])

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }))
  }

  const handleSubmit = async () => {
    const errs = {}
    if (!form.title.trim()) errs.title = '任務名稱必填'
    if (!form.assignee) errs.assignee = '負責人為必填'
    if (!form.due_date) errs.due_date = '截止日期必填'
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setSaving(true)
    const ok = await onSubmit(form)
    setSaving(false)
    if (ok) onClose()
  }

  if (!open) return null

  return (
    <Modal title={title} onClose={onClose} onSubmit={handleSubmit} submitLabel={saving ? '儲存中…' : '建立'}>
      <Field label="任務名稱" required error={!!errors.title} errorMsg={errors.title}>
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：電力申請"
          value={form.title} onChange={e => set('title', e.target.value)} autoFocus />
      </Field>

      <Field label="說明">
        <textarea className="form-input" rows={2} style={{ width: '100%', resize: 'vertical' }}
          placeholder="任務細節（選填）"
          value={form.description} onChange={e => set('description', e.target.value)} />
      </Field>

      {stores.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="門市／地點">
            <select className="form-input" style={{ width: '100%' }} value={form.store} onChange={e => set('store', e.target.value)}>
              <option value="">未指定</option>
              {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="負責人" required error={!!errors.assignee} errorMsg={errors.assignee}>
            <SearchableSelect
              value={form.assignee}
              onChange={v => { set('assignee', v || '') }}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋負責人..."
            />
          </Field>
        </div>
      ) : (
        <Field label="負責人" required error={!!errors.assignee} errorMsg={errors.assignee}>
          <SearchableSelect
            value={form.assignee}
            onChange={v => { set('assignee', v || '') }}
            options={empOptions(employees, { keyBy: 'name' })}
            placeholder="搜尋負責人..."
          />
        </Field>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="優先級">
          <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
            <option value="高">高</option>
            <option value="中">中</option>
            <option value="低">低</option>
          </select>
        </Field>
        <Field label="計畫開始">
          <input className="form-input" type="date" style={{ width: '100%' }}
            value={form.planned_start} onChange={e => set('planned_start', e.target.value)} />
        </Field>
        <Field label="截止日期" required error={!!errors.due_date} errorMsg={errors.due_date}>
          <input className="form-input" type="date" style={{ width: '100%' }}
            value={form.due_date} onChange={e => set('due_date', e.target.value)} />
        </Field>
      </div>

      <Field label="角色（選填）">
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：店長 / 督導"
          value={form.role} onChange={e => set('role', e.target.value)} />
      </Field>

      {/* 簽核設定（對齊獨立任務頁：無 / 指定人員 / 簽核鏈） */}
      <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>🛡️ 完成簽核（選填）</div>
        <Field label="完成方式">
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ v: 'none', l: '免簽核' }, { v: 'people', l: '指定人員' }, { v: 'chain', l: '簽核鏈' }].map(opt => {
              const active = form.approval_mode === opt.v
              return (
                <button type="button" key={opt.v} onClick={() => set('approval_mode', opt.v)}
                  style={{
                    flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: active ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
                    background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                    color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  }}>
                  {opt.l}
                </button>
              )
            })}
          </div>
        </Field>
        {form.approval_mode === 'people' && (
          <>
            <Field label="加入審批人員">
              <SearchableSelect value=""
                onChange={(name) => { if (!name) return; set('confirmation_approvers', [...(form.confirmation_approvers || []).filter(x => x !== name), name]) }}
                options={empOptions(employees.filter(e => !(form.confirmation_approvers || []).includes(e.name)), { keyBy: 'name' })}
                placeholder="🔍 搜尋姓名 / 職稱..." />
            </Field>
            {(form.confirmation_approvers || []).length > 0 && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {form.confirmation_approvers.map(name => (
                    <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 14, fontSize: 12, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', border: '1px solid var(--accent-purple)' }}>
                      <ShieldCheck size={11} /> {name}
                      <button type="button" onClick={() => set('confirmation_approvers', form.confirmation_approvers.filter(x => x !== name))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-purple)', padding: 0, lineHeight: 1 }}>
                        <XIcon size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                {form.confirmation_approvers.length > 1 && (
                  <Field label="多人簽核模式">
                    <select className="form-input" style={{ width: '100%' }} value={form.confirmation_mode} onChange={e => set('confirmation_mode', e.target.value)}>
                      <option value="parallel">並簽（任一人通過即可）</option>
                      <option value="sequential">會簽（每個人都要通過）</option>
                    </select>
                  </Field>
                )}
              </>
            )}
          </>
        )}
        {form.approval_mode === 'chain' && (
          <Field label="選擇簽核鏈">
            <select className="form-input" style={{ width: '100%' }} value={form.approval_chain_id} onChange={e => set('approval_chain_id', e.target.value)}>
              <option value="">— 請選擇 —</option>
              {approvalChains.map(c => (
                <option key={c.id} value={c.id}>{c.name}（{c.steps?.length || 0} 關）</option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {/* 綁定表單 + 每張誰來填（自己填 / 他人填） */}
      <BoundFormsField
        value={form.required_forms || []}
        onChange={v => set('required_forms', v)}
        employees={employees}
        defaultAssigneeId={employees.find(e => e.name === form.assignee)?.id || null}
      />

      {/* 指派其他部門處理（開跨部門工單） */}
      <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>🏢 指派其他部門處理（選填）</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          選了目標部門 → 這個任務會自動開一張<b>跨部門工單</b>給對方。對方受理處理完成後，此任務<b>自動關閉</b>（在那之前不能手動改完成）。
        </div>
        <select className="form-input" style={{ width: '100%' }} value={form.target_department_id} onChange={e => set('target_department_id', e.target.value)}>
          <option value="">不指派其他部門（一般任務）</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
    </Modal>
  )
}

function initialForm(defaultStore) {
  return {
    title: '', description: '', assignee: '', store: defaultStore || '',
    priority: '中', planned_start: '', due_date: '', role: '',
    required_forms: [],
    target_department_id: '',   // 指派其他部門 → 建跨部門工單
    // 簽核設定（對齊獨立任務頁）
    approval_mode: 'none', confirmation_approvers: [], confirmation_mode: 'parallel', approval_chain_id: '',
  }
}
