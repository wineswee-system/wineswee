#!/usr/bin/env node
/**
 * db-drift.mjs — 關鍵 DB 函式定義快照 + drift 偵測
 *
 * 抓「有人在 Supabase Studio 直接改了高風險函式卻沒回填 migration」的情況
 * （本專案最常實際炸 production 的根因）。
 *
 * 流程：
 *   1. 呼叫 _dump_function_defs RPC，取得 live DB 當下關鍵函式的完整定義
 *   2. 寫成 git-tracked 快照 supabase/snapshots/critical-functions.sql
 *   3. 用 git status 判斷：
 *        - 無變動  → ✓ 無 drift
 *        - 首次/untracked → 初始快照，請 commit 當基準
 *        - 有變動  → ⚠ DRIFT！印 diff，exit 2（可接 CI 或 git hook）
 *
 * 用法：
 *   npm run db:drift          # 偵測 + 更新快照
 *   定期跑（或排程），快照有 diff 就代表 DB 被人動過。
 *
 * 環境（.env 或 environment）：
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   ← 必須；函式定義不對外，RPC 只給 service_role
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── 高風險函式：高頻重寫 / 攸關錢與簽核（drift 最危險的一批）──
const CRITICAL = [
  'generate_payroll',
  'resolve_snapshot_step_approvers',
  '_employee_matches_chain_step',
  '_employee_matches_snapshot_step',
  'expense_request_step_advance',
  'expense_settle_step_advance',
  'hr_chain_approve',
  'form_submission_chain_approve',
  'liff_approve_request',
  'liff_list_pending_approvals',
  'classify_overtime_category_v2',
  'security_health_check',
]

function loadEnv() {
  const p = join(ROOT, '.env')
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf8').split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
      .filter(([k]) => k)
  )
}

const env = { ...loadEnv(), ...process.env }
const URL = env.VITE_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !KEY) {
  console.error('✗ 需要 .env 的 VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
  console.error('  （函式定義含薪資/簽核邏輯，不對外，必須用 service role key）')
  process.exit(1)
}

const supa = createClient(URL, KEY, { auth: { persistSession: false } })

const { data, error } = await supa.rpc('_dump_function_defs', { p_names: CRITICAL })
if (error) {
  console.error('✗ RPC _dump_function_defs 失敗：', error.message)
  console.error('  （先在 Studio 跑 migration 20260615120000_dump_function_defs.sql）')
  process.exit(1)
}

const rows = (data || []).sort((a, b) =>
  (a.fn_name + a.fn_args).localeCompare(b.fn_name + b.fn_args))

let out = '-- ⚠️ 自動產生，請勿手改 —— npm run db:drift\n'
out += '-- 此檔是「關鍵 DB 函式」在 live DB 的定義快照。\n'
out += '-- git diff 此檔有變 = 有人在 DB 改了函式（可能是 Studio hotfix 沒回填 migration）。\n\n'
for (const r of rows) {
  out += `-- ═══════════ ${r.fn_name}(${r.fn_args}) ═══════════\n${r.fn_def};\n\n`
}
const found = new Set(rows.map(r => r.fn_name))
const missing = CRITICAL.filter(n => !found.has(n))
if (missing.length) out += `-- ⚠️ 清單中找不到（可能改名/刪除/未部署）：${missing.join(', ')}\n`

const dir = join(ROOT, 'supabase', 'snapshots')
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
const REL = 'supabase/snapshots/critical-functions.sql'
writeFileSync(join(ROOT, REL), out, 'utf8')

console.log(`抓到 ${rows.length} 個函式定義${missing.length ? `（${missing.length} 個找不到）` : ''}`)

// ── git status 判斷 drift ──
const status = execSync(`git status --porcelain -- "${REL}"`, { cwd: ROOT }).toString().trim()
if (!status) {
  console.log('✓ 無 drift：關鍵函式定義與上次快照一致')
  process.exit(0)
} else if (status.startsWith('??')) {
  console.log(`初始快照已建立：${REL}`)
  console.log('→ 請 git add + commit 當作基準。之後每次跑會比對這份。')
  process.exit(0)
} else {
  console.log('\n⚠️  偵測到 DRIFT —— 以下函式在 DB 的定義與上次快照不同：\n')
  console.log(execSync(`git diff --stat -- "${REL}"`, { cwd: ROOT }).toString())
  console.log('檢視完整差異：  git diff -- ' + REL)
  console.log('→ 若是合理改動：commit 這份新快照。')
  console.log('→ 若是有人 Studio 直接改沒回填：請補一支 migration 把改動正規化。')
  process.exit(2)
}
