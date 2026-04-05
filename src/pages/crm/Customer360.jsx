import { useState, useEffect } from 'react'
import { Search, X, User, DollarSign, ShoppingCart, Award, Clock, Phone, Mail } from 'lucide-react'
import { getMembers, getSalesOrders, getAccountsReceivable, getPointTransactions, getPOSTransactions } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

export default function Customer360() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    getMembers().then(({ data }) => { setMembers(data || []); setLoading(false) })
  }, [])

  const filtered = members.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (m.name || '').toLowerCase().includes(q) || (m.member_number || '').toLowerCase().includes(q) || (m.phone || '').includes(q)
  })

  const loadDetail = async (member) => {
    setSelected(member)
    setDetailLoading(true)
    const [soRes, arRes, ptRes, posRes] = await Promise.all([
      getSalesOrders(),
      getAccountsReceivable(),
      member.id ? getPointTransactions(member.id) : { data: [] },
      getPOSTransactions(),
    ])
    const orders = (soRes.data || []).filter(o => o.customer === member.name)
    const ar = (arRes.data || []).filter(r => r.customer === member.name)
    const points = ptRes.data || []
    const pos = (posRes.data || []).filter(t => t.member_id === String(member.id) || t.member_id === member.member_number)

    setDetail({ orders, ar, points, pos })
    setDetailLoading(false)
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👤</span> 客戶 360</h2>
            <p>Customer 360 — 客戶全方位視圖</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, minHeight: 500 }}>
        {/* Left: member list */}
        <div style={{ width: 300, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-main)', borderRadius: 6, padding: '6px 10px', border: '1px solid var(--border)' }}>
              <Search size={14} style={{ color: 'var(--text-secondary)' }} />
              <input type="text" placeholder="搜尋客戶..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 13, color: 'var(--text-primary)' }} />
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {filtered.map(m => (
              <div key={m.id} onClick={() => loadDetail(m)} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: selected?.id === m.id ? 'var(--accent-blue-dim)' : 'transparent' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.member_number} | {m.level} | {fmt(m.total_spent)}</div>
              </div>
            ))}
            {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>無符合的客戶</div>}
          </div>
        </div>

        {/* Right: 360 view */}
        <div style={{ flex: 1 }}>
          {!selected ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>請從左側選擇客戶</div>
          ) : detailLoading ? <LoadingSpinner /> : (
            <div>
              {/* Profile header */}
              <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#fff', fontWeight: 700 }}>
                    {selected.name?.[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0 }}>{selected.name}</h3>
                    <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {selected.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={12} /> {selected.phone}</span>}
                      {selected.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={12} /> {selected.email}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ padding: '4px 12px', borderRadius: 6, fontWeight: 700, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)' }}>{selected.level}</span>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{selected.member_number}</div>
                  </div>
                </div>
              </div>

              {/* KPI cards */}
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                  <div className="stat-card-label">累計消費</div>
                  <div className="stat-card-value" style={{ fontSize: 18 }}>{fmt(selected.total_spent)}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
                  <div className="stat-card-label">訂單數</div>
                  <div className="stat-card-value">{detail?.orders?.length || 0}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
                  <div className="stat-card-label">可用點數</div>
                  <div className="stat-card-value">{selected.available_points || 0}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                  <div className="stat-card-label">來店次數</div>
                  <div className="stat-card-value">{selected.visit_count || 0}</div>
                </div>
              </div>

              {/* Recent orders */}
              <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 12px', fontSize: 14 }}><ShoppingCart size={14} style={{ verticalAlign: -2, marginRight: 6 }} />近期訂單</h4>
                {(!detail?.orders || detail.orders.length === 0) ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: 8 }}>無訂單紀錄</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th style={{ textAlign: 'left', padding: '4px 8px' }}>訂單號</th><th style={{ textAlign: 'right', padding: '4px 8px' }}>金額</th><th style={{ padding: '4px 8px' }}>付款</th><th style={{ padding: '4px 8px' }}>出貨</th></tr></thead>
                    <tbody>
                      {detail.orders.slice(0, 5).map(o => (
                        <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{o.order_number}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(o.total)}</td>
                          <td style={{ padding: '4px 8px' }}>{o.payment_status}</td>
                          <td style={{ padding: '4px 8px' }}>{o.shipping_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* AR + Points side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14 }}><DollarSign size={14} style={{ verticalAlign: -2, marginRight: 6 }} />應收帳款</h4>
                  {(!detail?.ar || detail.ar.length === 0) ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>無應收紀錄</div>
                  ) : detail.ar.slice(0, 5).map(r => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                      <span>{r.invoice_number}</span>
                      <span style={{ fontFamily: 'monospace' }}>{fmt(r.amount - (r.paid_amount || 0))}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14 }}><Award size={14} style={{ verticalAlign: -2, marginRight: 6 }} />點數紀錄</h4>
                  {(!detail?.points || detail.points.length === 0) ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>無點數紀錄</div>
                  ) : detail.points.slice(0, 5).map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                      <span>{p.type}</span>
                      <span style={{ fontFamily: 'monospace', color: p.points > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{p.points > 0 ? '+' : ''}{p.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
