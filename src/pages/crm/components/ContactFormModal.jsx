import Modal, { Field } from '../../../components/Modal'

const CONTACT_TYPES = ['call', 'email', 'line', 'meeting']
const CONTACT_TYPE_LABELS = { call: '📞 電話', email: '📧 Email', line: '💬 LINE', meeting: '🤝 面談' }

export default function ContactFormModal({ contactForm, setC, onClose, onSubmit }) {
  return (
    <Modal title="新增互動紀錄" onClose={onClose} onSubmit={onSubmit} submitLabel="新增">
      <Field label="類型">
        <select className="form-input" style={{ width: '100%' }} value={contactForm.type} onChange={e => setC('type', e.target.value)}>
          {CONTACT_TYPES.map(t => <option key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
      <Field label="內容 *"><textarea className="form-input" style={{ width: '100%', minHeight: 80 }} placeholder="紀錄溝通內容..." value={contactForm.content} onChange={e => setC('content', e.target.value)} /></Field>
      <Field label="操作人"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="業務姓名" value={contactForm.operator} onChange={e => setC('operator', e.target.value)} /></Field>
    </Modal>
  )
}
