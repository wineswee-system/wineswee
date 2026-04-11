import Modal, { Field } from '../../../components/Modal'

const LEVELS = ['一般', '銀卡', '金卡', '白金', '鑽石']

export default function MemberFormModal({ form, set, onClose, onSubmit }) {
  return (
    <Modal title="新增會員" onClose={onClose} onSubmit={onSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="會員編號 *">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="MEM-001" value={form.member_number} onChange={e => set('member_number', e.target.value)} />
        </Field>
        <Field label="姓名 *">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="會員姓名" value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="電話">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="0912-345-678" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </Field>
        <Field label="等級">
          <select className="form-input" style={{ width: '100%' }} value={form.level} onChange={e => set('level', e.target.value)}>
            {LEVELS.map(l => <option key={l}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="總點數">
          <input className="form-input" type="number" style={{ width: '100%' }} value={form.total_points} onChange={e => set('total_points', Number(e.target.value))} />
        </Field>
        <Field label="可用點數">
          <input className="form-input" type="number" style={{ width: '100%' }} value={form.available_points} onChange={e => set('available_points', Number(e.target.value))} />
        </Field>
        <Field label="累計消費">
          <input className="form-input" type="number" style={{ width: '100%' }} value={form.total_spent} onChange={e => set('total_spent', Number(e.target.value))} />
        </Field>
      </div>
    </Modal>
  )
}
