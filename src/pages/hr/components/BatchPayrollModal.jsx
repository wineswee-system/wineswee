import { Calculator, Play } from 'lucide-react'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

export default function BatchPayrollModal({ month, batchPreview, batchSaving, onClose, onSave }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'var(--bg-modal-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 16,
        width: '100%', maxWidth: 900,
        maxHeight: '85vh',
        boxShadow: 'var(--shadow-xl)',
        animation: 'fadeIn 0.15s ease',
        display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>
            <Calculator size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            批次計薪預覽 — {month}
          </h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {batchPreview.length} 位員工</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <div className="data-table-wrapper">
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>員工</th>
                  <th>部門</th>
                  <th>底薪</th>
                  <th>總薪資</th>
                  <th style={{ color: 'var(--accent-orange)' }}>勞保</th>
                  <th style={{ color: 'var(--accent-orange)' }}>健保</th>
                  <th style={{ color: 'var(--accent-red)' }}>所得稅</th>
                  <th style={{ color: 'var(--accent-red)' }}>扣除合計</th>
                  <th style={{ color: 'var(--accent-green)', fontWeight: 800 }}>實領</th>
                </tr>
              </thead>
              <tbody>
                {batchPreview.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{p.employee}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{p.dept || '-'}</td>
                    <td>{fmt(p.base_salary)}</td>
                    <td>{fmt(p.gross)}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>-{p.laborInsurance.toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>-{p.healthInsurance.toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-red)' }}>{p.incomeTax > 0 ? `-${p.incomeTax.toLocaleString()}` : '—'}</td>
                    <td style={{ color: 'var(--accent-red)', fontWeight: 600 }}>-{p.totalDeductions.toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-green)', fontWeight: 800 }}>{fmt(p.netSalary)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                  <td colSpan={3}>合計</td>
                  <td>{fmt(batchPreview.reduce((s, p) => s + p.gross, 0))}</td>
                  <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + p.laborInsurance, 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + p.healthInsurance, 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-red)' }}>-{batchPreview.reduce((s, p) => s + p.incomeTax, 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-red)' }}>-{batchPreview.reduce((s, p) => s + p.totalDeductions, 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-green)' }}>{fmt(batchPreview.reduce((s, p) => s + p.netSalary, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            使用員工底薪計算，不含加班費 / 獎金 / 扣款。儲存後可逐筆編輯調整。
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={onSave} disabled={batchSaving}>
              {batchSaving ? '儲存中...' : (<><Play size={14} /> 確認儲存 {batchPreview.length} 筆</>)}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
