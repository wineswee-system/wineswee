import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag, ChevronDown, ChevronRight } from 'lucide-react'
import { useOrgId } from '../../contexts/AuthContext'
import { getAllMemberPurchases, getMemberPurchaseLines } from '../../lib/db'
import Badge from '../../components/ui/Badge'

const METHOD_LABEL = {
  cash: '現金', card: '信用卡', line_pay: 'LINE Pay',
  apple_pay: 'Apple Pay', transfer: '轉帳', voucher: '儲值金', mixed: '複合',
}

const CAT_ICON = {
  wine: '🍷', beer: '🍺', spirits: '🥃',
  non_alcoholic: '🧃', food: '🍽', accessory: '🎁',
}

function fmtDT(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export default function PurchaseRecords() {
  const orgId   = useOrgId()
  const today   = new Date().toISOString().slice(0, 10)
  const month30 = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) })()

  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(false)
  const [dateFrom,     setDateFrom]     = useState(month30)
  const [dateTo,       setDateTo]       = useState(today)
  const [search,       setSearch]       = useState('')
  const [expanded,     setExpanded]     = useState(null)
  const [lines,        setLines]        = useState({})
  const [linesLoading, setLinesLoading] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await getAllMemberPurchases(orgId, { dateFrom, dateTo })
    setRows(data ?? [])
    setLoading(false)
  }, [orgId, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  async function toggleDetail(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!lines[id]) {
      setLinesLoading(id)
      const { data } = await getMemberPurchaseLines(id)
      setLines(prev => ({ ...prev, [id]: data ?? [] }))
      setLinesLoading(null)
    }
  }

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    return !q
      || r.members?.name?.toLowerCase().includes(q)
      || r.members?.phone?.includes(q)
      || r.members?.member_number?.toLowerCase().includes(q)
  })

  const totalRevenue = filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0)
  const totalPoints  = filtered.reduce((s, r) => s + (r.points_earned || 0), 0)

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>會員消費紀錄</h1>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={S.input} />
        <span style={{ color: 'var(--text-muted)' }}>~</span>
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={S.input} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋會員姓名 / 電話 / 編號…"
          style={{ ...S.input, minWidth: 220 }}
        />
        <button onClick={load} style={S.btn}>查詢</button>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        {[
          ['消費筆數',   filtered.length,                         'var(--text-secondary)'],
          ['總金額',     `NT$${totalRevenue.toLocaleString()}`,   'var(--accent-cyan)'],
          ['贈送積分',   totalPoints.toLocaleString(),            'var(--accent-purple)'],
        ].map(([l, v, c]) => (
          <div key={l} style={S.statCard}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <ShoppingBag size={36} style={{ display: 'block', margin: '0 auto 12px', opacity: 0.3 }} />
            <div>查無消費紀錄</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                {['', '時間', '會員', '分店', '金額', '積分', '付款方式'].map((h, i) => (
                  <th key={i} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <>
                  <tr
                    key={r.id}
                    style={{ borderTop: '1px solid var(--border-primary)', cursor: 'pointer', background: expanded === r.id ? 'var(--bg-tertiary)' : 'transparent' }}
                    onClick={() => toggleDetail(r.id)}
                  >
                    <td style={{ ...S.td, width: 28, color: 'var(--text-muted)' }}>
                      {expanded === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td style={S.td}>{fmtDT(r.purchased_at)}</td>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.members?.name ?? '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.members?.phone ?? ''}</div>
                    </td>
                    <td style={S.td}>{r.stores?.name ?? '—'}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent-cyan)' }}>NT${Number(r.total_amount).toLocaleString()}</td>
                    <td style={{ ...S.td, color: 'var(--accent-purple)' }}>{r.points_earned ? `+${r.points_earned}` : '—'}</td>
                    <td style={S.td}>
                      <Badge variant="default">{METHOD_LABEL[r.payment_method] ?? r.payment_method ?? '—'}</Badge>
                    </td>
                  </tr>

                  {expanded === r.id && (
                    <tr key={`det-${r.id}`}>
                      <td colSpan={7} style={{ background: 'var(--bg-tertiary)', padding: '14px 20px', borderTop: '1px solid var(--border-primary)' }}>
                        {linesLoading === r.id ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>載入明細…</div>
                        ) : (lines[r.id] ?? []).length === 0 ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>無明細資料</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr>
                                {['品名', '類別', '數量', '單價', '小計'].map(h => (
                                  <th key={h} style={{ padding: '4px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(lines[r.id] ?? []).map(l => (
                                <tr key={l.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                                  <td style={{ padding: '6px 10px', color: 'var(--text-primary)', fontWeight: 500 }}>{l.product_name}</td>
                                  <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>
                                    {CAT_ICON[l.product_category] ?? ''} {l.product_category ?? '—'}
                                  </td>
                                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{l.qty}</td>
                                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>NT${Number(l.unit_price).toLocaleString()}</td>
                                  <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--text-primary)' }}>NT${Number(l.subtotal).toLocaleString()}</td>
                                </tr>
                              ))}
                              <tr style={{ borderTop: '2px solid var(--border-primary)' }}>
                                <td colSpan={4} style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontWeight: 700 }}>合計</td>
                                <td style={{ padding: '6px 10px', fontWeight: 700, color: 'var(--accent-cyan)' }}>NT${Number(r.total_amount).toLocaleString()}</td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const S = {
  th:       { padding: '10px 14px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' },
  td:       { padding: '10px 14px', color: 'var(--text-secondary)', verticalAlign: 'middle' },
  input:    { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' },
  btn:      { padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  statCard: { background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: '12px 20px', minWidth: 120 },
}
