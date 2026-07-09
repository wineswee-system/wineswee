// 薪資整併 diff 驗證:preview 引擎值(新邏輯) vs 現有 payroll_records(舊 generate 邏輯)
// 唯讀,不跑新 generate(避免動法扣餘額/tracker 副作用)。
// 用途:切換前看「入帳改讀引擎後,哪些員工哪些欄位的數字會變、變多少」。
//   純計算欄(底薪/加班/投保/稅/gross/請假/工時)理應=昨天 preview 的修正結果;
//   法扣/total/net 因法扣預估≠實扣,允許差異(會標註)。
// 跑法:node scripts/_diff_preview_generate.mjs [period]   例:node scripts/_diff_preview_generate.mjs 2026-04
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
const key = fs.readFileSync('.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?([^"'\r\n]+)/)[1]
const sb = createClient('https://mvkvnuxeamahhfahclmi.supabase.co', key)

const period = process.argv[2] || (await (async () => {
  const { data } = await sb.from('payroll_records').select('pay_period').not('pay_period', 'is', null).order('pay_period', { ascending: false }).limit(1)
  return data?.[0]?.pay_period
})())

// org:payroll_records.organization_id 可能為 null → 從該期紀錄的員工身上取
const { data: sample } = await sb.from('payroll_records').select('employee_id, organization_id').eq('pay_period', period).limit(1)
if (!sample?.length) { console.log(`期別 ${period} 無現有 payroll_records,無法比對`); process.exit() }
let org = sample[0].organization_id
if (!org) {
  const { data: emp } = await sb.from('employees').select('organization_id').eq('id', sample[0].employee_id).maybeSingle()
  org = emp?.organization_id
}
if (!org) { console.log('抓不到 org'); process.exit() }

console.log(`\n=== 比對期別 ${period} (org ${org}) ===`)
console.log('   preview 引擎(新) vs 現有 payroll_records(舊)\n')

// preview 引擎值
const { data: prev, error } = await sb.rpc('preview_payroll', { p_period: period, p_org: org })
if (error) { console.log('preview_payroll 失敗:', error.message); process.exit() }
const byEmp = Object.fromEntries((prev || []).map(r => [r.employee_id, r]))

// 現有紀錄
const { data: recs } = await sb.from('payroll_records')
  .select('employee_id, base_salary, overtime_pay, ot_hours_weekday, labor_ins_employee, health_ins_employee, labor_pension_employee, income_tax_withheld, leave_deduction, gross_salary, hours_worked, legal_deduction_total, total_deductions, net_salary')
  .eq('pay_period', period)

// 引擎 key → payroll_records 欄 (純計算欄,理應一致)
const PURE = [
  ['base_salary', 'base_salary'], ['overtimePay', 'overtime_pay'], ['otWeekday', 'ot_hours_weekday'],
  ['laborInsurance', 'labor_ins_employee'], ['healthInsurance', 'health_ins_employee'],
  ['pension', 'labor_pension_employee'], ['incomeTax', 'income_tax_withheld'],
  ['absenceDeduction', 'leave_deduction'], ['gross', 'gross_salary'], ['workHours', 'hours_worked'],
]
// 法扣相關(允許差異,標註)
const LEGAL = [['legal_deduction', 'legal_deduction_total'], ['totalDeductions', 'total_deductions'], ['netSalary', 'net_salary']]

const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.5
let pureDiffs = 0, legalDiffs = 0, missing = 0
for (const rc of (recs || [])) {
  const e = byEmp[rc.employee_id]
  if (!e) { missing++; continue }
  const bad = []
  for (const [k, col] of PURE) if (!near(e[k], rc[col])) bad.push(`${col}: 舊 ${rc[col]} → 新 ${Number(e[k])}`)
  if (bad.length) { pureDiffs++; console.log(`🔴 純計算欄不一致 emp ${rc.employee_id}:\n   ` + bad.join('\n   ')) }
  const lbad = []
  for (const [k, col] of LEGAL) if (!near(e[k], rc[col])) lbad.push(`${col}: 舊 ${rc[col]} → 新 ${Number(e[k])}`)
  if (lbad.length) legalDiffs++
}
console.log(`\n=== 結果 ===`)
console.log(`比對 ${recs?.length || 0} 位員工`)
console.log(`🔴 純計算欄有差異(=切換後數字會變,請確認是否為昨天的修正): ${pureDiffs} 位`)
console.log(`🟡 法扣/total/net 有差異(預估≠實扣,通常正常): ${legalDiffs} 位`)
if (missing) console.log(`⚠️  ${missing} 位現有紀錄不在 preview 名單(可能已離職/編制外)`)
console.log(`\n說明:純計算欄的差異 = 昨天 preview 修正(投保/工時/加班)反映到入帳的結果。`)
console.log(`     確認這些變動符合預期後,即可放心切換用新 generate_payroll 正式入帳。`)
