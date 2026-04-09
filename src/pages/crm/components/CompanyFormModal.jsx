import Modal, { Field } from '../../../components/Modal'

const COMPANY_SIZES = ['微型', '小型', '中型', '大型']

export default function CompanyFormModal({ companyForm, setComp, onClose, onSubmit }) {
  return (
    <Modal title="新增公司帳戶" onClose={onClose} onSubmit={onSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="公司名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.name} onChange={e => setComp('name', e.target.value)} /></Field>
        <Field label="產業"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：製造業" value={companyForm.industry} onChange={e => setComp('industry', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="規模">
          <select className="form-input" style={{ width: '100%' }} value={companyForm.size} onChange={e => setComp('size', e.target.value)}>
            <option value="">請選擇</option>
            {COMPANY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="統一編號"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.tax_id} onChange={e => setComp('tax_id', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="電話"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.phone} onChange={e => setComp('phone', e.target.value)} /></Field>
        <Field label="網站"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="https://..." value={companyForm.website} onChange={e => setComp('website', e.target.value)} /></Field>
      </div>
      <Field label="地址"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.address} onChange={e => setComp('address', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="年營收"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={companyForm.annual_revenue} onChange={e => setComp('annual_revenue', e.target.value)} /></Field>
        <Field label="員工數"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={companyForm.employee_count} onChange={e => setComp('employee_count', e.target.value)} /></Field>
      </div>
      <Field label="負責人"><input className="form-input" type="text" style={{ width: '100%' }} value={companyForm.owner} onChange={e => setComp('owner', e.target.value)} /></Field>
      <Field label="備註"><textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={companyForm.notes} onChange={e => setComp('notes', e.target.value)} /></Field>
    </Modal>
  )
}
