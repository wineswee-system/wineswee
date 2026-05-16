import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'

export default function BlankWorkflowModal({
  blankWorkflowForm,
  setBlankWorkflowForm,
  employees,
  stores,
  onClose,
  onSubmit,
}) {
  return (
    <Modal
      title="建立空白流程"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="建立"
    >
      <Field label="流程名稱" required>
        <input className="form-input" placeholder="例：新店開幕準備" autoFocus
          value={blankWorkflowForm.name}
          onChange={e => setBlankWorkflowForm(p => ({ ...p, name: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSubmit() } }}
        />
      </Field>
      <Field label="門市／地點">
        <select className="form-input" value={blankWorkflowForm.store} onChange={e => setBlankWorkflowForm(p => ({ ...p, store: e.target.value }))}>
          <option value="">— 選擇門市 —</option>
          {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="負責人">
        <SearchableSelect
          value={blankWorkflowForm.assignee}
          onChange={(v) => setBlankWorkflowForm(p => ({ ...p, assignee: v || '' }))}
          options={empOptions(employees, { keyBy: 'name' })}
          placeholder="搜尋負責人..."
        />
      </Field>
      <Field label="截止日期">
        <input className="form-input" type="date"
          value={blankWorkflowForm.due_date}
          onChange={e => setBlankWorkflowForm(p => ({ ...p, due_date: e.target.value }))}
        />
      </Field>
    </Modal>
  )
}
