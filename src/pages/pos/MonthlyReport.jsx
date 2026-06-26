import { useEffect, useState } from 'react'
import { RefreshCw, TrendingUp, ShoppingCart, Store, Package } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

function nt(n) { return `NT$ ${Number(n ?? 0).toLocaleString()}` }
function num(n) { return Number(n ?? 0).toLocaleString() }

const card = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: 10,
  padding: '16px 20px',
}
const kpi = {
  ...card,
  display: 'flex', flexDirection: 'column', gap: 4,
}

export default function MonthlyReport() {
  const { profile } = useAuth()
  const [yearMonth, setYearMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async (ym) => {
    if (!profile?.organization_id) return
    setLoading(true); setError(null)
    const { data: res, error: err } = await supabase.rpc('fn_pos_store_monthly_report', {
      p_org_id: profile.organization_id,
      p_year_month: ym + '-01',
    })
    if (err) setError(err.message)
    else setData(res)
    setLoading(false)
  }

  useEffect(() => { load(yearMonth) }, [profile?.organization_id]) // eslint-disable-line

  const stores   = data?.stores    ?? []
  const topItems = data?.top_items ?? []

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h2><span className="header-icon">📊</span> 門市月業績</h2>
            <p>各門市當月營收、單數、熱銷品項</p>
          </div>
          <div style={{ flex: 1 }} />
          <input
            type="month"
            value={yearMonth}
            onChange={e => { setYearMonth(e.target.value); load(e.target.value) }}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              padding: '6px 10px',
              fontSize: 14,
            }}
          />
          <button className="btn btn-secondary" onClick={() => load(yearMonth)}>
            <RefreshCw size={14} /> 重整
          </button>
        </div>
      </div>

      {loading && <LoadingSpinner />}
      {error && <div style={{ padding: 24, color: 'var(--accent-red)' }}>{error}</div>}

      {!loading && data && (
        <>
          {/* Org-level KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            <div style={kpi}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={13} /> 本月總營收
              </span>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent-cyan)' }}>{nt(data.total_revenue)}</span>
            </div>
            <div style={kpi}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShoppingCart size={13} /> 總結帳筆數
              </span>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent-green)' }}>{num(data.total_orders)} 單</span>
            </div>
            <div style={kpi}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Store size={13} /> 活躍門市
              </span>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{stores.length} 間</span>
            </div>
          </div>

          {/* Per-store breakdown */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Store size={15} style={{ color: 'var(--accent-cyan)' }} /> 各門市業績
            </div>
            {stores.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                本月尚無結帳資料
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}>
                    {['門市', '月營收', '結帳單數', '平均客單'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: h === '門市' ? 'left' : 'right', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stores.map((s, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px 10px', color: 'var(--text-primary)', fontWeight: 500 }}>{s.store_name ?? '未知門市'}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--accent-cyan)', fontWeight: 600 }}>{nt(s.revenue)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{num(s.order_count)} 單</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{nt(s.avg_ticket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Top items */}
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={15} style={{ color: 'var(--accent-purple)' }} /> 熱銷品項 TOP 20
            </div>
            {topItems.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                本月尚無銷售記錄
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}>
                    {['#', '品項名稱', '銷售數量', '銷售金額'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: h === '品項名稱' ? 'left' : 'right', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topItems.map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px 10px', color: 'var(--text-muted)', textAlign: 'right', width: 32 }}>{i + 1}</td>
                      <td style={{ padding: '10px 10px', color: 'var(--text-primary)' }}>{item.name}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{num(item.qty)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--accent-purple)', fontWeight: 600 }}>{nt(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
