// ════════════════════════════════════════════════════════════════════════════
// 匯入員工銀行帳號 → employee_bank_accounts（你自己在本機跑，帳號不外傳）
//
// CSV 欄位順序（第一列若是標題會自動跳過）：
//   員工編號, 姓名, 銀行代號, 分行代號, 帳號
//
// 用法：
//   1. 把名冊存成 UTF-8 的 CSV，預設路徑 ./bank_accounts.csv（或當參數傳）
//   2. node scripts/import_bank.mjs              # 預設讀 ./bank_accounts.csv
//      node scripts/import_bank.mjs 路徑.csv     # 指定檔案
//      node scripts/import_bank.mjs 路徑.csv --dry   # 只比對不寫入（先試跑）
//
// 走 service_role + import_employee_bank_account RPC（DEFINER）；資料只在你電腦↔你的DB。
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const csvPath = args.find(a => !a.startsWith('--')) || join(ROOT, 'bank_accounts.csv')
if (!existsSync(csvPath)) { console.error('找不到檔案:', csvPath, '\n請把名冊存成 bank_accounts.csv 放專案根目錄,或當參數傳路徑'); process.exit(1) }

// ── 讀檔（UTF-8;若亂碼自動退 Big5/CP950）──
const buf = readFileSync(csvPath)
let text = new TextDecoder('utf-8').decode(buf)
if (text.includes('�')) {
  try { text = new TextDecoder('big5').decode(buf); console.log('（偵測到非 UTF-8,改用 Big5 解碼）') } catch { /* keep utf8 */ }
}

// ── 簡易 CSV 解析（支援雙引號欄位）──
function parseLine(line) {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(parseLine)
// 跳過標題列
if (rows.length && /編號|姓名|帳號|代號/.test(rows[0].join(''))) rows.shift()

console.log(`讀到 ${rows.length} 筆${dry ? '（--dry 試跑,不寫入）' : ''}\n`)

let ok = 0, fail = 0
const fails = []
for (const r of rows) {
  const [empNo, name, bankCode, branch, account] = r
  if (dry) {
    // 試跑：只查員工對得到對不到
    let { data: e } = await supabase.from('employees').select('id,name').eq('employee_number', (empNo || '').trim()).maybeSingle()
    if (!e && name) { const r2 = await supabase.from('employees').select('id,name').eq('name', name.trim()).maybeSingle(); e = r2.data }
    if (e) { ok++ } else { fail++; fails.push(`${empNo} ${name}`) }
    continue
  }
  const { data, error } = await supabase.rpc('import_employee_bank_account', {
    p_employee_number: empNo || '', p_name: name || '',
    p_bank_code: bankCode || '', p_bank_branch: branch || '', p_bank_account: account || '',
  })
  if (error) { fail++; fails.push(`${empNo} ${name} — RPC err: ${error.message}`) }
  else if (data?.ok) { ok++ }
  else { fail++; fails.push(`${empNo} ${name} — ${data?.error || 'unknown'}`) }
}

console.log(`✓ 成功 ${ok}  ✗ 對不到/失敗 ${fail}`)
if (fails.length) { console.log('\n對不到的(請檢查員工編號/姓名是否跟系統一致):'); fails.forEach(f => console.log('  - ' + f)) }
console.log(dry ? '\n試跑完成,沒寫入。確認 OK 後拿掉 --dry 再跑一次正式匯入。' : '\n匯入完成。')
