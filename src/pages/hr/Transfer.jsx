import { ArrowRightLeft } from 'lucide-react'

export default function Transfer() {
  const transfers = [
    { id: 1, employee: '趙亨威', fromDept: '營運部 · 02台中英才門市', toDept: '營運部 · 12台中文心門市', date: '2026-03-01', type: '調店', status: '已完成' },
    { id: 2, employee: '蘇東俞', fromDept: '營運部 · 03台北永春門市', toDept: '營運部 · mia門店', date: '2026-02-15', type: '調店', status: '已完成' },
  ]
  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">🔄</span> 轉調紀錄</h2>
        <p>員工部門異動與調店記錄</p>
      </div>
      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>員工</th><th>原單位</th><th>新單位</th><th>生效日</th><th>類型</th><th>狀態</th></tr></thead>
            <tbody>
              {transfers.map(t => (
                <tr key={t.id}>
                  <td>{t.employee}</td>
                  <td>{t.fromDept}</td>
                  <td style={{ color: 'var(--accent-cyan)' }}>{t.toDept}</td>
                  <td>{t.date}</td>
                  <td><span className="badge badge-info">{t.type}</span></td>
                  <td><span className="badge badge-success"><span className="badge-dot"></span>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
