import { useState, useEffect } from 'react'
import Modal, { Field } from '../Modal'
import SearchableSelect, { empOptions } from '../SearchableSelect'
import FormBindingsPicker from '../FormBindingsPicker'

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
  defaultStore = '', onClose, onSubmit,
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="負責人">
          <SearchableSelect
            value={form.assignee}
            onChange={v => set('assignee', v || '')}
            options={empOptions(employees, { keyBy: 'name' })}
            placeholder="搜尋負責人..."
          />
        </Field>
        {stores.length > 0 && (
          <Field label="門市">
            <select className="form-input" style={{ width: '100%' }} value={form.store} onChange={e => set('store', e.target.value)}>
              <option value="">未指定</option>
              {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
        )}
      </div>

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

      {/* 綁定表單 */}
      <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>📋 綁定表單（選填）</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          執行人需填完選定的表單，全部完成才能完成此任務
        </div>
        <FormBindingsPicker
          value={form.required_forms || []}
          onChange={v => set('required_forms', v)}
        />
      </div>
    </Modal>
  )
}

function initialForm(defaultStore) {
  return {
    title: '', description: '', assignee: '', store: defaultStore || '',
    priority: '中', planned_start: '', due_date: '', role: '',
    required_forms: [],
  }
}
