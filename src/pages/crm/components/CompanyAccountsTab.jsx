import { Plus, Building2 } from 'lucide-react'

export default function CompanyAccountsTab({ companies, companyLinks, customers, setShowCompanyModal }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div className="card-title"><Building2 size={16} style={{ marginRight: 6 }} /> 公司帳戶 ({companies.length})</div>
      </div>
      {companies.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
          <Building2 size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>尚無公司帳戶</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowCompanyModal(true)}><Plus size={14} /> 新增公司</button>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>公司名稱</th>
              <th>產業</th>
              <th>規模</th>
              <th>統一編號</th>
              <th>電話</th>
              <th>負責人</th>
              <th>關聯聯絡人</th>
            </tr>
          </thead>
          <tbody>
            {companies.map(comp => {
              const linkedContacts = companyLinks
                .filter(l => l.company_id === comp.id)
                .map(l => {
                  const cust = customers.find(cu => cu.id === l.contact_id)
                  return cust ? { ...cust, role: l.role } : null
                })
                .filter(Boolean)
              return (
                <tr key={comp.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{comp.name}</div>
                    {comp.website && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{comp.website}</div>}
                  </td>
                  <td>{comp.industry || '-'}</td>
                  <td>{comp.size || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{comp.tax_id || '-'}</td>
                  <td>{comp.phone || '-'}</td>
                  <td>{comp.owner || '-'}</td>
                  <td>
                    {linkedContacts.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {linkedContacts.map(lc => (
                          <span key={lc.id} style={{
                            padding: '2px 8px', borderRadius: 6,
                            background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                            fontSize: 11, fontWeight: 600,
                          }}>
                            {lc.name}（{lc.role}）
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
