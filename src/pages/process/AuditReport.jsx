import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Printer, FileSpreadsheet, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import LoadingSpinner from '../../components/LoadingSpinner'

// 稽核月報表 — 走「文件/報表」外觀(酒紅主色,自帶淺色紙面,列印/匯出友善)。
// 屬於獨立報表文件,比照薪資單版型使用固定色值(非套 app 主題 token)。
const CSS = `
.ar-sheet{max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:20px;
  --paper:#fff;--ink:#1a2430;--sub:#5c6b7a;--muted:#93a1b0;--hair:#e6ebf0;--hair2:#d3dbe3;
  --wine:#8a1e30;--wine-soft:#f7e9ec;--wine-ink:#6d1526;--green:#12885a;--green-soft:#e4f4ec;
  --red:#d23b3b;--red-soft:#fdeaea;--amber:#c07d16;--zebra:#f7f9fb;}
.ar-mast{background:var(--paper);border-radius:16px;padding:24px 28px;box-shadow:0 10px 34px rgba(26,36,48,.09);position:relative;overflow:hidden}
.ar-mast:before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:linear-gradient(var(--wine),var(--wine-ink))}
.ar-mast-row{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px}
.ar-eyebrow{font-size:11px;letter-spacing:3px;font-weight:800;color:var(--wine)}
.ar-mast h1{margin:6px 0 0;font-family:"Noto Serif TC",Georgia,serif;font-size:27px;font-weight:900;letter-spacing:1px;color:var(--ink)}
.ar-mast p{margin:6px 0 0;color:var(--sub);font-size:13px}
.ar-period{text-align:right;flex-shrink:0}
.ar-period .b{font-family:"Noto Serif TC",Georgia,serif;font-size:24px;font-weight:900;color:var(--wine-ink);line-height:1.1}
.ar-period .s{font-size:11px;color:var(--muted);margin-top:4px;letter-spacing:1px}
.ar-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
@media(max-width:720px){.ar-kpis{grid-template-columns:repeat(2,1fr)}}
.ar-kpi{background:var(--paper);border-radius:13px;padding:14px 16px;box-shadow:0 6px 20px rgba(26,36,48,.06)}
.ar-kpi .l{font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px}
.ar-kpi .v{font-size:25px;font-weight:900;margin-top:3px;font-variant-numeric:tabular-nums;letter-spacing:-.5px;color:var(--ink)}
.ar-kpi .n{font-size:11px;color:var(--sub);margin-top:1px}
.ar-card{background:var(--paper);border-radius:16px;padding:6px 24px 20px;box-shadow:0 10px 34px rgba(26,36,48,.08)}
.ar-sec{display:flex;align-items:center;gap:10px;padding:16px 0 13px;border-bottom:1px solid var(--hair);margin-bottom:4px}
.ar-sec .mk{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:15px;flex-shrink:0}
.ar-sec h2{margin:0;font-size:16px;font-weight:900;letter-spacing:.5px;color:var(--ink)}
.ar-sec .sub{margin-left:auto;font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px}
.ar-sheet table{width:100%;border-collapse:collapse;font-size:14px}
.ar-sheet thead th{font-size:11px;color:var(--muted);font-weight:800;text-align:center;padding:11px 8px;border-bottom:1.5px solid var(--hair2)}
.ar-sheet thead th.l{text-align:left}
.ar-sheet tbody td{padding:11px 8px;border-bottom:1px solid var(--hair);vertical-align:middle;color:var(--ink)}
.ar-sheet tbody tr:last-child td{border-bottom:none}
.ar-c{text-align:center}.ar-l{text-align:left}.ar-num{font-variant-numeric:tabular-nums}
.ar-medal{width:29px;height:29px;border-radius:50%;display:inline-grid;place-items:center;font-weight:900;font-size:13px;color:#fff}
.ar-m1{background:linear-gradient(135deg,#e3c14e,#c9a227)}.ar-m2{background:linear-gradient(135deg,#c2ccd6,#9aa6b2)}
.ar-m3{background:linear-gradient(135deg,#cf9a6b,#b17646)}.ar-mN{background:var(--hair);color:var(--sub)}
.ar-store{font-weight:800;font-size:15px}.ar-revi{color:var(--sub);font-variant-numeric:tabular-nums}.ar-dash{color:var(--muted)}
.ar-avg{display:flex;align-items:center;gap:10px;min-width:150px}
.ar-bar{flex:1;height:7px;border-radius:5px;background:var(--hair);overflow:hidden}
.ar-bar>i{display:block;height:100%;border-radius:5px}
.ar-avgn{font-weight:900;font-variant-numeric:tabular-nums;font-size:15px;min-width:48px;text-align:right}
.ar-hi{color:var(--green)}.ar-mid{color:var(--amber)}.ar-lo{color:var(--red)}
.ar-bhi{background:linear-gradient(90deg,#3bbd82,#12885a)}.ar-bmid{background:linear-gradient(90deg,#e0b24e,#c07d16)}.ar-blo{background:linear-gradient(90deg,#e77,#d23b3b)}
.ar-pill{display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:20px;font-size:12px;font-weight:800}
.ar-pu{background:var(--green-soft);color:var(--green)}.ar-pd{background:var(--red-soft);color:var(--red)}.ar-pf{background:var(--hair);color:var(--muted)}
.ar-idx{width:26px;height:26px;border-radius:8px;display:inline-grid;place-items:center;background:var(--wine-soft);color:var(--wine);font-weight:900;font-size:13px}
.ar-item{font-weight:700;font-size:14px}
.ar-freq{display:flex;align-items:center;gap:8px;min-width:92px}
.ar-freqbar{flex:1;height:6px;border-radius:4px;background:var(--hair);overflow:hidden}
.ar-freqbar>i{display:block;height:100%;background:linear-gradient(90deg,#b8455a,#8a1e30);border-radius:4px}
.ar-freqn{font-weight:900;font-variant-numeric:tabular-nums;min-width:18px;text-align:right}
.ar-ded{font-weight:900;color:var(--red);font-variant-numeric:tabular-nums}
.ar-chips{display:flex;flex-wrap:wrap;gap:5px}
.ar-chip{font-size:11px;padding:3px 9px;border-radius:6px;background:var(--wine-soft);color:var(--wine-ink);white-space:nowrap;font-weight:600}
.ar-empty{color:var(--muted);padding:16px 0;text-align:center}
@media print{.ar-noprint{display:none!important}body{background:#fff!important}.ar-card,.ar-mast,.ar-kpi{box-shadow:none!important;border:1px solid #d8dee4}.ar-card,.ar-mast{break-inside:avoid}}
`
const MEDAL_CLS = ['ar-m1', 'ar-m2', 'ar-m3']
const band = (v) => v >= 85 ? 'hi' : v >= 75 ? 'mid' : 'lo'

export default function AuditReport() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const now = new Date()
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
  const cats = data?.categories || []
  const maxCnt = defs.reduce((m, d) => Math.max(m, d.cnt || 0), 1)
  const maxCatDeduct = cats.reduce((m, c) => Math.max(m, c.deduct || 0), 1)

  // 摘要
  const auditCount = scores.reduce((s, x) => s + (x.audit_count || 0), 0)
  const avgAll = scores.length ? (scores.reduce((s, x) => s + Number(x.avg), 0) / scores.length) : 0
  const top = scores[0], bottom = scores[scores.length - 1]
  const upN = scores.filter(x => x.trend === 'up').length
  const downN = scores.filter(x => x.trend === 'down').length

  const shiftMonth = (d) => {
    let m = month + d, y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }

  const exportXlsx = async () => {
    const _m = await import('xlsx-js-style')
    const XLSX = _m.utils ? _m : (_m.default || _m)
    const WINE = '8A1E30', WINK = '6D1526', INK = '1A2430', SUB = '5C6B7A', HAIR = 'D9E0E7',
      GREEN = '12885A', AMBER = 'B0730F', RED = 'D23B3B', GOLD = 'C9A227', SIL = '9AA6B2', BRZ = 'B17646',
      ZEBRA = 'F7F9FB', WSOFT = 'F7E9EC'
    const bc = v => v >= 85 ? GREEN : v >= 75 ? AMBER : RED
    const B = { style: 'thin', color: { rgb: HAIR } }
    const border = { top: B, bottom: B, left: B, right: B }
    const rows = [], st = {}
    const put = (r, c, s) => { st[r + ',' + c] = s }
    let R = 0
    rows.push([`威士威 · 門市稽核月報表　${year} 年 ${month} 月`, '', '', '', '', '']); put(R, 0, { font: { bold: true, sz: 18, color: { rgb: WINK } }, alignment: { vertical: 'center' } }); R++
    rows.push([`分數排名(含複評趨勢)與當月常見缺失　|　資料來源:門市稽核系統`, '', '', '', '', '']); put(R, 0, { font: { sz: 10, color: { rgb: SUB } } }); R++
    rows.push(['']); R++
    rows.push(['當月摘要', `稽核 ${scores.length} 家 / ${auditCount} 次`, `平均 ${avgAll.toFixed(1)}`, top ? `最高 ${top.avg}(${top.store_name})` : '', bottom ? `最低 ${bottom.avg}(${bottom.store_name})` : '', `進步 ${upN} / 退步 ${downN}`])
    for (let c = 0; c < 6; c++) put(R, c, { font: { bold: c === 0, sz: 11, color: { rgb: c === 0 ? WINE : INK } }, fill: { fgColor: { rgb: WSOFT } }, alignment: { horizontal: c === 0 ? 'left' : 'center', vertical: 'center' }, border })
    R++; rows.push(['']); R++
    rows.push(['■ 門市稽核分數排名（依當月平均）', '', '', '', '', '']); put(R, 0, { font: { bold: true, sz: 13, color: { rgb: WINE } } }); R++
    const h1 = ['名次', '門市', '第一複評', '第二複評', '平均', '複評趨勢']
    rows.push(h1); h1.forEach((_, c) => put(R, c, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: WINE } }, alignment: { horizontal: c === 1 ? 'left' : 'center', vertical: 'center' }, border })); R++
    scores.forEach((s, i) => {
      const rank = i + 1
      rows.push([rank, s.store_name, s.first_score ?? '—', s.second_score ?? '—', Number(s.avg), s.trend === 'up' ? '↗ 進步' : s.trend === 'down' ? '↘ 退步' : '單次'])
      const zeb = i % 2 ? { fgColor: { rgb: ZEBRA } } : undefined
      const mf = rank === 1 ? GOLD : rank === 2 ? SIL : rank === 3 ? BRZ : null
      put(R, 0, { font: { bold: true, color: { rgb: mf ? 'FFFFFF' : SUB } }, fill: mf ? { fgColor: { rgb: mf } } : zeb, alignment: { horizontal: 'center', vertical: 'center' }, border })
      put(R, 1, { font: { bold: true, sz: 12, color: { rgb: INK } }, fill: zeb, alignment: { horizontal: 'left', vertical: 'center' }, border })
      put(R, 2, { font: { color: { rgb: SUB } }, fill: zeb, alignment: { horizontal: 'center' }, border })
      put(R, 3, { font: { color: { rgb: s.second_score == null ? '9AA7B5' : SUB } }, fill: zeb, alignment: { horizontal: 'center' }, border })
      put(R, 4, { font: { bold: true, sz: 12, color: { rgb: bc(Number(s.avg)) } }, fill: zeb, alignment: { horizontal: 'center' }, border })
      put(R, 5, { font: { bold: true, color: { rgb: s.trend === 'up' ? GREEN : s.trend === 'down' ? RED : '9AA7B5' } }, fill: zeb, alignment: { horizontal: 'center' }, border })
      R++
    })
    rows.push(['']); R++
    rows.push(['■ 當月常見缺失項目（依發生次數）', '', '', '', '', '']); put(R, 0, { font: { bold: true, sz: 13, color: { rgb: WINE } } }); R++
    const h2 = ['#', '項目內容', '次數', '總扣分', '出現門市', '']
    rows.push(h2);['#', '項目內容', '次數', '總扣分', '出現門市'].forEach((_, c) => put(R, c, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: WINE } }, alignment: { horizontal: c === 1 || c === 4 ? 'left' : 'center', vertical: 'center' }, border })); R++
    const dataStart = R
    defs.forEach((d, i) => {
      rows.push([i + 1, d.item_text, d.cnt, d.total_deduct, (d.stores || []).join('、'), ''])
      const zeb = i % 2 ? { fgColor: { rgb: ZEBRA } } : undefined
      put(R, 0, { font: { bold: true, color: { rgb: WINE } }, fill: { fgColor: { rgb: WSOFT } }, alignment: { horizontal: 'center', vertical: 'center' }, border })
      put(R, 1, { font: { bold: true, color: { rgb: INK } }, fill: zeb, alignment: { horizontal: 'left', vertical: 'center', wrapText: true }, border })
      put(R, 2, { font: { bold: true, color: { rgb: INK } }, fill: zeb, alignment: { horizontal: 'center', vertical: 'center' }, border })
      put(R, 3, { font: { bold: true, color: { rgb: RED } }, fill: zeb, alignment: { horizontal: 'center', vertical: 'center' }, border })
      put(R, 4, { font: { sz: 10, color: { rgb: SUB } }, fill: zeb, alignment: { horizontal: 'left', vertical: 'center', wrapText: true }, border })
      R++
    })
    if (cats.length) {
      rows.push(['']); R++
      rows.push(['■ 缺失分類彙總（依扣分）', '', '', '', '', '']); put(R, 0, { font: { bold: true, sz: 13, color: { rgb: WINE } } }); R++
      const h3 = ['分類', '次數', '扣分', '', '', '']
      rows.push(h3);['分類', '次數', '扣分'].forEach((_, c) => put(R, c, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: WINE } }, alignment: { horizontal: c === 0 ? 'left' : 'center', vertical: 'center' }, border })); R++
      cats.forEach((c, i) => {
        rows.push([c.name, c.cnt, c.deduct, '', '', ''])
        const zeb = i % 2 ? { fgColor: { rgb: ZEBRA } } : undefined
        put(R, 0, { font: { bold: true, color: { rgb: INK } }, fill: zeb, alignment: { horizontal: 'left', vertical: 'center' }, border })
        put(R, 1, { font: { color: { rgb: SUB } }, fill: zeb, alignment: { horizontal: 'center' }, border })
        put(R, 2, { font: { bold: true, color: { rgb: WINK } }, fill: zeb, alignment: { horizontal: 'center' }, border })
        R++
      })
    }
    const ws = XLSX.utils.aoa_to_sheet(rows)
    // 依內容自動配欄寬(中文字約算 1.8 寬;跳過標題/區塊/空白列;夾在 6~50)
    const dw = (s) => { s = String(s ?? ''); let n = 0; for (const ch of s) n += ch.charCodeAt(0) > 255 ? 1.8 : 1; return n }
    const colW = [0, 0, 0, 0, 0, 0]
    rows.forEach((r) => {
      if (!Array.isArray(r)) return
      if (r.filter(x => x !== '' && x != null).length <= 1) return
      r.forEach((v, c) => { if (c < 6) colW[c] = Math.max(colW[c], dw(v)) })
    })
    ws['!cols'] = colW.map(w => ({ wch: Math.min(50, Math.max(6, Math.round(w) + 2)) }))
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }]
    ws['!rows'] = rows.map((_, i) => ({ hpt: (i >= dataStart && i < dataStart + defs.length) ? 30 : (i === 0 ? 26 : 18) }))
    Object.entries(st).forEach(([k, s]) => { const [r, c] = k.split(',').map(Number); const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = s })
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `稽核月報表 ${year}-${String(month).padStart(2, '0')}`)
    XLSX.writeFile(wb, `稽核月報表_${year}${String(month).padStart(2, '0')}.xlsx`)
  }

  return (
    <div className="fade-in">
      <style>{CSS}</style>

      {/* 控制列 */}
      <div className="page-header ar-noprint">
        <div className="page-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/process/store-audits')} style={{ padding: '6px 10px' }}><ArrowLeft size={16} /></button>
            <div><h2>📊 門市稽核月報表</h2><p>分數排名(含複評趨勢)＋當月常見缺失</p></div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', borderRadius: 10, padding: 4 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => shiftMonth(-1)} style={{ padding: '4px 8px' }}><ChevronLeft size={15} /></button>
              <span style={{ fontWeight: 800, minWidth: 92, textAlign: 'center', fontSize: 14 }}>{year} 年 {month} 月</span>
              <button className="btn btn-sm btn-secondary" onClick={() => shiftMonth(1)} style={{ padding: '4px 8px' }}><ChevronRight size={15} /></button>
            </div>
            <button className="btn btn-secondary" onClick={exportXlsx} disabled={!scores.length && !defs.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileSpreadsheet size={15} /> 匯出 Excel</button>
            <button className="btn btn-primary" onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={15} /> 列印</button>
          </div>
        </div>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="ar-sheet">
          {/* 抬頭 */}
          <div className="ar-mast">
            <div className="ar-mast-row">
              <div>
                <div className="ar-eyebrow">WINESWEE · 營運稽核</div>
                <h1>門市稽核月報表</h1>
                <p>門市服務品質稽核 · 分數排名(含複評趨勢)與當月常見缺失彙整</p>
              </div>
              <div className="ar-period">
                <div className="b">{year} <span style={{ fontSize: 17 }}>年</span> {month} <span style={{ fontSize: 17 }}>月</span></div>
                <div className="s">門市稽核系統</div>
              </div>
            </div>
          </div>

          {/* 摘要 */}
          {scores.length > 0 && (
            <div className="ar-kpis">
              <div className="ar-kpi"><div className="l">稽核門市</div><div className="v">{scores.length}<span style={{ fontSize: 14, color: 'var(--muted)' }}> 家</span></div><div className="n">共稽核 {auditCount} 次</div></div>
              <div className="ar-kpi"><div className="l">當月平均</div><div className="v">{avgAll.toFixed(1)}</div><div className="n">全門市平均分</div></div>
              <div className="ar-kpi"><div className="l">最高</div><div className="v ar-hi">{top?.avg}</div><div className="n">{top?.store_name}</div></div>
              <div className="ar-kpi"><div className="l">最低</div><div className="v ar-lo">{bottom?.avg}</div><div className="n">{bottom?.store_name}</div></div>
              <div className="ar-kpi"><div className="l">複評趨勢</div><div className="v"><span className="ar-hi">{upN}</span><span style={{ fontSize: 15, color: 'var(--muted)' }}>↑ </span><span className="ar-lo">{downN}</span><span style={{ fontSize: 15, color: 'var(--muted)' }}>↓</span></div><div className="n">進步 / 退步</div></div>
            </div>
          )}

          {/* 分數排名 */}
          <div className="ar-card">
            <div className="ar-sec"><span className="mk" style={{ background: 'var(--wine-soft)' }}>🏆</span><h2>門市稽核分數排名</h2><span className="sub">依當月平均分</span></div>
            {scores.length === 0 ? <div className="ar-empty">{year} 年 {month} 月沒有已核准的稽核資料</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr>
                    <th style={{ width: 56 }}>名次</th><th className="l">門市</th>
                    <th style={{ width: 80 }}>第一複評</th><th style={{ width: 80 }}>第二複評</th>
                    <th className="l" style={{ width: 180 }}>平均</th><th style={{ width: 96 }}>複評趨勢</th>
                  </tr></thead>
                  <tbody>
                    {scores.map((s, i) => {
                      const bd = band(Number(s.avg))
                      return (
                        <tr key={s.store_name}>
                          <td className="ar-c"><span className={'ar-medal ' + (MEDAL_CLS[i] || 'ar-mN')}>{i + 1}</span></td>
                          <td className="ar-l ar-store">{s.store_name}</td>
                          <td className="ar-c ar-revi">{s.first_score ?? <span className="ar-dash">—</span>}</td>
                          <td className="ar-c ar-revi">{s.second_score ?? <span className="ar-dash">—</span>}</td>
                          <td>
                            <div className="ar-avg">
                              <span className="ar-bar"><i className={'ar-b' + bd} style={{ width: Math.min(100, Number(s.avg)) + '%' }} /></span>
                              <span className={'ar-avgn ar-' + bd}>{s.avg}</span>
                            </div>
                          </td>
                          <td className="ar-c">
                            {s.trend === 'up' ? <span className="ar-pill ar-pu">↗ 進步</span>
                              : s.trend === 'down' ? <span className="ar-pill ar-pd">↘ 退步</span>
                                : <span className="ar-pill ar-pf">{s.audit_count < 2 ? '單次' : '持平'}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 缺失分類彙總 */}
          {cats.length > 0 && (
            <div className="ar-card">
              <div className="ar-sec"><span className="mk" style={{ background: 'var(--wine-soft)' }}>🗂️</span><h2>缺失分類彙總</h2><span className="sub">依扣分</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th className="l">分類</th><th style={{ width: 80 }}>次數</th><th className="l" style={{ width: 240 }}>扣分</th></tr></thead>
                  <tbody>
                    {cats.map(c => (
                      <tr key={c.name}>
                        <td className="ar-l ar-store" style={{ fontSize: 14 }}>{c.name}</td>
                        <td className="ar-c ar-revi">{c.cnt}</td>
                        <td><div className="ar-freq"><span className="ar-freqbar"><i style={{ width: (c.deduct / maxCatDeduct * 100) + '%' }} /></span><span className="ar-freqn" style={{ minWidth: 40, color: 'var(--wine-ink)' }}>{c.deduct}</span></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 常見缺失 */}
          <div className="ar-card">
            <div className="ar-sec"><span className="mk" style={{ background: 'var(--red-soft)' }}>⚠️</span><h2>當月常見缺失項目</h2><span className="sub">依發生次數</span></div>
            {defs.length === 0 ? <div className="ar-empty">沒有缺失紀錄</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr>
                    <th style={{ width: 40 }}>#</th><th className="l">項目內容</th>
                    <th className="l" style={{ width: 110 }}>次數</th><th style={{ width: 72 }}>總扣分</th><th className="l">出現門市</th>
                  </tr></thead>
                  <tbody>
                    {defs.map((d, i) => (
                      <tr key={i}>
                        <td className="ar-c"><span className="ar-idx">{i + 1}</span></td>
                        <td className="ar-l ar-item">{d.item_text}</td>
                        <td><div className="ar-freq"><span className="ar-freqbar"><i style={{ width: (d.cnt / maxCnt * 100) + '%' }} /></span><span className="ar-freqn">{d.cnt}</span></div></td>
                        <td className="ar-c ar-ded">{d.total_deduct}</td>
                        <td className="ar-l"><div className="ar-chips">{(d.stores || []).map(st => <span key={st} className="ar-chip">{st}</span>)}</div></td>
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
