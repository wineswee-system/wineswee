import { useState } from 'react'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'

export default function BlankWorkflowModal({
  blankWorkflowForm,
  setBlankWorkflowForm,
  employees,
  stores,
  approvalChains = [],
  onClose,
  onSubmit,
}) {
  const [errors, setErrors] = useState({})

  const set = (k, v) => {
    setBlankWorkflowForm(p => ({ ...p, [k]: v }))
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }))
  }

  const handleSubmit = () => {
    const errs = {}
    if (!blankWorkflowForm.name?.trim()) errs.name = '流程名稱為必填'
    if (!blankWorkflowForm.planned_start_date) errs.planned_start_date = '計畫開始日期為必填'
    if (!blankWorkflowForm.planned_end_date) errs.planned_end_date = '預期完成日為必填'
    if (Object.keys(errs).length > 0) { setErrors(errs); return false }
    setErrors({})
    return onSubmit()
  }

  return (
    <Modal title="建立空白流程" onClose={onClose} onSubmit={handleSubmit} submitLabel="建立">
      <Field label="流程名稱" required error={!!errors.name} errorMsg={errors.name}>
        <input className="form-input" placeholder="例：新店開幕準備" autoFocus style={{ width: '100%' }}
          value={blankWorkflowForm.name}
          onChange={e => set('name', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit() } }}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="門市／地點">
          <select className="form-input" style={{ width: '100%' }} value={blankWorkflowForm.store} onChange={e => set('store', e.target.value)}>
            <option value="">— 選擇門市 —</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="負責人">
          <SearchableSelect
            value={blankWorkflowForm.assignee}
            onChange={(v) => set('assignee', v || '')}
            options={empOptions(employees, { keyBy: 'name' })}
            placeholder="搜尋負責人..."
          />
        </Field>
        <Field label="計畫開始" required error={!!errors.planned_start_date} errorMsg={errors.planned_start_date}>
          <input className="form-input" type="date" style={{ width: '100%' }}
            value={blankWorkflowForm.planned_start_date || ''}
            onChange={e => set('planned_start_date', e.target.value)} />
        </Field>
        <Field label="預期完成日" required error={!!errors.planned_end_date} errorMsg={errors.planned_end_date}>
          <input className="form-input" type="date" style={{ width: '100%' }}
            value={blankWorkflowForm.planned_end_date || ''}
            onChange={e => set('planned_end_date', e.target.value)} />
        </Field>
        <Field label="優先度">
          <select className="form-input" style={{ width: '100%' }} value={blankWorkflowForm.priority || '中'} onChange={e => set('priority', e.target.value)}>
            <option value="高">高</option>
            <option value="中">中</option>
            <option value="低">低</option>
          </select>
        </Field>
        <Field label="截止日期（選填）">
          <input className="form-input" type="date" style={{ width: '100%' }}
            value={blankWorkflowForm.due_date}
            onChange={e => set('due_date', e.target.value)} />
        </Field>
      </div>
      <Field label="整體完成後簽核鏈（選填）">
        <select className="form-input" style={{ width: '100%' }}
          value={blankWorkflowForm.completion_chain_id || ''}
          onChange={e => set('completion_chain_id', e.target.value || '')}>
          <option value="">不需要 — 所有任務完成即結案</option>
          {approvalChains.map(c => (
            <option key={c.id} value={c.id}>{c.name}（{c.steps?.length || 0} 關）</option>
          ))}
        </select>
        {blankWorkflowForm.completion_chain_id && (
          <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>
            ⚠ 所有任務完成後流程進入「待簽核」，需簽核通過才算結案
          </div>
        )}
      </Field>
      <Field label="備註（選填）">
        <textarea className="form-input" style={{ width: '100%', minHeight: 56, resize: 'vertical' }}
          placeholder="這個流程的背景說明..."
          value={blankWorkflowForm.notes || ''}
          onChange={e => set('notes', e.target.value)} />
      </Field>
    </Modal>
  )
}
