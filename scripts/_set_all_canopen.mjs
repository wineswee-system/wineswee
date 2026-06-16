#!/usr/bin/env node
// 把所有員工 can_open / can_close 設為 true。先記錄原本是 false 的人（可復原），再全開。
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'fs'
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

// 1) 記錄原本 can_open=false 或 can_close=false 的人（供復原）
const { data: before } = await supa.from('employees')
  .select('id, name, store, can_open, can_close')
  .or('can_open.eq.false,can_close.eq.false')
const snap = join(ROOT, 'scripts', '_canopen_before.json')
writeFileSync(snap, JSON.stringify(before || [], null, 2), 'utf8')
console.log(`原本「開店或關店=不可」的有 ${before?.length || 0} 人，已記錄到 scripts/_canopen_before.json（可復原）`)

// 2) 全部設為可開可關
const { data: updated, error } = await supa.from('employees')
  .update({ can_open: true, can_close: true })
  .not('id', 'is', null)
  .select('id')
if (error) { console.error('✗ 更新失敗：', error.message); process.exit(1) }
console.log(`✓ 已將 ${updated?.length || 0} 位員工的 can_open / can_close 全設為 true`)

// 3) 驗證
const { data: all } = await supa.from('employees').select('can_open, can_close')
const stuck = (all || []).filter(e => e.can_open !== true || e.can_close !== true).length
console.log(stuck === 0 ? '✓ 驗證：全部員工皆可開可關' : `⚠ 仍有 ${stuck} 人非全開（可能 RLS 擋）`)
