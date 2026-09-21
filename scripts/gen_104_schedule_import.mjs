// 104 六月排班 → bulk_import_schedule migration 產生器
//   讀「排班總表」(寬表) + 「104班別」(定義)，對員工拿門市，解析班別時間，產出 migration。
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const key = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?([^"'\r\n]+)/)[1]
const F_SCHED = 'C:/Users/user/Downloads/20260707排班總表.xlsx'
const F_DEF   = 'C:/Users/user/Downloads/104班別.xlsx'
const NAME_FALLBACK = { '洪伯嘉': 10, '洪友銘': 431 }
const SKIP_NUM = new Set(['L2026117'])
// 104班別沒收錄但系統既有定義（來自 20260617120000_backfill_schedule_times）
const MANUAL_SHIFT = { 'M-Mia蘇東俞': '11:30~20:00', '微-微風工早': '10:30~16:30' }

// ── 時間正規化 ──
function normTime(t) {
  if (t == null) return null
  t = String(t).trim().replace(/^(次日|隔日|次)\s*/, '')
  const cm = t.match(/^(\d{1,2}):(\d{2})$/)
  if (cm) return String(+cm[1]).padStart(2, '0') + ':' + cm[2] + ':00'
  const d = t.replace(/[^\d]/g, '')
  if (!d) return null
  if (d.length <= 2) { const h = +d; return (h >= 0 && h <= 24) ? String(h).padStart(2, '0') + ':00:00' : null }
  if (d.length === 3) return String(+d[0]).padStart(2, '0') + ':' + d.slice(1) + ':00'
  if (d.length === 4) return d.slice(0, 2) + ':' + d.slice(2) + ':00'
  return null
}
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const gapH = (endT, startT) => { let g = toMin(startT) - toMin(endT); if (g < 0) g += 1440; return g / 60 }  // 兩段間隔(h)
function parseRange(str) {
  str = String(str).trim()
  let m = str.match(/(\d{1,2}:\d{2})\s*[~～-]\s*(?:次日|隔日|次)?\s*(\d{1,2}:\d{2})/)
  if (m) { const s = normTime(m[1]), e = normTime(m[2]); if (s && e) return { start: s, end: e } }
  m = str.match(/(\d{2,4})\s*[-~]\s*(?:次日|隔日)?\s*(\d{1,4})\s*$/)
  if (m) { const s = normTime(m[1]), e = normTime(m[2]); if (s && e) return { start: s, end: e } }
  return null
}

async function main() {
  const sb = createClient('https://mvkvnuxeamahhfahclmi.supabase.co', key)

  // ── 104班別 → def map（代號-名稱 → work 時段陣列）──
  const rd = xlsx.utils.sheet_to_json(xlsx.readFile(F_DEF).Sheets[xlsx.readFile(F_DEF).SheetNames[0]], { header: 1, defval: '' })
  const defMap = new Map(); let cur = null
  for (const row of rd.slice(1)) {
    const code = String(row[1] || '').trim(), name = String(row[2] || '').trim(), work = String(row[3] || '').trim()
    if (name) { cur = { work: (work && work !== '- -') ? [work] : [] }; defMap.set(code + '-' + name, cur) }
    else if (cur && work && work !== '- -') cur.work.push(work)
  }

  // ── 排班總表 ──
  const wb = xlsx.readFile(F_SCHED); const r = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  const hdr = r[5]
  const dateCols = hdr.slice(4).map(h => {
    const m = String(h).match(/(\d{2})\/(\d{2})/); return m ? `2026-${m[1]}-${m[2]}` : null
  })
  const rows = r.slice(6).filter(x => x[0])

  // 員工對照
  const nums = [...new Set(rows.map(x => String(x[0]).trim()))]
  const { data: emps } = await sb.from('employees').select('id,name,employee_number,organization_id,store,store_id').in('employee_number', nums)
  const byNum = Object.fromEntries((emps || []).map(e => [e.employee_number, e]))
  const { data: byId } = await sb.from('employees').select('id,name,organization_id,store,store_id').in('id', Object.values(NAME_FALLBACK))
  const idInfo = Object.fromEntries((byId || []).map(e => [e.id, e]))
  const warn = []
  const resolve = (numRaw, nameRaw) => {
    const n = String(numRaw).trim(), nm = String(nameRaw).trim()
    if (SKIP_NUM.has(n)) return null
    const e = byNum[n] || (NAME_FALLBACK[nm] ? idInfo[NAME_FALLBACK[nm]] : null)
    if (!e) { warn.push(`對不到員工 ${n} ${nm}`); return null }
    return { id: e.id, name: e.name, org: e.organization_id, store: e.store, store_id: e.store_id }
  }

  const REST = { '休息日': '休息', '例假日': '例假', '國定假日': '國定假', '空班日': '空班', '天災日': '天災' }
  const unparse = {}
  const recs = []
  for (const row of rows) {
    const e = resolve(row[0], row[1]); if (!e) continue
    for (let i = 0; i < dateCols.length; i++) {
      const date = dateCols[i]; if (!date) continue
      const cell = String(row[4 + i] || '').trim(); if (!cell) continue
      const base = { employee_id: e.id, employee: e.name, organization_id: e.org, date, shift: cell, store_id: e.store_id, source_store: e.store, month_group: '2026-06', status: 'draft' }
      if (REST[cell]) { recs.push({ ...base, shift: REST[cell], absence_type: REST[cell] }); continue }
      // 一段/多段 → 解析時間；混合「假別+班別」則取班別段（假日有上班）
      const parts = cell.split(/\n|\s\/\s|、/).map(x => x.trim()).filter(Boolean)
      const resolveOne = (p) => {
        const d = defMap.get(p); if (d && d.work.length) { const r2 = parseRange(d.work[0]); if (r2) return r2 }
        if (MANUAL_SHIFT[p]) { const r2 = parseRange(MANUAL_SHIFT[p]); if (r2) return r2 }
        return parseRange(p)
      }
      const def = defMap.get(cell)
      let segs = [], workParts = parts.filter(p => !REST[p])
      if (def && def.work.length) { for (const w of def.work) { const r2 = parseRange(w); if (r2) segs.push(r2) } }
      else { for (const p of workParts) { const r2 = resolveOne(p); if (r2) segs.push(r2) } }
      if (!segs.length) {
        if (parts.some(p => REST[p])) { const k = parts.find(p => REST[p]); recs.push({ ...base, shift: REST[k], absence_type: REST[k] }); continue }
        unparse[cell] = (unparse[cell] || 0) + 1; recs.push(base); continue  // 存 shift 字串、無時間，待人工補
      }
      const rec = { ...base, actual_start: segs[0].start, actual_end: segs[0].end }
      // 只有「恰兩段 + 間隔 3-7h」才當真兩段班（過 _validate_split_shift 守門）；否則併成一段連續班
      if (segs.length === 2 && gapH(segs[0].end, segs[1].start) >= 3 && gapH(segs[0].end, segs[1].start) <= 7) {
        rec.shift_2 = workParts[1] || cell; rec.actual_start_2 = segs[1].start; rec.actual_end_2 = segs[1].end
      } else if (segs.length > 1) {
        rec.actual_end = segs[segs.length - 1].end  // 併段：頭段起 → 末段迄
      }
      recs.push(rec)
    }
  }

  const j = a => JSON.stringify(a).replace(/'/g, "''")
  const out = []
  out.push('-- 104 六月排班匯入 — auto-generated（來源：20260707排班總表 + 104班別）')
  out.push('-- 走 bulk_import_schedule RPC，按 員工+日期 去重，overwrite=true 可重跑。')
  out.push(`-- 共 ${recs.length} 筆（${rows.length} 員工 × 最多 ${dateCols.filter(Boolean).length} 天）`)
  out.push('')
  out.push(`SELECT public.bulk_import_schedule('${j(recs)}'::jsonb, true) AS schedule_result;`)
  out.push('')
  fs.writeFileSync(path.join(ROOT, 'supabase/migrations/20260707160000_import_104_june_schedule.sql'), out.join('\n'), 'utf8')

  console.log('✓ 產出 20260707160000_import_104_june_schedule.sql')
  console.log(`  排班 ${recs.length} 筆 | 上班日 ${recs.filter(x => x.actual_start).length} | 休假類 ${recs.filter(x => x.absence_type).length} | 分段班 ${recs.filter(x => x.shift_2).length}`)
  const up = Object.entries(unparse).sort((a, b) => b[1] - a[1])
  console.log(`  ⚠ 解析不出時間的班別 ${up.length} 種（存了 shift 字串、時間留空，待人工補）:`)
  up.forEach(([k, v]) => console.log(`     「${k}」× ${v}`))
  if (warn.length) { console.log('  員工警告:'); [...new Set(warn)].forEach(w => console.log('    ', w)) }
}
main()
