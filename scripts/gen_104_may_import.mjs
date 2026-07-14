// 104 五月資料 → bulk_import migration 產生器（加班 + 請假；無出勤檔則跳過）
//   用法：node scripts/gen_104_may_import.mjs
//   複製自 gen_104_june_import.mjs，改指 20260714 檔 + 跳過出勤。
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const key = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?([^"'\r\n]+)/)[1]

const F = {
  overtime: 'C:/Users/user/Downloads/20260714加班申請明細.xlsx',
  leave:    'C:/Users/user/Downloads/20260714請假申請明細.xlsx',
}
const rowsOf = p => {
  const wb = xlsx.readFile(p); const ws = wb.Sheets[wb.SheetNames[0]]
  const r = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' }); const h = r[6]
  return r.slice(7).filter(x => x[0]).map(x => Object.fromEntries(h.map((k, i) => [k, x[i]])))
}
const D = s => String(s || '').trim().replace(/\//g, '-')
const T = s => { s = String(s || '').trim(); return /^\d{1,2}:\d{2}/.test(s) ? s : '' }
const num = v => { const n = Number(v); return isFinite(n) ? n : null }

const LEAVE_MAP = {
  '特休假': '特休', '特休假2025結算': '特休', '舊系統結算應休': '特休',
  '補休假': '補休', '舊人資系統補休結算': '補休',
  '病假': '病假', '事假': '事假', '生理假': '生理假', '產檢假': '產檢假', '婚假': '婚假',
  '彈性休假': '特休', '謀職假': '謀職假',
}
const OT_CAT = { '工作日': '工作日', '例假日': '例假日', '休息日': '休息日', '空班日': '休息日', '國定假日': '國定假日' }
const NAME_FALLBACK = { '洪伯嘉': 10, '洪友銘': 431 }
const SKIP_NUM = new Set(['L2026117'])

async function main() {
  const sb = createClient('https://mvkvnuxeamahhfahclmi.supabase.co', key)
  const lv = rowsOf(F.leave), ot = rowsOf(F.overtime)
  const nums = [...new Set([...lv, ...ot].map(r => String(r['員工編號']).trim()))]
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
    if (String(r['銷假'] || '').trim() === '是' || String(r['銷假'] || '').trim() === 'Y') continue  // 已銷假不匯
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

  const j = a => JSON.stringify(a).replace(/'/g, "''")
  const out = []
  out.push('-- 104 五月資料匯入（加班/請假）— auto-generated')
  out.push('-- 來源：20260714 加班申請明細 / 請假申請明細（2026/05/01~05/31）')
  out.push('-- 走既有 bulk_import_* RPC（內建去重）。overwrite=true 可重跑修正。idempotent。')
  out.push(`-- 筆數：leave ${leaveRecs.length} / overtime ${otRecs.length}（原始 ${ot.length} 筆加總）`)
  out.push('')
  out.push(`SELECT public.bulk_import_leave('${j(leaveRecs)}'::jsonb, true) AS leave_result;`)
  out.push('')
  out.push(`SELECT public.bulk_import_overtime('${j(otRecs)}'::jsonb, true) AS overtime_result;`)
  out.push('')
  const outPath = path.join(ROOT, 'supabase/migrations/20260714150000_import_104_may_ot_leave.sql')
  fs.writeFileSync(outPath, out.join('\n'), 'utf8')

  console.log('✓ 產出:', outPath)
  console.log(`  leave    : ${leaveRecs.length} 筆`)
  console.log(`  overtime : ${otRecs.length} 筆（原始 ${ot.length} → 加總）`)
  if (warn.length) { console.log('\n⚠ 警告:'); [...new Set(warn)].forEach(w => console.log('  ', w)) }
  else console.log('\n✓ 全部對到，無警告')
}
main()
