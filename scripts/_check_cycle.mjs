#!/usr/bin/env node
/**
 * _check_cycle.mjs — 驗證「天母百貨」的變形週期設定 + getCycleFor(07-08) 實際算幾天
 * 確認排班 4 週變 5 週是不是 storeSettings race（用錯門市設定算 cycle）。
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getCycleFor } from '../src/lib/scheduleUtils.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv() {
  const p = join(ROOT, '.env'); if (!existsSync(p)) return {}
  return Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }).filter(([k]) => k))
}
const env = { ...loadEnv(), ...process.env }
const supa = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: store } = await supa.from('stores').select('id, name').eq('name', '天母百貨').maybeSingle()
if (!store) { console.log('找不到天母百貨'); process.exit(0) }
const { data: ss } = await supa.from('store_settings').select('*').eq('store_id', store.id).maybeSingle()

console.log(`天母百貨 (store_id=${store.id})`)
console.log(`  work_hour_system     = ${ss?.work_hour_system}`)
console.log(`  variable_period_start= ${ss?.variable_period_start}`)

if (ss?.work_hour_system && ss?.variable_period_start) {
  const c = getCycleFor('2026-07-08', ss.work_hour_system, ss.variable_period_start)
  if (c) {
    const days = Math.round((new Date(c.end) - new Date(c.start)) / 86400000) + 1
    console.log(`\ngetCycleFor('2026-07-08', '${ss.work_hour_system}', '${ss.variable_period_start}'):`)
    console.log(`  → ${c.start} ~ ${c.end}  (${days} 天 = ${days/7} 週)`)
    console.log(days === 28 ? '\n✓ 天母百貨本來就是 4 週(28天) → 截圖的「5週」確實是 race 用錯門市設定造成'
                            : `\n⚠ 天母百貨算出 ${days} 天，不是 28 → 可能門市設定本身或 getCycleFor 有問題`)
  }
}

// 列出其他變形門市的週數，看「上一個門市」可能是誰造成 5 週
const { data: allSS } = await supa.from('store_settings').select('store_id, work_hour_system, variable_period_start')
  .not('work_hour_system', 'is', null)
console.log('\n各門市變形週期（找 5 週的嫌疑門市）:')
for (const s of allSS || []) {
  if (!s.variable_period_start || s.work_hour_system === '標準工時') continue
  const c = getCycleFor('2026-07-08', s.work_hour_system, s.variable_period_start)
  if (c) {
    const days = Math.round((new Date(c.end) - new Date(c.start)) / 86400000) + 1
    console.log(`  store ${s.store_id}: ${s.work_hour_system} → ${days} 天 (${days/7} 週)`)
  }
}
