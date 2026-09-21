#!/usr/bin/env node
/**
 * resolve-errors.mjs — Auto-resolve error_logs entries from git commit messages
 *
 * Reads recent commits, extracts error codes using the fix() convention,
 * then calls the resolve_errors_by_codes Supabase RPC to bulk-resolve
 * all matching open errors in the database.
 *
 * ── Commit convention ────────────────────────────────────────────────────────
 *
 *   fix(ERROR_CODE): short description of the fix
 *   fix(MODULE:ERROR_CODE): fix scoped to a module (module part is stripped)
 *
 * Examples:
 *   fix(SAVE_FAILED): add null check for order.id before insert
 *   fix(HR:INSERT_FAILED): validate employee_id exists before salary insert
 *   fix(Runtime:REACT_ERROR_BOUNDARY): wrap ChartView in Suspense boundary
 *   fix(UNHANDLED_REJECTION): handle missing warehouse_id gracefully
 *
 * Multiple codes in one commit:
 *   fix(SAVE_FAILED,INSERT_FAILED): harden insert helpers across sales module
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/resolve-errors.mjs              # resolve from last 1 commit (git hook mode)
 *   node scripts/resolve-errors.mjs --commits=5  # look at last 5 commits
 *   node scripts/resolve-errors.mjs --since=v1.2.0  # since a tag or SHA
 *   node scripts/resolve-errors.mjs --dry-run    # print what would be resolved, don't write
 *   npm run resolve-errors                       # alias
 *
 * ── Environment ──────────────────────────────────────────────────────────────
 *
 *   Required in .env (or environment):
 *     VITE_SUPABASE_URL      — your Supabase project URL
 *     VITE_SUPABASE_ANON_KEY — anon key (the RPC is SECURITY DEFINER so anon is enough)
 *
 *   Optional:
 *     SUPABASE_SERVICE_ROLE_KEY — if set, used instead of anon key
 *     GITHUB_REPOSITORY         — set automatically by GitHub Actions (owner/repo)
 */

import { createClient } from '@supabase/supabase-js'
import { execSync }      from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')

// ── ANSI colours (gracefully degrade when not a TTY) ─────────────────────────

const isTTY = process.stdout.isTTY
const c = {
  reset:  isTTY ? '\x1b[0m'  : '',
  bold:   isTTY ? '\x1b[1m'  : '',
  green:  isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  red:    isTTY ? '\x1b[31m' : '',
  cyan:   isTTY ? '\x1b[36m' : '',
  grey:   isTTY ? '\x1b[90m' : '',
}
const ok      = (s) => `${c.green}✓${c.reset} ${s}`
const warn    = (s) => `${c.yellow}⚠${c.reset}  ${s}`
const fail    = (s) => `${c.red}✗${c.reset} ${s}`
const info    = (s) => `${c.grey}  ${s}${c.reset}`
const heading = (s) => `\n${c.bold}${c.cyan}${s}${c.reset}`

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=')
      return [k, v ?? true]
    })
)

const DRY_RUN      = args['dry-run'] === true || args['dry-run'] === 'true'
const COMMITS_BACK = args.commits ? parseInt(args.commits, 10) : 1
const SINCE_REF    = args.since ?? null   // e.g. 'v1.2.0' or 'HEAD~10'
const RESOLVER     = args.resolver ?? null // override resolver display name

// ── Load .env ─────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = join(ROOT, '.env')
  if (!existsSync(envPath)) return {}
  const raw = readFileSync(envPath, 'utf8')
  return Object.fromEntries(
    raw.split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => {
        const idx = l.indexOf('=')
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
      })
      .filter(([k]) => k)
  )
}

const env = { ...loadEnv(), ...process.env }

const SUPABASE_URL = env.VITE_SUPABASE_URL
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(fail('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env'))
  process.exit(1)
}

// ── Supabase client ───────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Git helpers ───────────────────────────────────────────────────────────────

function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

function getCommits() {
  // Git log format: HASH<US>SUBJECT<US>BODY  (US = unit separator \x1f)
  const range = SINCE_REF ? `${SINCE_REF}..HEAD` : `HEAD~${COMMITS_BACK}..HEAD`
  const raw   = git(`git log ${range} --format=%H%x1f%s%x1f%b`)

  if (!raw) {
    // Fallback for first commit (no parent) or empty range
    const hash    = git('git rev-parse HEAD')
    const subject = git('git log -1 --format=%s')
    const body    = git('git log -1 --format=%b')
    return hash ? [{ hash, message: `${subject}\n${body}` }] : []
  }

  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const parts = line.split('\x1f')
      return { hash: parts[0] || '', message: `${parts[1] || ''}\n${parts[2] || ''}` }
    })
    .filter(commit => commit.hash)
}

function getGitUser() {
  const name  = git('git config user.name')
  const email = git('git config user.email')
  return name ? `${name} <${email}>` : email || 'automation'
}

function buildCommitUrl(hash) {
  // GitHub Actions sets GITHUB_REPOSITORY automatically
  const repo = env.GITHUB_REPOSITORY
  if (repo) return `https://github.com/${repo}/commit/${hash}`
  // Derive from git remote if possible
  const remote = git('git remote get-url origin').replace(/\.git$/, '')
  if (remote.includes('github.com')) return `${remote}/commit/${hash}`
  return hash
}

// ── Error code extraction ─────────────────────────────────────────────────────
//
// Supported patterns (case-insensitive keyword, uppercase code):
//
//   fix(ERROR_CODE)               → ['ERROR_CODE']
//   fix(MODULE:ERROR_CODE)        → ['ERROR_CODE']  (module prefix stripped)
//   fix(CODE_A, CODE_B)           → ['CODE_A', 'CODE_B']
//   fixes ERROR_CODE              → ['ERROR_CODE']  (bare keyword form)
//   resolves ERROR_CODE           → ['ERROR_CODE']
//   closes ERROR_CODE             → ['ERROR_CODE']

const PAREN_RE = /\bfix(?:es|ed)?\s*\(([^)]+)\)/gi
const BARE_RE  = /\b(?:fix(?:es|ed)?|resolve[sd]?|close[sd]?)\s+(?:[A-Za-z]+:)?([A-Z][A-Z0-9_]{3,})\b/g

function extractErrorCodes(message) {
  const codes = new Set()
  let m

  // Pattern 1: fix(CODE) or fix(MODULE:CODE) or fix(A, B)
  // Error codes MUST be ALL_CAPS — rejects lowercase scope names like fix(process)
  while ((m = PAREN_RE.exec(message)) !== null) {
    for (const part of m[1].split(',')) {
      const segments = part.trim().split(':')
      const raw = segments[segments.length - 1].trim()
      // Must match ALL_CAPS_WITH_UNDERSCORES, min 4 chars
      if (/^[A-Z][A-Z0-9_]{3,}$/.test(raw)) codes.add(raw)
    }
  }
  PAREN_RE.lastIndex = 0

  // Pattern 2: fixes/resolves/closes CODE (without parens)
  while ((m = BARE_RE.exec(message)) !== null) {
    codes.add(m[1].trim())
  }
  BARE_RE.lastIndex = 0

  return [...codes]
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(heading('🔧  Auto-resolve Error Logs from Git Commits'))
  if (DRY_RUN) console.log(warn('DRY RUN — no changes will be written to the database\n'))

  // 1. Get commits in range
  const commits = getCommits()
  if (commits.length === 0) {
    console.log(info('No commits in range — nothing to do.'))
    return
  }

  console.log(info(`Scanning ${commits.length} commit(s)…\n`))

  // 2. Extract error codes from all commits in range
  const resolveMap = new Map() // errorCode → latest commit that mentions it

  for (const commit of commits) {
    const codes = extractErrorCodes(commit.message)
    const subject = commit.message.split('\n')[0].trim()

    if (codes.length > 0) {
      for (const code of codes) resolveMap.set(code, commit)
      console.log(ok(`${commit.hash.slice(0, 8)}  ${subject.slice(0, 72)}`))
      console.log(info(`  → fix codes: ${codes.join(', ')}`))
    } else {
      console.log(info(`${commit.hash.slice(0, 8)}  ${subject.slice(0, 72)}  (no fix() — skipped)`))
    }
  }

  if (resolveMap.size === 0) {
    console.log('\n' + warn('No fix(ERROR_CODE) references found in commit message(s).'))
    console.log(info('Tip: add  fix(ERROR_CODE): description  to your commit message to auto-resolve.'))
    console.log(info('     e.g. fix(SAVE_FAILED): add null check for order.id'))
    return
  }

  const allCodes    = [...resolveMap.keys()]
  const latestCommit = commits[0]
  const commitUrl   = buildCommitUrl(latestCommit.hash)
  const subject     = latestCommit.message.split('\n')[0].trim()

  console.log(`\n${c.bold}Codes to resolve (${allCodes.length}):${c.reset} ${allCodes.join(', ')}`)

  if (DRY_RUN) {
    console.log('\n' + warn('DRY RUN — skipping database write. Remove --dry-run to apply.'))
    return
  }

  // 3. Call the Supabase RPC
  const resolvedBy     = `git-hook: ${RESOLVER ?? getGitUser()}`
  const resolutionNote = subject.slice(0, 500)
  const fixReference   = commitUrl

  console.log(info(`\nCalling resolve_errors_by_codes RPC…`))
  console.log(info(`  resolved_by:  ${resolvedBy}`))
  console.log(info(`  note:         ${resolutionNote.slice(0, 80)}`))
  console.log(info(`  reference:    ${fixReference}`))

  const { data, error } = await supabase.rpc('resolve_errors_by_codes', {
    p_error_codes:     allCodes,
    p_resolved_by:     resolvedBy,
    p_resolution_note: resolutionNote,
    p_fix_reference:   fixReference,
  })

  if (error) {
    console.error('\n' + fail(`RPC call failed: ${error.message}`))
    if (error.message?.includes('permission') || error.message?.includes('not exist')) {
      console.error(info('Run `supabase db push` to apply the resolve_errors_by_codes migration first.'))
    }
    process.exit(1)
  }

  // 4. Report results
  const resolved = data?.resolved_count ?? 0
  console.log()
  if (resolved > 0) {
    console.log(ok(`${c.bold}Resolved ${resolved} open error(s)${c.reset} in error_logs ✓`))
  } else {
    console.log(info(`Codes matched (${allCodes.join(', ')}) but no open errors found.`))
    console.log(info('(They may already be resolved, or not yet logged in this environment.)'))
  }
}

main().catch(err => {
  console.error('\n' + fail(err.message))
  process.exit(1)
})
