import Modal, { Field } from '../../../components/Modal'

const TAGS = ['VIP', '潛力客戶', '愛砍價', '潛在經銷商', '老客戶', '冷客戶']
const STATUSES = ['活躍', '潛在', '冷凍', '流失']
const COMPANY_ROLES = ['決策者', '影響者', '聯絡人', '採購', '技術負責人', '財務負責人', '其他']

export default function CustomerFormModal({ form, set, toggleTag, locations, companies, onClose, onSubmit }) {
  return (
    <Modal title="新增客戶" onClose={onClose} onSubmit={onSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="姓名" required><input className="form-input" type="text" style={{ width: '100%' }} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="公司"><input className="form-input" type="text" style={{ width: '100%' }} value={form.company} onChange={e => set('company', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="電話"><input className="form-input" type="text" style={{ width: '100%' }} value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="form-input" type="email" style={{ width: '100%' }} value={form.email} onChange={e => set('email', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="負責業務"><input className="form-input" type="text" style={{ width: '100%' }} value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} /></Field>
        <Field label="所屬分店">
          <select className="form-input" style={{ width: '100%' }} value={form.location_id} onChange={e => set('location_id', e.target.value)}>
            <option value="">請選擇分店</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="狀態">
          <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="信用額度"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.credit_limit} onChange={e => set('credit_limit', e.target.value)} /></Field>
      </div>
      {/* Company Link */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="關聯公司">
          <select className="form-input" style={{ width: '100%' }} value={form.company_id} onChange={e => set('company_id', e.target.value)}>
            <option value="">不關聯</option>
            {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
        </Field>
        {form.company_id && (
          <Field label="公司角色">
            <select className="form-input" style={{ width: '100%' }} value={form.company_role} onChange={e => set('company_role', e.target.value)}>
              {COMPANY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label="客戶來源"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="展覽/介紹/官網..." value={form.source} onChange={e => set('source', e.target.value)} /></Field>
      <Field label="客戶標籤">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {TAGS.map(tag => (
            <span key={tag} onClick={() => toggleTag(tag)} style={{ padding: '4px 12px', borderRadius: 8, border: `1px solid ${form.tags.includes(tag) ? 'var(--accent-cyan)' : 'var(--border-medium)'}`, background: form.tags.includes(tag) ? 'var(--accent-cyan-dim)' : 'transparent', color: form.tags.includes(tag) ? 'var(--accent-cyan)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>{tag}</span>
          ))}
        </div>
      </Field>
      <Field label="備註"><textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
    </Modal>
  )
}
