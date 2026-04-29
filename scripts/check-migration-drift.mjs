// Compare local migration files (supabase/migrations/*.sql) against
// remote schema_migrations table. Flags:
//   ⚠️  DRIFT   — remote has it, local doesn't (someone ran SQL via Studio)
//   🟡 PENDING — local has it, remote doesn't (needs `supabase db push`)
//   ✅ SYNCED  — both
//
// Run: node scripts/check-migration-drift.mjs

import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

// 1) Local versions (filename prefix before first underscore)
const localVersions = new Set(
  readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .map(f => f.split('_')[0])
)

// 2) Remote versions via `supabase db query`
const sql = "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;"
let remoteRows
try {
  const raw = execSync(`npx --yes supabase db query --linked --workdir "${ROOT}" "${sql}"`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  })
  // Output has a few preamble lines before the JSON; find the first {
  const jsonStart = raw.indexOf('{')
  remoteRows = JSON.parse(raw.slice(jsonStart)).rows
} catch (e) {
  console.error('❌ Failed to query remote DB. Is the project linked?')
  console.error(e.stderr?.toString() || e.message)
  process.exit(1)
}

const remoteByVersion = new Map(remoteRows.map(r => [r.version, r.name]))

// 3) Compare
const drift = []   // remote-only
const pending = [] // local-only
const synced = []  // both
for (const v of remoteByVersion.keys()) {
  if (localVersions.has(v)) synced.push(v)
  else drift.push({ version: v, name: remoteByVersion.get(v) })
}
for (const v of localVersions) {
  if (!remoteByVersion.has(v)) pending.push(v)
}

// 4) Report
console.log(`📊 Migration drift report`)
console.log(`   Local files : ${localVersions.size}`)
console.log(`   Remote rows : ${remoteByVersion.size}`)
console.log(`   ✅ Synced   : ${synced.length}`)
console.log()

if (drift.length === 0 && pending.length === 0) {
  console.log('🎉 No drift. Local and remote are in sync.')
  process.exit(0)
}

if (drift.length) {
  console.log(`⚠️  REMOTE-ONLY (applied via Studio, not in repo) — ${drift.length}`)
  for (const d of drift) console.log(`     ${d.version}  ${d.name}`)
  console.log(`   → backfill with: npx supabase db query --linked "SELECT array_to_string(statements, E';\\n\\n') FROM supabase_migrations.schema_migrations WHERE version = '<v>'"`)
  console.log()
}

if (pending.length) {
  console.log(`🟡 LOCAL-ONLY (not yet pushed to remote) — ${pending.length}`)
  for (const v of pending) console.log(`     ${v}`)
  console.log(`   → push with: supabase db push`)
  console.log()
}

process.exit(drift.length ? 2 : 0) // exit 2 if drift detected (CI-friendly)
