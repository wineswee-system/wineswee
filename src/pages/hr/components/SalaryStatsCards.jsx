/**
 * SalaryStatsCards — 薪資管理頁的四格統計卡片
 * Props: totalGross, totalDeductionsSum, totalNet, employeeCount
 */

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

export default function SalaryStatsCards({ totalGross, totalDeductionsSum, totalNet, employeeCount }) {
  return (
    <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
        <div className="stat-card-label">總薪資（Gross）</div>
        <div className="stat-card-value">{fmt(totalGross)}</div>
      </div>
      <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
        <div className="stat-card-label">扣除合計</div>
        <div className="stat-card-value">{fmt(totalDeductionsSum)}</div>
      </div>
      <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
        <div className="stat-card-label">實領合計（Net）</div>
        <div className="stat-card-value">{fmt(totalNet)}</div>
      </div>
      <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
        <div className="stat-card-label">計薪人數</div>
        <div className="stat-card-value">{employeeCount} 人</div>
      </div>
    </div>
  )
}
