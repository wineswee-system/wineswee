// ============================================================
// 104 員工資料 → SQL 產生器
//
// 不連 DB，純讀 CSV 跟產 SQL 文字檔。
// 你直接把產出的 .sql 貼進 Supabase SQL Editor 跑就好。
//
// 使用：
//   1. 把 104 後台「員工資料匯出」CSV 放到專案根目錄，命名為 .tmp_104_employees.csv
//   2. 跑 `node scripts/build_104_sql.mjs`
//   3. 看 console 報告：是否有「DB 還沒有」的部門 / 門市 / 課別
//      → 有的話：先去 /org/departments 或 /org/locations UI 把它們建好
//   4. 沒警告或警告處理完 → 看 .tmp_104_import.sql
//   5. 開 Supabase SQL Editor → 貼 .tmp_104_import.sql 內容 → Run
//
// 環境變數（可選）：
//   ORG_ID  預設 1。如果你的 organization_id 不是 1，先 export ORG_ID=2 之類
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORG_ID = parseInt(process.env.ORG_ID || '1')
const CSV_PATH = join(ROOT, '.tmp_104_employees.csv')
const SQL_OUT = join(ROOT, '.tmp_104_import.sql')

// ── 104 欄位 → 自有 employees 欄位映射 ──
const COLUMN_MAP = {
  '員工編號':         'employee_number',
  '姓名':             'name',
  '英文姓名':         'name_en',
  '身分證字號':       'id_number',
  '生日':             'birth_date',
  '性別':             'gender',
  '行動電話':         'phone',
  '公司電話':         'work_phone',
  '通訊地址':         'address',
  '戶籍地址':         'registered_address',
  '公司email':        'email',
  '個人email':        'personal_email',
  '到職日期':         'join_date',
  '試滿日期':         'probation_end_date',
  '在職狀態':         'status',
  '員工類別':         'employment_type',
  '職位':             'position',
  '職務類別':         'job_category',
  '責任區分':         'responsibility_type',
  '編制狀態':         'staffing_status',
  '婚姻狀況':         'marital_status',
  '身份族群':         'ethnic_group',
  '身心障礙類別':     'disability_type',
  '兵役狀況':         'military_status',
  '留職/離職日期':    'resign_date',
  '復職日期':         'reinstatement_date',
  '聯絡人姓名/關係':  'emergency_contact_name',
  '聯絡人電話':       'emergency_contact_phone',
}

// 104 「員工編號 (附開頭符號)」可能有「外籍員工身分證」這類括號註解 → 取斜線左半
const STRIP_PARENS = (s) => String(s || '').split(/[（(]/)[0].trim()

const VALUE_TRANSFORMS = {
  status: (v) => {
    const s = String(v || '').trim()
    if (['在職', '正職', '在任', 'active', '1'].includes(s)) return '在職'
    if (['離職', 'inactive', 'resigned', '0'].includes(s)) return '離職'
    if (['留停', '留職停薪'].includes(s)) return '留職停薪'
    return s || '在職'
  },
  employment_type: (v) => {
    const s = String(v || '').trim()
    if (['全職', '正職', '月薪', 'FT', 'full'].includes(s)) return '全職'
    if (['兼職', '時薪', '工讀', 'PT', 'part'].includes(s)) return '兼職'
    return s || null
  },
  gender: (v) => {
    const s = String(v || '').trim()
    if (['男', 'M', 'male', '1'].includes(s)) return '男'
    if (['女', 'F', 'female', '2'].includes(s)) return '女'
    return null
  },
  birth_date: parseDate,
  join_date: parseDate,
  probation_end_date: parseDate,
  resign_date: parseDate,
  reinstatement_date: parseDate,
  id_number: (v) => STRIP_PARENS(v),  // 「A800104124/A800104124」→「A800104124」
}

function parseDate(v) {
  const s = String(v || '').trim()
  if (!s) return null
  const m = s.match(/^(\d{2,4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/)
  if (!m) return null
  let [, y, mo, d] = m
  y = parseInt(y); mo = parseInt(mo); d = parseInt(d)
  if (y < 200) y += 1911
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ── CSV parser（state machine：正確處理跨行的 quoted field + escaped quotes + BOM） ──
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  const rows = []
  let cur = '', row = [], inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (c === '"') {
      if (inQuote && next === '"') { cur += '"'; i++ }  // escaped ""
      else inQuote = !inQuote
    } else if (c === ',' && !inQuote) {
      row.push(cur); cur = ''
    } else if ((c === '\n' || c === '\r') && !inQuote) {
      if (c === '\r' && next === '\n') i++
      row.push(cur)
      if (row.some(x => String(x).trim())) rows.push(row)
      row = []; cur = ''
    } else {
      cur += c
    }
  }
  if (cur || row.length) {
    row.push(cur)
    if (row.some(x => String(x).trim())) rows.push(row)
  }

  // 找 header row：第一個 cells[1]='公司統編' 或含「員工編號」的 row
  let headerIdx = 0
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    if (rows[i][1] === '公司統編' || rows[i].includes('員工編號')) { headerIdx = i; break }
  }
  const headers = rows[headerIdx].map(h => String(h).trim())
  return rows.slice(headerIdx + 1).map(cells => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = String(cells[i] || '').trim() })
    return obj
  }).filter(r => r['員工編號'] || r['姓名'])
}

// ── SQL escape ──
const sqlStr = (v) => v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const sqlBool = (v) => v == null ? 'NULL' : (v ? 'true' : 'false')

// ── 部門/門市名稱別名 ──
// 1. MANUAL_ALIASES：手動指定 CSV 名稱 → DB 真實名稱（多個用陣列）
//    用於名稱完全不同的情況（人資部 → 人力資源部 等）
const MANUAL_ALIASES = {
  '人資部':         ['人力資源部'],
  '微風百貨門市':   ['微風廣場'],
  '研發課':         ['研發暨品管課'],
  '營運課':         ['研發暨品管課'],  // 同一個人 (Jack 羅紹輝) 已在 DB 的研發暨品管課
  'Mia':            ['MIa'],          // DB 用大寫 I
  // 業務部 / 管理部 不加 alias —— 那 3 人都離職，department_id 留 NULL 即可
  //（OrgChart 只顯示 status='在職'，不會出現）
}

// 2. 自動 alias：CSV 用「中山國小門市」但 DB 用「中山國小」之類
function deptAliases(name) {
  if (!name) return []
  const s = name.trim()
  const set = new Set([s])
  // 手動 alias
  for (const a of MANUAL_ALIASES[s] || []) set.add(a)
  // 去掉常見後綴
  const stripped = s.replace(/(門市|旗艦店|店|館)+$/g, '').trim()
  if (stripped && stripped !== s) set.add(stripped)
  // 加後綴
  if (!s.endsWith('門市') && !s.endsWith('旗艦店') && !s.endsWith('部') && !s.endsWith('課') && !s.endsWith('室')) {
    set.add(s + '門市')
  }
  return [...set]
}
const sqlNameList = (names) => names.map(n => sqlStr(n)).join(', ')

// ── 主流程 ──
function main() {
  let text
  try { text = readFileSync(CSV_PATH, 'utf8') }
  catch { console.error(`找不到 ${CSV_PATH}`); process.exit(1) }

  const rows = parseCSV(text)
  console.log(`✓ 讀到 ${rows.length} 筆員工`)

  // ── 統計：CSV 出現過的「部門」名稱 ──
  const deptCount = {}
  for (const r of rows) {
    const d = r['部門'] || '(空)'
    deptCount[d] = (deptCount[d] || 0) + 1
  }
  const uniqueDepts = Object.entries(deptCount).sort((a, b) => b[1] - a[1])

  console.log('\n📋 「部門」欄出現的所有名稱（依次數排序）：')
  console.table(uniqueDepts.map(([name, count]) => ({
    '部門/門市名稱': name,
    '人數': count,
    'SQL 會嘗試比對': name === '(空)' ? '—' : deptAliases(name).join(' / '),
  })))

  console.log(`\n⚠ DB 的 departments / stores / department_sections 任一表只要存在「SQL 會嘗試比對」那欄的任意一個名稱就會自動對應。`)
  console.log(`   找不到的話員工 department_id / store_id 會是 NULL，跑完最後 SELECT 會列出來。\n`)

  // ── 產出 SQL ──
  const lines = []
  lines.push('-- ============================================================')
  lines.push(`-- 104 員工資料匯入 SQL（auto-generated）`)
  lines.push(`-- 共 ${rows.length} 筆；organization_id = ${ORG_ID}`)
  lines.push(`-- 產生時間：${new Date().toISOString()}`)
  lines.push('-- ============================================================')
  lines.push('')
  lines.push('BEGIN;')
  lines.push('')

  // ── Section 1: 列出 CSV 出現過的部門/門市名（給人工檢查用，註解形式） ──
  lines.push('-- ─── Section 1: CSV 「部門」欄出現過的名稱（檢查用，無實際動作） ───')
  lines.push('-- 以下名稱必須在 departments、stores 或 department_sections 至少一個表存在；')
  lines.push('-- 不存在的話對應員工的 department_id / store_id 會是 NULL。')
  for (const [name, count] of uniqueDepts) {
    if (name === '(空)') continue
    lines.push(`--   「${name}」(${count} 人)`)
  }
  lines.push('')

  // ── Section 2: 員工資料 INSERT ON CONFLICT ──
  lines.push('-- ─── Section 2: 員工資料 UPSERT（依 employee_number 為唯一鍵） ───')

  const cols = [
    'employee_number', 'id_number', 'name', 'name_en', 'gender', 'birth_date',
    'marital_status', 'ethnic_group', 'disability_type', 'military_status',
    'phone', 'work_phone', 'email', 'personal_email', 'address', 'registered_address',
    'emergency_contact_name', 'emergency_contact_phone',
    'join_date', 'probation_end_date',
    'dept', 'department_id', 'store_id',
    'position', 'job_category', 'employment_type', 'responsibility_type',
    'staffing_status', 'status', 'resign_date', 'reinstatement_date',
    'organization_id',
  ]

  let exported = 0, skipped = 0
  for (const r of rows) {
    const empData = { organization_id: ORG_ID }
    for (const [k104, kOurs] of Object.entries(COLUMN_MAP)) {
      let v = r[k104]
      if (v === '' || v == null) continue
      if (VALUE_TRANSFORMS[kOurs]) v = VALUE_TRANSFORMS[kOurs](v)
      if (v == null || v === '') continue
      empData[kOurs] = v
    }

    // 「部門」欄 → 用 SQL 子查詢 lookup（不在這支 script 裡解析；DB 跑時自己對）
    const deptText = r['部門'] || ''
    if (deptText) {
      empData.dept = deptText
      // department_id / store_id 用 SQL 子查詢，跑的時候才查 DB
      // 但 INSERT 一定要有具體值，所以用 COALESCE + 三層 lookup
    }

    if (!empData.employee_number) {
      skipped++
      continue
    }

    // 組 INSERT statement —— 每筆 INSERT 全部單行，避免 Supabase Editor 多行解析問題
    const aliases = deptAliases(deptText)
    const aliasList = sqlNameList(aliases)
    const values = cols.map(c => {
      if (c === 'department_id') {
        if (!deptText) return 'NULL'
        return `COALESCE((SELECT id FROM departments WHERE name IN (${aliasList}) LIMIT 1),(SELECT department_id FROM stores WHERE name IN (${aliasList}) LIMIT 1),(SELECT department_id FROM department_sections WHERE name IN (${aliasList}) LIMIT 1))`
      }
      if (c === 'store_id') {
        if (!deptText) return 'NULL'
        return `(SELECT id FROM stores WHERE name IN (${aliasList}) LIMIT 1)`
      }
      if (c === 'organization_id') return ORG_ID
      return sqlStr(empData[c])
    })

    const updateSet = cols.filter(c => c !== 'employee_number').map(c => {
      if (c === 'department_id' || c === 'store_id') return `${c}=EXCLUDED.${c}`
      return `${c}=COALESCE(EXCLUDED.${c},employees.${c})`
    })

    lines.push(`-- ${empData.employee_number} ${empData.name || ''}${empData.name_en ? ' (' + empData.name_en + ')' : ''} | ${deptText || '(無部門)'}`)
    lines.push(`INSERT INTO employees (${cols.join(',')}) VALUES (${values.join(',')}) ON CONFLICT (employee_number) DO UPDATE SET ${updateSet.join(',')};`)

    exported++
  }

  // ── Section 3: 跑完查驗 ──
  lines.push('-- ─── Section 3: 查驗（commit 前看一下，有沒有 NULL department_id 但 dept 文字有填的） ───')
  lines.push(`SELECT COUNT(*) AS total_employees FROM employees WHERE organization_id = ${ORG_ID};`)
  lines.push(`SELECT employee_number, name, dept, department_id, store_id`)
  lines.push(`FROM employees`)
  lines.push(`WHERE organization_id = ${ORG_ID} AND dept IS NOT NULL AND department_id IS NULL AND store_id IS NULL`)
  lines.push(`ORDER BY dept;  -- 這些是「部門」欄文字對不到 DB 任何 table，需要先補建再重跑`)
  lines.push('')
  lines.push('COMMIT;')
  lines.push('')
  lines.push(`-- ─── 完成。共 ${exported} 筆；跳過 ${skipped} 筆（無 employee_number） ───`)

  // 不加 BOM（Supabase SQL Editor 對 BOM 敏感），純 UTF-8 + LF
  writeFileSync(SQL_OUT, lines.join('\n'), 'utf8')

  console.log(`\n✓ SQL 已寫入 ${SQL_OUT}`)
  console.log(`  共 ${exported} 筆員工，跳過 ${skipped} 筆（無 employee_number）`)
  console.log(`\n下一步：`)
  console.log(`  1. 用編輯器打開 .tmp_104_import.sql`)
  console.log(`  2. 全選複製 → 貼進 Supabase SQL Editor`)
  console.log(`  3. 按 Run`)
  console.log(`  4. 跑完看最後一個 SELECT 的結果（dept 文字對不到 DB 的）→ 補建後可再跑同一段 SQL（ON CONFLICT 會 update）`)
}

main()
