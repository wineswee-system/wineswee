import Modal, { Field } from '../../../components/Modal'

/**
 * ResignRehireModal — handles both employee resign and rehire in one component.
 *
 * Props:
 *   mode            'resign' | 'rehire'
 *   open            boolean
 *   onClose         () => void
 *   employee        object         the target employee row
 *   deptName        (id) => string helper to resolve department name
 *   resignDate      string         'YYYY-MM-DD' (resign mode only)
 *   setResignDate   (v) => void
 *   resignReason    string         (resign mode only)
 *   setResignReason (v) => void
 *   onSubmit        () => void
 */
export default function ResignRehireModal({
  mode, open, onClose,
  employee,
  deptName,
  resignDate, setResignDate,
  resignReason, setResignReason,
  onSubmit,
}) {
  if (!open || !employee) return null

  if (mode === 'resign') {
    return (
      <Modal
        title={`員工離職 — ${employee.name}`}
        onClose={onClose}
        onSubmit={onSubmit}
        submitText="確認離職"
      >
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)', fontSize: 13, color: 'var(--accent-red)', marginBottom: 12 }}>
          將 <b>{employee.name}</b>（{deptName(employee.department_id)} · {employee.position}）設為離職狀態
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="離職日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={resignDate} onChange={e => setResignDate(e.target.value)} />
          </Field>
          <Field label="到職日">
            <input className="form-input" type="text" style={{ width: '100%' }} value={employee.join_date || '-'} readOnly />
          </Field>
        </div>
        <Field label="離職原因">
          <textarea
            className="form-input"
            style={{ width: '100%', height: 80, resize: 'vertical' }}
            placeholder="自願離職 / 合約到期 / 資遣 / 退休..."
            value={resignReason}
            onChange={e => setResignReason(e.target.value)}
          />
        </Field>
      </Modal>
    )
  }

  // mode === 'rehire'
  return (
    <Modal
      title={`員工復職 — ${employee.name}`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitText="確認復職"
    >
      <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', fontSize: 13, color: 'var(--accent-green)' }}>
        將 <b>{employee.name}</b> 恢復為在職狀態
      </div>
      {employee.resign_date && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          離職日期：{employee.resign_date}<br />
          離職原因：{employee.resign_reason || '-'}
        </div>
      )}
    </Modal>
  )
}
