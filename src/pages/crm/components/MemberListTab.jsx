import { Search, ShoppingCart, Gift, RotateCcw } from 'lucide-react'

export default function MemberListTab({
  filtered,
  search,
  setSearch,
  levelBadge,
  formatTime,
  openPurchase,
  openRedeem,
  openRefund,
  posTransactions,
}) {
  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 會員列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋會員..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>會員編號</th><th>姓名</th><th>電話</th><th>等級</th><th>總點數</th><th>可用點數</th><th>累計消費</th><th>到店次數</th><th>最後到店</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無會員</td></tr>}
              {filtered.map(m => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.member_number}</td>
                  <td>{m.name}</td>
                  <td>{m.phone}</td>
                  <td>
                    <span className={`badge ${levelBadge(m.level)}`}>
                      <span className="badge-dot"></span>{m.level}
                    </span>
                  </td>
                  <td>{(m.total_points || 0).toLocaleString()}</td>
                  <td>{(m.available_points || 0).toLocaleString()}</td>
                  <td>NT$ {(m.total_spent || 0).toLocaleString()}</td>
                  <td>{m.visit_count || 0}</td>
                  <td>{m.last_visit}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openPurchase(m)} title="模擬消費">
                        <ShoppingCart size={12} /> 模擬消費
                      </button>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openRedeem(m)} title="兌換點數">
                        <Gift size={12} /> 兌換
                      </button>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => openRefund(m)} title="退款扣點">
                        <RotateCcw size={12} /> 退款
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* POS Transactions Section */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🧾</span> POS 交易</div>
        </div>
        {posTransactions.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            尚無 POS 交易紀錄。使用「模擬消費」按鈕來產生交易。
          </div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>交易編號</th><th>會員</th><th>消費金額</th><th>獲得點數</th><th>時間</th></tr>
              </thead>
              <tbody>
                {posTransactions.slice(0, 20).map(tx => (
                  <tr key={tx.id}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>{tx.id}</td>
                    <td>{tx.member_name}</td>
                    <td>NT$ {tx.amount.toLocaleString()}</td>
                    <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>+{tx.points_earned}</td>
                    <td style={{ fontSize: 12 }}>{formatTime(tx.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
