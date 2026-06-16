#!/usr/bin/env node
// 唯讀：看 employees 實際欄位 + org_id + 門市清單（給匯入 2 名新員工做欄位對應）
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv() {
  const p = join(ROOT, '.env'); if (!existsSync(p)) return {}
  return Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }).filter(([k]) => k))
}
const env = { ...loadEnv(), ...process.env }
const supa = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: emp } = await supa.from('employees').select('*').limit(1)
console.log('=== employees 欄位 ===')
console.log(emp?.[0] ? Object.keys(emp[0]).join(', ') : '(無資料)')

const { data: orgs } = await supa.from('employees').select('organization_id').limit(500)
const orgCount = {}
for (const e of orgs || []) orgCount[e.organization_id] = (orgCount[e.organization_id] || 0) + 1
console.log('\n=== organization_id 分布 ===')
console.log(orgCount)

const { data: stores } = await supa.from('stores').select('id, name, organization_id').order('id')
console.log('\n=== 門市清單 ===')
for (const s of stores || []) console.log(`  ${s.id}\t${s.name}\t(org ${s.organization_id})`)
const match = (stores || []).find(s => s.name.includes('台中文心') || s.name.includes('文心'))
console.log('\n台中文心門市 →', match ? `已存在 (id=${match.id})` : '⚠ 不存在')

// 看現有員工的關鍵欄位範例值（了解 employment_type/status/dept/store 怎麼填）
const { data: sample } = await supa.from('employees')
  .select('name, employee_number, dept, store, store_id, employment_type, status, gender, nationality, position')
  .eq('status', '在職').limit(3)
console.log('\n=== 現有員工範例（看欄位怎麼填）===')
console.log(JSON.stringify(sample, null, 2))

// 已存在的這 2 個編號？
const { data: dup } = await supa.from('employees').select('name, employee_number')
  .in('employee_number', ['L2026122', 'P20260046'])
console.log('\n=== 這 2 個編號是否已存在 ===')
console.log(dup?.length ? dup : '都不存在（可新增）')
