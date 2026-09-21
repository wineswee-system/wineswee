// 104 六月資料 → bulk_import migration 產生器
//   讀出勤/加班/請假 3 個 Excel，對員工，產出呼叫 bulk_import_* 的 idempotent migration。
//   用法：node scripts/gen_104_june_import.mjs
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const key = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?([^"'\r\n]+)/)[1]

const F = {
  attendance: 'C:/Users/user/Downloads/20260707出勤報表.xls',
  overtime:   'C:/Users/user/Downloads/20260707加班申請明細.xlsx',
  leave:      'C:/Users/user/Downloads/20260707請假申請明細.xlsx',
}
const rowsOf = p => {
  const wb = xlsx.readFile(p); const ws = wb.Sheets[wb.SheetNames[0]]
  const r = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' }); const h = r[6]
  return r.slice(7).filter(x => x[0]).map(x => Object.fromEntries(h.map((k, i) => [k, x[i]])))
}
// 出勤報表是分組格式：只有每人第一天有員編/姓名/部門，底下多天是空的 → forward-fill 前 3 欄
const rowsOfGrouped = p => {
  const wb = xlsx.readFile(p); const ws = wb.Sheets[wb.SheetNames[0]]
  const r = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' }); const h = r[6]
  let g0 = '', g1 = '', g2 = ''
  const out = []
  for (const x of r.slice(7)) {
    if (String(x[3]).match(/\d{4}\/\d{1,2}\/\d{1,2}/) === null) continue  // 沒出勤日期的列跳過
    if (x[0]) { g0 = x[0]; g1 = x[1]; g2 = x[2] }                          // 新員工區塊
    const row = [...x]; row[0] = g0; row[1] = g1; row[2] = g2
    out.push(Object.fromEntries(h.map((k, i) => [k, row[i]])))
  }
  return out
}
const D = s => String(s || '').trim().replace(/\//g, '-')            // 2026/06/01 → 2026-06-01
const T = s => { s = String(s || '').trim(); return /^\d{1,2}:\d{2}/.test(s) ? s : '' }
const num = v => { const n = Number(v); return isFinite(n) ? n : null }

// 時:分 或 clock 差 → 淨工時（扣休息 <5h=0/5~9h=0.5/≥9h=1；跨午夜+24）
const restH = g => g < 5 ? 0 : g < 9 ? 0.5 : 1
function netHours(inS, outS) {
  const [ih, im] = inS.split(':').map(Number), [oh, om] = outS.split(':').map(Number)
  let mins = (oh * 60 + om) - (ih * 60 + im); if (mins < 0) mins += 1440
  const g = mins / 60; const net = g - restH(g); return net > 0 ? Math.round(net * 100) / 100 : 0
}

const LEAVE_MAP = {
  '特休假': '特休', '特休假2025結算': '特休', '舊系統結算應休': '特休',
  '補休假': '補休', '舊人資系統補休結算': '補休',
  '病假': '病假', '事假': '事假', '生理假': '生理假', '產檢假': '產檢假', '婚假': '婚假',
}
const OT_CAT = { '工作日': '工作日', '例假日': '例假日', '休息日': '休息日', '空班日': '休息日', '國定假日': '國定假日' }
const NAME_FALLBACK = { '洪伯嘉': 10, '洪友銘': 431 }   // 104 員編跟 DB 不同，用姓名補對
const SKIP_NUM = new Set(['L2026117'])                   // TEST 帳號

async function main() {
  const sb = createClient('https://mvkvnuxeamahhfahclmi.supabase.co', key)

  const lv = rowsOf(F.leave), ot = rowsOf(F.overtime), at = rowsOfGrouped(F.attendance)
  const nums = [...new Set([...lv, ...ot, ...at].map(r => String(r['員工編號']).trim()))]
  const { data: emps } = await sb.from('employees').select('id,name,employee_number,organization_id').in('employee_number', nums)
  const byNum = Object.fromEntries((emps || []).map(e => [e.employee_number, e]))
  const { data: byId } = await sb.from('employees').select('id,name,organization_id').in('id', Object.values(NAME_FALLBACK))
  const idInfo = Object.fromEntries((byId || []).map(e => [e.id, e]))

  const warn = []
  const resolve = (numRaw, nameRaw) => {
    const n = String(numRaw).trim(), nm = String(nameRaw).trim()
    if (SKIP_NUM.has(n)) return null
    if (byNum[n]) return { id: byNum[n].id, name: byNum[n].name, org: byNum[n].organization_id }
    if (NAME_FALLBACK[nm] && idInfo[NAME_FALLBACK[nm]]) { const e = idInfo[NAME_FALLBACK[nm]]; return { id: e.id, name: e.name, org: e.organization_id } }
    warn.push(`對不到 ${n} ${nm}`); return null
  }

  // ── LEAVE ──
  const leaveRecs = []
  for (const r of lv) {
    const e = resolve(r['員工編號'], r['姓名']); if (!e) continue
    const type = LEAVE_MAP[r['假勤項目']]; if (!type) { warn.push(`未知假別 ${r['假勤項目']}`); continue }
    const hours = num(r['請假時數']) || 0
    leaveRecs.push({
      employee_id: e.id, employee: e.name, organization_id: e.org, type,
      start_date: D(r['假勤開始日期']), end_date: D(r['假勤結束日期'] || r['假勤開始日期']),
      hours, days: Math.round((hours / 8) * 100) / 100, unit: 'hour',
      reason: String(r['請假原因'] || r['假勤項目']).trim(), status: '已核准', approver: '104匯入',
    })
  }

  // ── OT（按 員工+歸屬日 加總）──
  const otMap = new Map()
  for (const r of ot) {
    const e = resolve(r['員工編號'], r['姓名']); if (!e) continue
    const date = D(r['加班歸屬日'] || r['加班開始日期'])
    const k = e.id + '|' + date
    const st = T(r['加班開始時間']), en = T(r['加班結束時間'])
    const cur = otMap.get(k) || { employee_id: e.id, employee: e.name, organization_id: e.org, date, hours: 0, category: OT_CAT[r['加班類型']] || '工作日', starts: [], ends: [], reason: String(r['加班原因'] || '加班').trim(), status: '已核准', source: '104匯入' }
    cur.hours += num(r['加班時數']) || 0
    if (st) cur.starts.push(st); if (en) cur.ends.push(en)
    otMap.set(k, cur)
  }
  const otRecs = [...otMap.values()].map(o => ({
    employee_id: o.employee_id, employee: o.employee, organization_id: o.organization_id, date: o.date,
    hours: Math.round(o.hours * 100) / 100, category: o.category,
    start_time: o.starts.sort()[0] || '', end_time: o.ends.sort().slice(-1)[0] || '',
    reason: o.reason, status: o.status, source: o.source,
  }))

  // ── ATTENDANCE（只取有實際上班的；total_hours 算淨工時）──
  const atRecs = []
  for (const r of at) {
    const ci = T(r['實際上班時間']); if (!ci) continue
    const e = resolve(r['員工編號'], r['姓名']); if (!e) continue
    const co = T(r['實際下班時間'])
    atRecs.push({
      employee_id: e.id, employee: e.name, organization_id: e.org, date: D(r['出勤日期']),
      clock_in: ci, clock_out: co, total_hours: co ? netHours(ci, co) : null, status: '正常',
    })
  }

  // ── 產出 migration ──
  const j = a => JSON.stringify(a).replace(/'/g, "''")
  const out = []
  out.push('-- 104 六月資料匯入（出勤/加班/請假）— auto-generated')
  out.push('-- 來源：20260707 出勤報表 / 加班申請明細 / 請假申請明細（2026/06/01~06/30）')
  out.push('-- 走既有 bulk_import_* RPC（內建去重）。leave/OT 用 overwrite=true 可重跑修正；')
  out.push('-- attendance 用 overwrite=false（只補辦公室缺口，不覆寫系統真實打卡）。idempotent。')
  out.push(`-- 筆數：leave ${leaveRecs.length} / overtime ${otRecs.length}（原始 ${ot.length} 筆加總）/ attendance ${atRecs.length}`)
  out.push('')
  out.push(`SELECT public.bulk_import_leave('${j(leaveRecs)}'::jsonb, true) AS leave_result;`)
  out.push('')
  out.push(`SELECT public.bulk_import_overtime('${j(otRecs)}'::jsonb, true) AS overtime_result;`)
  out.push('')
  out.push(`SELECT public.bulk_import_attendance('${j(atRecs)}'::jsonb, false) AS attendance_result;`)
  out.push('')
  const outPath = path.join(ROOT, 'supabase/migrations/20260707140000_import_104_june.sql')
  fs.writeFileSync(outPath, out.join('\n'), 'utf8')

  console.log('✓ 產出:', outPath)
  console.log(`  leave     : ${leaveRecs.length} 筆`)
  console.log(`  overtime  : ${otRecs.length} 筆（原始 ${ot.length} → 加總）`)
  console.log(`  attendance: ${atRecs.length} 筆（有實際打卡）`)
  if (warn.length) { console.log('\n⚠ 警告:'); [...new Set(warn)].forEach(w => console.log('  ', w)) }
  else console.log('\n✓ 全部對到，無警告')
}
main()
