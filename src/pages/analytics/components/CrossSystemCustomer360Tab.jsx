import { useState } from 'react'
import LoadingSpinner from '../../../components/LoadingSpinner'

export default function Customer360Tab({ customers, StatCard, EmptyState }) {
  const [selected, setSelected] = useState('')
  const [c360, setC360] = useState(null)
  const [loading, setLoading] = useState(false)

  const loadCustomer = async (name) => {
    if (!name) return
    setLoading(true)
    try {
      const { getCustomer360 } = await import('../../../lib/automation')
      const result = await getCustomer360(name)
      setC360(result)
    } catch (err) {
      console.error('Customer 360 failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const m = c360?.metrics

  return (
    <>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ minWidth: 250 }}
            value={selected}
            onChange={e => { setSelected(e.target.value); loadCustomer(e.target.value) }}
          >
            <option value="">選擇客戶查看 360 分析...</option>
            {customers.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          {loading && <LoadingSpinner />}
        </div>
      </div>

      {c360 && m && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <StatCard label="累計營收" value={`NT$ ${m.totalRevenue.toLocaleString()}`} color="cyan" />
            <StatCard label="B2B 訂單" value={`NT$ ${m.b2bRevenue.toLocaleString()}`} color="blue" />
            <StatCard label="POS 消費" value={`NT$ ${m.posRevenue.toLocaleString()}`} color="green" />
            <StatCard label="未收帳款" value={`NT$ ${m.arOutstanding.toLocaleString()}`} color="red" />
          </div>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 12 }}>
            <StatCard label="總交易次數" value={m.totalOrders} color="purple" />
            <StatCard label="帳款回收率" value={`${m.collectionRate}%`} color="orange" />
            <StatCard label="開放工單" value={m.openTickets} color="pink" />
            <StatCard label="會員點數" value={m.loyaltyPoints.toLocaleString()} color="yellow" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>近期 B2B 訂單</h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>訂單</th><th>金額</th><th>狀態</th><th>日期</th></tr></thead>
                  <tbody>
                    {c360.salesOrders.slice(0, 10).map((o, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{o.order_number || `SO-${o.id}`}</td>
                        <td>NT$ {(o.total_amount || 0).toLocaleString()}</td>
                        <td><span className="badge badge-info">{o.status}</span></td>
                        <td>{o.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                    {c360.salesOrders.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無訂單</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>近期 POS 消費</h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>交易編號</th><th>金額</th><th>日期</th></tr></thead>
                  <tbody>
                    {c360.posTransactions.slice(0, 10).map((t, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{t.transaction_number || `POS-${t.id}`}</td>
                        <td>NT$ {(t.total || t.amount || 0).toLocaleString()}</td>
                        <td>{t.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                    {c360.posTransactions.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無 POS 消費</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>應收帳款歷史</h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>發票</th><th>金額</th><th>已收</th><th>狀態</th></tr></thead>
                  <tbody>
                    {c360.arRecords.slice(0, 10).map((a, i) => (
                      <tr key={i}>
                        <td>{a.invoice_number}</td>
                        <td>NT$ {(a.amount || 0).toLocaleString()}</td>
                        <td>NT$ {(a.paid_amount || 0).toLocaleString()}</td>
                        <td><span className={`badge ${a.status === '已收款' ? 'badge-success' : 'badge-warning'}`}>{a.status}</span></td>
                      </tr>
                    ))}
                    {c360.arRecords.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無應收紀錄</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>客服工單</h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>工單</th><th>主旨</th><th>狀態</th><th>日期</th></tr></thead>
                  <tbody>
                    {c360.tickets.slice(0, 10).map((t, i) => (
                      <tr key={i}>
                        <td>{t.ticket_number || `TK-${t.id}`}</td>
                        <td>{t.subject || t.title || '—'}</td>
                        <td><span className={`badge ${t.status === '已結案' ? 'badge-success' : 'badge-warning'}`}>{t.status}</span></td>
                        <td>{t.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                    {c360.tickets.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無工單</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
