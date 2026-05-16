import Modal, { Field } from '../../../components/Modal'
import { Users } from 'lucide-react'
import { autoAssignTicket } from '../../../lib/crmEngine'

const TICKET_TYPES = ['商品瑕疵', '出貨錯誤', '退換貨', '付款問題', '諮詢', '其他']
const PRIORITIES = ['緊急', '高', '一般', '低']
const CHANNELS = [
  { value: '電話' },
  { value: 'Email' },
  { value: 'LINE' },
  { value: '表單' },
  { value: '手動' },
]

/**
 * TicketFormModal — create/edit ticket form modal
 * Props:
 *   open       boolean
 *   onClose    () => void
 *   form       object  (ticket form state)
 *   setForm    (updater) => void
 *   employees  array (unused, kept for future assignee search)
 *   locations  array
 *   customers  array
 *   deals      array
 *   agents     string[]
 *   tickets    array  (for auto-assign preview)
 *   onSubmit   () => void
 */
export default function TicketFormModal({ open, onClose, form, setForm, employees, locations, customers, deals, agents, tickets, onSubmit }) {
  if (!open) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title="新增客服工單" onClose={onClose} onSubmit={onSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="客戶名稱" required>
          <input className="form-input" type="text" style={{ width: '100%' }} list="cust-list" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
          <datalist id="cust-list">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist>
        </Field>
        <Field label="所屬分店">
          <select className="form-input" style={{ width: '100%' }} value={form.location_id} onChange={e => set('location_id', e.target.value)}>
            <option value="">請選擇分店</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="主旨" required>
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="問題簡述..." value={form.subject} onChange={e => set('subject', e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="類型">
          <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
            {TICKET_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="優先度">
          <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="來源管道">
          <select className="form-input" style={{ width: '100%' }} value={form.channel} onChange={e => set('channel', e.target.value)}>
            {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.value}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="負責客服">
          <select className="form-input" style={{ width: '100%' }} value={form.assignee} onChange={e => set('assignee', e.target.value)}>
            <option value="">自動分配 (Round-Robin)</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="關聯商機">
          <select className="form-input" style={{ width: '100%' }} value={form.deal_id} onChange={e => set('deal_id', e.target.value)}>
            <option value="">無</option>
            {deals.map(d => <option key={d.id} value={d.id}>{d.name}{d.customer_name ? ` (${d.customer_name})` : ''}</option>)}
          </select>
        </Field>
      </div>
      <Field label="問題描述">
        <textarea className="form-input" style={{ width: '100%', minHeight: 80 }} value={form.description} onChange={e => set('description', e.target.value)} />
      </Field>
      {!form.assignee && (
        <div style={{ fontSize: 12, color: 'var(--accent-cyan)', padding: '6px 10px', borderRadius: 8, background: 'var(--glass-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={13} /> 未選擇負責人，將自動以 Round-Robin 分配給：<strong>{autoAssignTicket(agents, tickets) || '(無可用人員)'}</strong>
        </div>
      )}
    </Modal>
  )
}
