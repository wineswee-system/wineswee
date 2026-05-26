import React, { useState, useEffect } from 'react'
import { Search, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { getMatchingSummary, performThreeWayMatchById } from '../../lib/threeWayMatch'
import LoadingSpinner from '../../components/LoadingSpinner'

import { fmtNT as fmt } from '../../lib/currency'

function getMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export default function ThreeWayMatch() {
  const defaultRange = getMonthRange()
  const [startDate, setStartDate] = useState(defaultRange.start)
  const [endDate, setEndDate] = useState(defaultRange.end)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedRow, setExpandedRow] = useState(null)
  const [search, setSearch] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getMatchingSummary(startDate, endDate)
      setResults(data)
    } catch (err) {
      console.error('載入比對資料失敗:', err)
      setError('載入比對資料失敗，請重試')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleSearch = () => loadData()

  const filtered = results.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      r.poNumber?.toLowerCase().includes(s) ||
      r.supplier?.toLowerCase().includes(s) ||
      String(r.poId).includes(s)
    )
  })

  const matched = filtered.filter(r => r.status === 'matched').length
  const partial = filtered.filter(r => r.status === 'partial_match').length
  const mismatch = filtered.filter(r => r.status === 'mismatch').length

  const statusBadge = (status) => {
    if (status === 'matched') return <span className="badge badge-success"><span className="badge-dot"></span>已比對</span>
    if (status === 'partial_match') return <span className="badge badge-warning"><span className="badge-dot"></span>部分比對</span>
    return <span className="badge badge-danger"><span className="badge-dot"></span>不符</span>
  }

  const matchIcon = (m) => {
    if (m?.match) return <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} />
    return <XCircle size={14} style={{ color: 'var(--accent-red)' }} />
  }

  const toggleRow = (poId) => {
    setExpandedRow(prev => prev === poId ? null : poId)
  }

  if (error && !loading) {
    return (
      <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
        <h3>{error}</h3>
        <button className="btn btn-primary" onClick={loadData} style={{ marginTop: 16 }}>重新載入</button>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">&#9989;</span> 三方比對 Three-Way Matching</h2>
            <p>採購單 (PO) / 收貨單 (GR) / 應付帳款 (AP) 金額核對</p>
          </div>
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading}>
            <RefreshCw size={14} /> 重新比對
          </button>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>日期範圍：</label>
          <input
            className="form-input"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ width: 160 }}
          />
          <span style={{ color: 'var(--text-muted)' }}>~</span>
          <input
            className="form-input"
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            style={{ width: 160 }}
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading} style={{ fontSize: 13 }}>
            查詢
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已比對 Matched</div>
          <div className="stat-card-value">{matched}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">部分比對 Partial</div>
          <div className="stat-card-value">{partial}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">不符 Mismatch</div>
          <div className="stat-card-value">{mismatch}</div>
        </div>
      </div>

      {/* Results Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">&#128203;</span> 比對結果</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder="搜尋採購單號/供應商..."
              className="form-input"
              style={{ paddingLeft: 38 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <LoadingSpinner />
            <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>正在執行三方比對...</p>
          </div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>採購單號</th>
                  <th>供應商</th>
                  <th>PO 金額</th>
                  <th>GR 金額</th>
                  <th>AP 金額</th>
                  <th>狀態</th>
                  <th>差異</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                      {results.length === 0 ? '此日期範圍內無已收貨的採購單' : '無符合搜尋條件的結果'}
                    </td>
                  </tr>
                )}
                {filtered.map(r => (
                  <React.Fragment key={r.poId}>
                    <tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleRow(r.poId)}
                    >
                      <td>
                        {expandedRow === r.poId
                          ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                          : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                        }
                      </td>
                      <td style={{ fontWeight: 600 }}>{r.poNumber}</td>
                      <td>{r.supplier || '-'}</td>
                      <td>{fmt(r.poAmount)}</td>
                      <td>{fmt(r.grTotal)}</td>
                      <td>{fmt(r.apTotal)}</td>
                      <td>{statusBadge(r.status)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.discrepancies?.length > 0 ? r.discrepancies[0] : '-'}
                      </td>
                    </tr>

                    {/* Expanded Detail */}
                    {expandedRow === r.poId && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                          <MatchDetail result={r} matchIcon={matchIcon} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function MatchDetail({ result, matchIcon }) {
  const { matches, discrepancies, poItems, grItems, _po, _grRecords, _apRecords } = result

  return (
    <div style={{ padding: 20 }}>
      {/* Three-way comparison grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <ComparisonCard
          label="PO vs GR"
          sublabel="採購單 vs 收貨單"
          match={matches?.po_vs_gr}
          color="var(--accent-cyan)"
        />
        <ComparisonCard
          label="PO vs AP"
          sublabel="採購單 vs 應付帳款"
          match={matches?.po_vs_ap}
          color="var(--accent-purple)"
        />
        <ComparisonCard
          label="GR vs AP"
          sublabel="收貨單 vs 應付帳款"
          match={matches?.gr_vs_ap}
          color="var(--accent-orange)"
        />
      </div>

      {/* PO Line Items vs GR detail */}
      {Array.isArray(poItems) && poItems.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>品項明細比對</div>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>品項</th>
                <th>PO 數量</th>
                <th>GR 收貨數量</th>
                <th>PO 單價</th>
                <th>PO 金額</th>
              </tr>
            </thead>
            <tbody>
              {poItems.map((item, i) => {
                const code = item.product || item.itemCode || 'ITEM'
                const poQty = parseFloat(item.qty) || 0
                const unitPrice = parseFloat(item.unit_price || item.unitPrice) || 0
                const grMatch = (grItems || []).filter(g => g.code === code)
                const grQty = grMatch.reduce((s, g) => s + g.qty, 0)
                const qtyMatch = Math.abs(grQty - poQty) < 1 || (poQty > 0 && Math.abs(grQty - poQty) / poQty <= 0.01)
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{code}</td>
                    <td>{poQty}</td>
                    <td style={{ color: qtyMatch ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                      {grItems?.length > 0 ? grQty : '-'}
                      {!qtyMatch && grItems?.length > 0 && <span style={{ marginLeft: 4, fontSize: 11 }}>({grQty - poQty > 0 ? '+' : ''}{grQty - poQty})</span>}
                    </td>
                    <td>{fmt(unitPrice)}</td>
                    <td>{fmt(poQty * unitPrice)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* AP Records */}
      {Array.isArray(_apRecords) && _apRecords.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>應付帳款記錄</div>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>AP 編號</th>
                <th>供應商</th>
                <th>金額</th>
                <th>狀態</th>
                <th>參考編號</th>
              </tr>
            </thead>
            <tbody>
              {_apRecords.map((ap, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>AP-{String(ap.id).padStart(3, '0')}</td>
                  <td>{ap.supplier || '-'}</td>
                  <td>{fmt(ap.amount)}</td>
                  <td>
                    <span className={`badge ${ap.status === '已付' ? 'badge-success' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{ap.status || '待付'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ap.reference || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Discrepancies */}
      {discrepancies?.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--accent-red)' }}>差異項目</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {discrepancies.map((d, i) => (
              <div key={i} style={{
                padding: 10,
                background: 'var(--accent-red-dim)',
                borderRadius: 8,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <XCircle size={14} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {discrepancies?.length === 0 && (
        <div style={{
          padding: 12,
          background: 'var(--accent-green-dim)',
          borderRadius: 8,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--accent-green)',
        }}>
          <CheckCircle size={16} />
          三方比對完全一致，無差異
        </div>
      )}

      {/* Tolerance info */}
      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
        容差設定：1% 或 NT$10（取較大者）
      </div>
    </div>
  )
}

function ComparisonCard({ label, sublabel, match, color }) {
  const isMatch = match?.match
  return (
    <div style={{
      padding: 14,
      borderRadius: 8,
      background: isMatch ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
      border: `1px solid ${isMatch ? 'var(--accent-green)' : 'var(--accent-red)'}20`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{sublabel}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isMatch
          ? <CheckCircle size={16} style={{ color: 'var(--accent-green)' }} />
          : <XCircle size={16} style={{ color: 'var(--accent-red)' }} />
        }
        <span style={{
          fontSize: 13,
          fontWeight: 600,
          color: isMatch ? 'var(--accent-green)' : 'var(--accent-red)',
        }}>
          {isMatch ? '一致' : `差異 ${Math.abs(match?.variancePercent || 0).toFixed(1)}%`}
        </span>
      </div>
      {match && !isMatch && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          差額: {fmt(Math.abs(match.variance))}
        </div>
      )}
    </div>
  )
}
