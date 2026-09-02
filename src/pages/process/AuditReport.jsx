import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronLeft as Back, Printer, Download, TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import LoadingSpinner from '../../components/LoadingSpinner'

const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  body { background: #fff !important; }
  .ar-card { box-shadow: none !important; border: 1px solid #ccc !important; break-inside: avoid; }
}
`
const MEDAL = ['🥇', '🥈', '🥉']

export default function AuditReport() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const now = new Date()
  // 預設上個月(當月資料通常還沒齊)
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    setLoading(true)
    supabase.rpc('get_monthly_audit_report', { p_org: orgId, p_year: year, p_month: month })
      .then(({ data, error }) => { setData(error ? null : data); setLoading(false) })
  }, [profile?.organization_id, year, month])

  const scores = data?.scores || []
  const defs = data?.deficiencies || []

  const shiftMonth = (d) => {
    let m = month + d, y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }

  const exportCsv = () => {
    const lines = []
    lines.push(`${year}年${month}月 門市稽核月報表`)
    lines.push('')
    lines.push('【門市稽核分數排名】')
    lines.push(['排名', '門市', '第一複評', '第二複評', '平均', '趨勢'].join(','))
    scores.forEach((s, i) => lines.push([
      i + 1, s.store_name, s.first_score ?? '', s.second_score ?? '', s.avg,
      s.trend === 'up' ? '進步' : s.trend === 'down' ? '退步' : '',
    ].join(',')))
    lines.push('')
    lines.push('【常見缺失項目】')
    lines.push(['排名', '項目內容', '次數', '總扣分', '門市'].join(','))
    defs.forEach((d, i) => lines.push([
      i + 1, `"${(d.item_text || '').replace(/"/g, '""')}"`, d.cnt, d.total_deduct,
      `"${(d.stores || []).join('、')}"`,
    ].join(',')))
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `稽核月報表_${year}${String(month).padStart(2, '0')}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const scoreColor = (v) => v >= 85 ? 'var(--accent-green)' : v < 75 ? 'var(--accent-red)' : 'var(--text-primary)'

  return (
    <div className="fade-in">
      <style>{PRINT_CSS}</style>

      <div className="page-header">
        <div className="page-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-secondary no-print" onClick={() => navigate('/process/store-audits')} style={{ padding: '6px 10px' }}><Back size={16} /></button>
            <div>
              <h2>📊 門市稽核月報表</h2>
              <p>分數排名(含複評趨勢)＋當月常見缺失項目</p>
            </div>
          </div>
          <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* 月份切換 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', borderRadius: 10, padding: 4 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => shiftMonth(-1)} style={{ padding: '4px 8px' }}><ChevronLeft size={15} /></button>
              <span style={{ fontWeight: 800, minWidth: 92, textAlign: 'center', fontSize: 14 }}>{year} 年 {month} 月</span>
              <button className="btn btn-sm btn-secondary" onClick={() => shiftMonth(1)} style={{ padding: '4px 8px' }}><ChevronRight size={15} /></button>
            </div>
            <button className="btn btn-secondary" onClick={exportCsv} disabled={!scores.length && !defs.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Download size={15} /> 匯出</button>
            <button className="btn btn-primary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={15} /> 列印</button>
          </div>
        </div>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* ── 門市分數排名 ── */}
          <div className="card ar-card" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800 }}>🏆 門市稽核分數排名</h3>
            {scores.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>{year} 年 {month} 月沒有已核准的稽核資料</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-medium)', color: 'var(--text-secondary)', fontSize: 12 }}>
                      <th style={{ textAlign: 'center', padding: '8px 6px', width: 56 }}>排名</th>
                      <th style={{ textAlign: 'left', padding: '8px 6px' }}>門市</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px' }}>第一複評</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px' }}>第二複評</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px' }}>平均</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px' }}>趨勢</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((s, i) => (
                      <tr key={s.store_name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ textAlign: 'center', padding: '9px 6px', fontWeight: 800, fontSize: 15 }}>{MEDAL[i] || (i + 1)}</td>
                        <td style={{ textAlign: 'left', padding: '9px 6px', fontWeight: 700 }}>{s.store_name}</td>
                        <td style={{ textAlign: 'center', padding: '9px 6px', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{s.first_score ?? '—'}</td>
                        <td style={{ textAlign: 'center', padding: '9px 6px', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{s.second_score ?? '—'}</td>
                        <td style={{ textAlign: 'center', padding: '9px 6px', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: scoreColor(Number(s.avg)) }}>{s.avg}</td>
                        <td style={{ textAlign: 'center', padding: '9px 6px' }}>
                          {s.trend === 'up' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent-green)', fontWeight: 700, fontSize: 13 }}><TrendingUp size={15} /> 進步</span>
                          ) : s.trend === 'down' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent-red)', fontWeight: 700, fontSize: 13 }}><TrendingDown size={15} /> 退步</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.audit_count < 2 ? '單次' : '持平'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── 常見缺失 ── */}
          <div className="card ar-card" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800 }}>⚠️ 當月常見缺失項目</h3>
            {defs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>沒有缺失紀錄</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-medium)', color: 'var(--text-secondary)', fontSize: 12 }}>
                      <th style={{ textAlign: 'center', padding: '8px 6px', width: 42 }}>#</th>
                      <th style={{ textAlign: 'left', padding: '8px 6px' }}>項目內容</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px', width: 64 }}>次數</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px', width: 72 }}>總扣分</th>
                      <th style={{ textAlign: 'left', padding: '8px 6px' }}>門市</th>
                    </tr>
                  </thead>
                  <tbody>
                    {defs.map((d, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ textAlign: 'center', padding: '9px 6px', color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ textAlign: 'left', padding: '9px 6px', fontWeight: 600 }}>{d.item_text}</td>
                        <td style={{ textAlign: 'center', padding: '9px 6px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{d.cnt}</td>
                        <td style={{ textAlign: 'center', padding: '9px 6px', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--accent-red)' }}>{d.total_deduct}</td>
                        <td style={{ textAlign: 'left', padding: '9px 6px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(d.stores || []).map(st => (
                              <span key={st} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', whiteSpace: 'nowrap' }}>{st}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
