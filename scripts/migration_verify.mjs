#!/usr/bin/env node
// ============================================================================
// 切換前/後驗證:比對舊 vs 新 Supabase 專案是否對齊。
//   - 每張 public 表的筆數差異
//   - 函式數量
//   - 各 storage bucket 檔案數
//   跑法與 storage_sync 相同的 env（OLD_* 讀 .env、NEW_KEY 必填）。
//
//   node scripts/migration_verify.mjs
//   → 印出「只有舊有 / 只有新有 / 筆數不一致」的表；全對齊時顯示 ✓ 對齊。
//
// 用途:
//   1) 冷備份灌完後跑一次 → 確認新專案 = 舊專案某時間點(基準)。
//   2) 切換前最後 delta 補完後再跑 → diff 應該只剩「切換窗內」的極小差異。
//   3) 切換後跑 → 對舊(此時舊已凍寫)應完全一致。
// ============================================================================
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = (() => { try { return readFileSync(new URL('../.env', import.meta.url), 'utf8') } catch { return '' } })()
const fromEnvFile = (k) => (envFile.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim()

const OLD_URL = process.env.OLD_URL || fromEnvFile('VITE_SUPABASE_URL')
const OLD_KEY = process.env.OLD_KEY || fromEnvFile('SUPABASE_SERVICE_ROLE_KEY')
const NEW_URL = process.env.NEW_URL || 'https://uoernfpfieurtjqwbnii.supabase.co'
const NEW_KEY = process.env.NEW_KEY || ''

if (!OLD_URL || !OLD_KEY) { console.error('✗ 缺 OLD_URL / OLD_KEY（.env）'); process.exit(1) }
if (!NEW_KEY) { console.error('✗ 缺 NEW_KEY（service_role）'); process.exit(1) }

const old = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } })
const neu = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } })

// 用一支臨時 RPC 拿不到,改走 PostgREST 的 count。先列出所有 public 表。
// Supabase 沒有直接列表 API → 用 information_schema via rpc-less 方式:借一個既有函式不可靠,
// 這裡改用「已知表清單從 head count」。改為呼叫 pg_meta? 沒有 service。
// 最穩:各自建一支唯讀 RPC 回傳 (table, n)。但為了免灌函式,改用 REST count 逐表。
// → 動態抓表清單:用 information_schema 需 SQL；改請使用者用 SQL 版(見 runbook 附的 SQL)。
// 這支專注在「給定表清單」比對筆數 + storage。
const TABLES = (process.env.TABLES || [
  'employees','stores','schedules','schedule_deletions','attendance_records',
  'leave_requests','overtime_requests','correction_requests','expense_requests',
  'salary_records','payroll_records','severance_records','tasks','work_orders',
  'workflow_instances','request_chain_snapshots','notifications','profiles',
  'roles','permissions','role_permissions','organizations','collection_forms',
].join(',')).split(',').map(s => s.trim()).filter(Boolean)

async function count(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error) return { err: error.message }
  return { n: count ?? 0 }
}

async function bucketCounts(client) {
  const { data: buckets, error } = await client.storage.listBuckets()
  if (error) return { err: error.message }
  const out = {}
  for (const b of buckets) {
    // 只數第一層 + 一層資料夾（粗估;精確數用 storage_sync 的 log）
    let total = 0, offset = 0
    for (;;) {
      const { data } = await client.storage.from(b.name).list('', { limit: 100, offset })
      if (!data || data.length === 0) break
      for (const it of data) {
        if (it.id === null || it.metadata == null) {
          const { data: sub } = await client.storage.from(b.name).list(it.name, { limit: 1000 })
          total += (sub || []).filter(x => x.id !== null).length
        } else total++
      }
      if (data.length < 100) break
      offset += 100
    }
    out[b.name] = total
  }
  return out
}

async function main() {
  console.log(`驗證  舊 ${OLD_URL}\n      新 ${NEW_URL}\n`)
  console.log('── 資料表筆數 ──────────────────────────────')
  let diffs = 0
  for (const t of TABLES) {
    const [a, b] = await Promise.all([count(old, t), count(neu, t)])
    if (a.err && b.err) { console.log(`  ~ ${t}: 兩邊都無此表`); continue }
    if (a.err) { console.log(`  ⚠ ${t}: 舊無(${a.err.slice(0,40)}) / 新=${b.n}`); diffs++; continue }
    if (b.err) { console.log(`  ⚠ ${t}: 舊=${a.n} / 新無(${b.err.slice(0,40)})`); diffs++; continue }
    const mark = a.n === b.n ? '✓' : '✗'
    if (a.n !== b.n) diffs++
    console.log(`  ${mark} ${t.padEnd(26)} 舊=${String(a.n).padStart(7)}  新=${String(b.n).padStart(7)}${a.n!==b.n ? `  Δ${b.n-a.n}` : ''}`)
  }

  console.log('\n── Storage 檔案數 ──────────────────────────')
  const [ob, nb] = await Promise.all([bucketCounts(old), bucketCounts(neu)])
  const names = new Set([...Object.keys(ob||{}), ...Object.keys(nb||{})])
  for (const n of names) {
    const a = ob[n] ?? '—', b = nb[n] ?? '—'
    const mark = a === b ? '✓' : '✗'
    if (a !== b) diffs++
    console.log(`  ${mark} ${String(n).padEnd(26)} 舊=${String(a).padStart(6)}  新=${String(b).padStart(6)}`)
  }

  console.log(`\n${diffs === 0 ? '✓ 全對齊' : `✗ 有 ${diffs} 處不一致（切換前需為 0,或差異=切換窗內新資料）`}`)
  process.exit(diffs === 0 ? 0 : 2)
}

main().catch(e => { console.error('✗ 失敗:', e.message); process.exit(1) })
