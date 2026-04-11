import { TIER_RULES } from '../../../lib/crmEngine'

const LEVELS = ['一般', '銀卡', '金卡', '白金', '鑽石']

export default function TierRulesTab({ members, levelBadge }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><span className="card-title-icon">⭐</span> 等級規則</div>
      </div>
      <div style={{ padding: '4px 0' }}>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>等級</th>
                <th>最低累計消費</th>
                <th>最低累計點數</th>
                <th>累點倍率</th>
                <th>折扣 %</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {TIER_RULES.map((tier, i) => (
                <tr key={tier.level}>
                  <td>
                    <span className={`badge ${levelBadge(tier.level)}`}>
                      <span className="badge-dot"></span>{tier.level}
                    </span>
                  </td>
                  <td>NT$ {tier.min_spent.toLocaleString()}</td>
                  <td>{tier.min_points.toLocaleString()}</td>
                  <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{tier.earn_rate}x</td>
                  <td style={{ fontWeight: 600, color: tier.discount > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>{tier.discount}%</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {i === 0 ? '基本等級，每消費 $10 得 1 點' :
                      `消費滿 $${tier.min_spent.toLocaleString()} 且點數達 ${tier.min_points.toLocaleString()} 自動升級`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)' }}>
        <strong>升級機制：</strong>每次消費後系統自動檢查累計消費與點數，達標自動升級。點數計算公式：消費金額 / 10 × 等級倍率（無條件捨去）。
      </div>

      {/* Current member tier distribution */}
      <div style={{ padding: '0 20px 20px' }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>會員等級分佈</h4>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {LEVELS.map(level => {
            const count = members.filter(m => m.level === level).length
            return (
              <div key={level} style={{
                padding: '8px 16px', borderRadius: 8,
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span className={`badge ${levelBadge(level)}`}>
                  <span className="badge-dot"></span>{level}
                </span>
                <span style={{ fontWeight: 700 }}>{count}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>人</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
