import Modal, { Field } from '../../../components/Modal'

const STATUSES = ['待處理', '處理中', '待客戶回覆', '已解決', '已關閉']

/**
 * BulkActionModal — bulk status update, assignee, or merge for selected tickets.
 *
 * Props:
 *   open             boolean
 *   onClose          () => void
 *   bulkAction       'status' | 'assignee' | 'merge' | ''
 *   bulkValue        string
 *   setBulkValue     (v) => void
 *   selected         Set<id>
 *   tickets          array
 *   agents           string[]
 *   onExecute        () => void
 */
export default function BulkActionModal({
  open, onClose,
  bulkAction, bulkValue, setBulkValue,
  selected, tickets, agents,
  onExecute,
}) {
  if (!open) return null

  return (
    <Modal
      title={bulkAction === 'merge' ? `合併 ${selected.size} 筆工單` : `批次${bulkAction === 'status' ? '更新狀態' : '指派負責人'}`}
      onClose={onClose}
      onSubmit={onExecute}
      submitLabel={bulkAction === 'merge' ? '確定合併' : '套用'}
    >
      {bulkAction === 'status' && (
        <Field label="新狀態">
          <select className="form-input" style={{ width: '100%' }} value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
            <option value="">請選擇</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
      )}
      {bulkAction === 'assignee' && (
        <Field label="負責客服">
          <select className="form-input" style={{ width: '100%' }} value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
            <option value="">請選擇</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
      )}
      {bulkAction === 'merge' && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          <p>將以下工單合併為一張：</p>
          <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
            {[...selected].map((id, i) => (
              <li key={id} style={{ fontWeight: i === 0 ? 700 : 400 }}>
                #{String(id).padStart(4, '0')} {tickets.find(t => t.id === id)?.subject}
                {i === 0 && <span style={{ color: 'var(--accent-cyan)', marginLeft: 4 }}>(主工單)</span>}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>第一張為主工單，其餘將被關閉。</p>
        </div>
      )}
    </Modal>
  )
}
