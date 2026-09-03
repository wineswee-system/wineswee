import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, FileSpreadsheet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import LoadingSpinner from '../../components/LoadingSpinner'

// 非經常性費用「單筆金額」分析報表 — 文件版型(財務綠),平均 + 中位數為核心。
const CSS = `
.er-sheet{max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:20px;
  --paper:#fff;--ink:#14231f;--sub:#586b64;--muted:#93a49d;--hair:#e6ecea;--hair2:#d2dcd8;
  --brand:#0f766e;--brand-soft:#e5f3f0;--brand-ink:#0b5951;--pos:#0f9d58;--neg:#d23b3b;--zebra:#f6faf9;}
.er-mast{background:var(--paper);border-radius:16px;padding:24px 28px;box-shadow:0 10px 34px rgba(20,35,31,.09);position:relative;overflow:hidden}
.er-mast:before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:linear-gradient(var(--brand),var(--brand-ink))}
.er-mast-row{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px}
.er-eyebrow{font-size:11px;letter-spacing:3px;font-weight:800;color:var(--brand)}
.er-mast h1{margin:6px 0 0;font-family:"Noto Serif TC",Georgia,serif;font-size:26px;font-weight:900;letter-spacing:1px;color:var(--ink)}
.er-mast p{margin:6px 0 0;color:var(--sub);font-size:13px}
.er-period .b{font-family:"Noto Serif TC",Georgia,serif;font-size:22px;font-weight:900;color:var(--brand-ink);text-align:right}
.er-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
@media(max-width:720px){.er-kpis{grid-template-columns:repeat(2,1fr)}}
.er-kpi{background:var(--paper);border-radius:13px;padding:15px 16px;box-shadow:0 6px 20px rgba(20,35,31,.06)}
.er-kpi.hero{background:linear-gradient(135deg,var(--brand),var(--brand-ink));color:#fff}
.er-kpi .l{font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px}
.er-kpi.hero .l{color:rgba(255,255,255,.85)}
.er-kpi .v{font-size:23px;font-weight:900;margin-top:3px;font-variant-numeric:tabular-nums;letter-spacing:-.5px;color:var(--ink)}
.er-kpi.hero .v{color:#fff}
.er-kpi .n{font-size:11px;color:var(--sub);margin-top:1px}
.er-kpi.hero .n{color:rgba(255,255,255,.8)}
.er-card{background:var(--paper);border-radius:16px;padding:6px 24px 20px;box-shadow:0 10px 34px rgba(20,35,31,.08)}
.er-sec{display:flex;align-items:center;gap:10px;padding:16px 0 13px;border-bottom:1px solid var(--hair);margin-bottom:4px}
.er-sec .mk{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:15px;background:var(--brand-soft)}
.er-sec h2{margin:0;font-size:16px;font-weight:900;color:var(--ink)}
.er-sec .sub{margin-left:auto;font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px}
.er-note{font-size:11px;color:var(--muted);padding:4px 0 10px}
.er-sheet table{width:100%;border-collapse:collapse;font-size:14px}
.er-sheet thead th{font-size:11px;color:var(--muted);font-weight:800;text-align:right;padding:11px 8px;border-bottom:1.5px solid var(--hair2)}
.er-sheet thead th.l{text-align:left}
.er-sheet tbody td{padding:11px 8px;border-bottom:1px solid var(--hair);vertical-align:middle;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
.er-sheet tbody td.l{text-align:left}
.er-sheet tbody tr:last-child td{border-bottom:none}
.er-name{font-weight:800}.er-n{color:var(--sub)}
.er-med{font-weight:900;color:var(--brand-ink)}
.er-empty{color:var(--muted);padding:16px 0;text-align:center}
@media print{.er-noprint{display:none!important}body{background:#fff!important}.er-card,.er-mast,.er-kpi{box-shadow:none!important;border:1px solid #d8e0dd}.er-card,.er-mast{break-inside:avoid}}
`
const nt = (v) => 'NT$ ' + Math.round(Number(v || 0)).toLocaleString('en-US')
const YEARS = [0, 2026, 2025, 2024] // 0 = 全部

export default function ExpenseReport() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [yr, setYr] = useState(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    if (!orgId) return
    setLoading(true)
    const from = yr ? `${yr}-01-01` : null
    const to = yr ? `${yr}-12-31` : null
    supabase.rpc('get_expense_amount_report', { p_org: orgId, p_from: from, p_to: to })
      .then(({ data, error }) => { setData(error ? null : data); setLoading(false) })
  }, [profile?.organization_id, yr])

  const o = data?.overall || {}
  const cats = data?.by_category || []
  const mons = data?.by_month || []
  const periodLabel = yr ? `${yr} 年` : '全期間'

  const exportXlsx = async () => {
    const _m = await import('xlsx-js-style'); const XLSX = _m.utils ? _m : (_m.default || _m)
    const BR = '0F766E', INK = '14231F', SUB = '586B64', HAIR = 'D9E0DD', BRINK = '0B5951', ZEB = 'F6FAF9', SOFT = 'E5F3F0'
    const B = { style: 'thin', color: { rgb: HAIR } }; const border = { top: B, bottom: B, left: B, right: B }
    const rows = [], st = {}; const put = (r, c, s) => { st[r + ',' + c] = s }; let R = 0
    rows.push([`非經常性費用 · 單筆金額分析報表　${periodLabel}`, '', '', '', '']); put(R, 0, { font: { bold: true, sz: 17, color: { rgb: BRINK } } }); R++
    rows.push([`單筆金額 = 實際優先(無則預估);排除 已駁回/核銷已退回`, '', '', '', '']); put(R, 0, { font: { sz: 10, color: { rgb: SUB } } }); R++
    rows.push(['']); R++
    rows.push(['整體', `筆數 ${o.n || 0}`, `平均 ${nt(o.avg)}`, `中位數 ${nt(o.median)}`, `總額 ${nt(o.total)}`])
    for (let c = 0; c < 5; c++) put(R, c, { font: { bold: c === 0, sz: 11, color: { rgb: c === 0 ? BR : INK } }, fill: { fgColor: { rgb: SOFT } }, alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' }, border })
    R++; rows.push(['']); R++
    const sec = (title, header, arr, keyName) => {
      rows.push(['■ ' + title, '', '', '', '']); put(R, 0, { font: { bold: true, sz: 13, color: { rgb: BR } } }); R++
      rows.push(header); header.forEach((_, c) => put(R, c, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: BR } }, alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' }, border })); R++
      arr.forEach((d, i) => {
        rows.push([d[keyName], d.n, Math.round(d.avg), Math.round(d.median), Math.round(d.total)])
        const zeb = i % 2 ? { fgColor: { rgb: ZEB } } : undefined
        put(R, 0, { font: { bold: true, color: { rgb: INK } }, fill: zeb, alignment: { horizontal: 'left' }, border })
        put(R, 1, { fill: zeb, alignment: { horizontal: 'right' }, border, font: { color: { rgb: SUB } } })
        put(R, 2, { fill: zeb, alignment: { horizontal: 'right' }, border, numFmt: '#,##0' })
        put(R, 3, { font: { bold: true, color: { rgb: BRINK } }, fill: zeb, alignment: { horizontal: 'right' }, border, numFmt: '#,##0' })
        put(R, 4, { fill: zeb, alignment: { horizontal: 'right' }, border, numFmt: '#,##0' })
        R++
      })
      rows.push(['']); R++
    }
    sec('各科目', ['科目', '筆數', '平均', '中位數', '總額'], cats, 'name')
    sec('各月', ['月份', '筆數', '平均', '中位數', '總額'], mons, 'ym')
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const dw = (s) => { s = String(s ?? ''); let n = 0; for (const ch of s) n += ch.charCodeAt(0) > 255 ? 1.8 : 1; return n }
    const colW = [0, 0, 0, 0, 0]
    rows.forEach(r => { if (Array.isArray(r) && r.filter(x => x !== '' && x != null).length > 1) r.forEach((v, c) => { if (c < 5) colW[c] = Math.max(colW[c], dw(v)) }) })
    ws['!cols'] = colW.map(w => ({ wch: Math.min(40, Math.max(8, Math.round(w) + 3)) }))
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } }]
    Object.entries(st).forEach(([k, s]) => { const [r, c] = k.split(',').map(Number); const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = s })
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '費用金額分析')
    XLSX.writeFile(wb, `非經常性費用金額分析_${yr || '全部'}.xlsx`)
  }

  return (
    <div className="fade-in">
      <style>{CSS}</style>
      <div className="page-header er-noprint">
        <div className="page-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/process/expense-query')} style={{ padding: '6px 10px' }}><ArrowLeft size={16} /></button>
            <div><h2>📊 非經常性費用 · 金額分析</h2><p>單筆平均金額與中位數</p></div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-input" value={yr} onChange={e => setYr(Number(e.target.value))} style={{ width: 110 }}>
              {YEARS.map(y => <option key={y} value={y}>{y ? `${y} 年` : '全部期間'}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={exportXlsx} disabled={!o.n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileSpreadsheet size={15} /> 匯出 Excel</button>
            <button className="btn btn-primary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={15} /> 列印</button>
          </div>
        </div>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="er-sheet">
          <div className="er-mast">
            <div className="er-mast-row">
              <div>
                <div className="er-eyebrow">WINESWEE · 財務分析</div>
                <h1>非經常性費用 · 單筆金額分析</h1>
                <p>單筆金額 = 實際優先(無則預估)　·　排除已駁回 / 核銷已退回</p>
              </div>
              <div className="er-period"><div className="b">{periodLabel}</div></div>
            </div>
          </div>

          {!o.n ? <div className="er-card"><div className="er-empty">{periodLabel}沒有費用資料</div></div> : (
            <>
              <div className="er-kpis">
                <div className="er-kpi"><div className="l">單筆平均</div><div className="v">{nt(o.avg)}</div><div className="n">{o.n} 筆</div></div>
                <div className="er-kpi hero"><div className="l">單筆中位數</div><div className="v">{nt(o.median)}</div><div className="n">典型單筆金額</div></div>
                <div className="er-kpi"><div className="l">總額</div><div className="v">{nt(o.total)}</div><div className="n">{periodLabel}累計</div></div>
                <div className="er-kpi"><div className="l">區間</div><div className="v" style={{ fontSize: 15 }}>{nt(o.min)} ~ {nt(o.max)}</div><div className="n">最小 ~ 最大</div></div>
              </div>

              <div className="er-card">
                <div className="er-sec"><span className="mk">🗂️</span><h2>各科目</h2><span className="sub">依總額</span></div>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th className="l">科目</th><th>筆數</th><th>平均</th><th>中位數</th><th>總額</th></tr></thead>
                    <tbody>
                      {cats.map(c => (
                        <tr key={c.name}>
                          <td className="l er-name">{c.name}</td>
                          <td className="er-n">{c.n}</td>
                          <td>{nt(c.avg)}</td>
                          <td className="er-med">{nt(c.median)}</td>
                          <td>{nt(c.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="er-card">
                <div className="er-sec"><span className="mk">📅</span><h2>各月</h2><span className="sub">申請月份</span></div>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th className="l">月份</th><th>筆數</th><th>平均</th><th>中位數</th><th>總額</th></tr></thead>
                    <tbody>
                      {mons.map(m => (
                        <tr key={m.ym}>
                          <td className="l er-name">{m.ym}</td>
                          <td className="er-n">{m.n}</td>
                          <td>{nt(m.avg)}</td>
                          <td className="er-med">{nt(m.median)}</td>
                          <td>{nt(m.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
