#!/usr/bin/env node
/**
 * _check_basesalary_drift.mjs — 一次性檢查：特休結清 vs 薪資 本薪來源是否一致
 *
 * 特休結清(LeaveBalances)用 employees.base_salary 算日薪；
 * 薪資(preview_payroll)用 COALESCE(salary_structures.base_salary, employees.base_salary)。
 * 撈兩表比對：找出「salary_structures.base_salary 有值且 ≠ employees.base_salary」的在職員工
 * → 這些人的特休結清金額會跟實際月薪本薪不同源（可能偏低/偏高）。
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv() {
  const p = join(ROOT, '.env')
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
      .filter(([k]) => k))
}
const env = { ...loadEnv(), ...process.env }
const supa = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: emps, error: e1 } = await supa
  .from('employees').select('id, name, base_salary, status')
const { data: structs, error: e2 } = await supa
  .from('salary_structures').select('employee_id, base_salary')

if (e1 || e2) { console.error('查詢失敗:', e1?.message || e2?.message); process.exit(1) }

console.log(`撈到 employees=${emps?.length ?? 0} 筆、salary_structures=${structs?.length ?? 0} 筆`)

const ssMap = {}
for (const s of structs || []) ssMap[s.employee_id] = s.base_salary   // 一員工一筆，後蓋前

const active = (emps || []).filter(e => e.status === '在職')
const mismatches = []
let ssHasValue = 0
for (const e of active) {
  const ssBase = ssMap[e.id]
  if (ssBase != null && Number(ssBase) > 0) {
    ssHasValue++
    const empBase = Number(e.base_salary) || 0
    if (Number(ssBase) !== empBase) {
      mismatches.push({ name: e.name, emp_base: empBase, ss_base: Number(ssBase), diff: Number(ssBase) - empBase })
    }
  }
}

console.log(`在職員工 ${active.length} 人；其中 salary_structures.base_salary 有值的 ${ssHasValue} 人`)
console.log(`\n=== 兩邊本薪不一致(會影響特休結清金額) ===`)
if (!mismatches.length) {
  console.log('✓ 無不一致 — 所有在職員工 emp.base_salary == ss.base_salary（或 ss 無值）')
  console.log('  → 特休結清照舊讀 employees.base_salary 安全，金額不變。')
} else {
  console.log(`⚠ 有 ${mismatches.length} 人不一致：\n`)
  for (const m of mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)))
    console.log(`  ${m.name}: 員工表=${m.emp_base}  薪資結構=${m.ss_base}  日薪差=${(m.diff/30).toFixed(0)}/天`)
  console.log(`\n  → 這些人特休結清若用 employees.base_salary，跟實際月薪本薪不同源。`)
}
