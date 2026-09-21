// ============================================================
// 104 員工資料匯入腳本（範本）
//
// 使用：
//   1. 把 104 後台「員工資料匯出」的 .xlsx 轉成 .csv (UTF-8)
//   2. 放到 .tmp_104_employees.csv
//   3. 跑 `node scripts/import_104_employees.mjs --dry-run`（預覽）
//   4. 確認沒問題 → `node scripts/import_104_employees.mjs --execute`
//
// 環境變數：
//   SUPABASE_URL          (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_KEY  (service role key，不是 anon)
// ============================================================

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = !process.argv.includes('--execute')

// ── Supabase client (service role 才能繞 RLS) ──
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('需要 SUPABASE_URL + SUPABASE_SERVICE_KEY 環境變數')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

// ── 104 欄位 → 自有 employees 欄位映射 ──
const COLUMN_MAP = {
  // 直接對應
  '員工編號':   'employee_number',
  '姓名':       'name',
  '英文姓名':   'name_en',
  '身分證字號': 'id_number',
  '生日':       'birth_date',
  '性別':       'gender',
  '行動電話':   'phone',
  '公司電話':   'work_phone',
  '通訊地址':   'address',
  '戶籍地址':   'registered_address',
  '公司email':  'email',
  '個人email':  'personal_email',
  '到職日期':   'join_date',
  '試滿日期':   'probation_end_date',
  '在職狀態':   'status',
  '員工類型':   'employment_type',
  '職位':       'position',
  '職務類別':   'job_category',
  '責任區分':   'responsibility_type',
  '編制狀態':   'staffing_status',
  '婚姻狀況':   'marital_status',
  '身份族群':   'ethnic_group',
  '身心障礙類別': 'disability_type',
  '兵役狀況':   'military_status',
  '留停/離職日期': 'resign_date',
  '復職日期':   'reinstatement_date',
  // 緊急聯絡人
  '聯絡人姓名/關係': 'emergency_contact_name',
  '聯絡人電話':       'emergency_contact_phone',
  // 104 匯出實際 header 用「留職/離職日期」（不是「留停/離職日期」）
  '留職/離職日期':    'resign_date',
}

// ── 值轉換函式 ──
const VALUE_TRANSFORMS = {
  status: (v) => {
    if (!v) return '在職'
    const s = String(v).trim()
    if (['在職', 'active', '1', '正職', '在任'].includes(s)) return '在職'
    if (['離職', 'resigned', 'inactive', '0'].includes(s)) return '離職'
    return s
  },
  employment_type: (v) => {
    if (!v) return null
    const s = String(v).trim()
    if (['全職', '正職', 'FT', 'full', '月薪'].includes(s)) return '全職'
    if (['兼職', 'PT', 'part', '時薪', '工讀'].includes(s)) return '兼職'
    return s
  },
  gender: (v) => {
    if (!v) return null
    const s = String(v).trim()
    if (['男', 'M', 'male', '1'].includes(s)) return '男'
    if (['女', 'F', 'female', '2'].includes(s)) return '女'
    return s
  },
  birth_date: parseDate,
  join_date: parseDate,
  probation_end_date: parseDate,
  resign_date: parseDate,
  reinstatement_date: parseDate,
  is_direct_staff: (v) => {
    if (!v) return null
    const s = String(v).trim()
    if (['直接', 'direct', 'true', '是'].includes(s)) return true
    if (['間接', 'indirect', 'false', '否'].includes(s)) return false
    return null
  },
}

function parseDate(v) {
  if (!v) return null
  const s = String(v).trim()
  if (!s) return null
  // 民國 113.01.15 / 2024.01.15 / 2024/1/15 / 2024-01-15
  let m
  if ((m = s.match(/^(\d{2,4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})$/))) {
    let [, y, mo, d] = m
    y = parseInt(y); mo = parseInt(mo); d = parseInt(d)
    if (y < 200) y += 1911   // 民國 → 西元
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

// ── 解析 CSV ──
// 104 原檔結構：
//   line 1-5: 公司名 / 資料類型 / 匯出日期 / 篩選條件 / 共幾筆（meta）
//   line 6: 空行
//   line 7: 類別 header（基本資料 / 聯絡資料 / 職務 ...）
//   line 8: 真正欄位 header（# 那行）
//   line 9+: 資料
function parseCSV(text) {
  // 去 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  // 自動偵測 header：找第一行第一個 cell = '#' 的下一行作為 header
  let headerIdx = 0
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const cells = parseRow(lines[i])
    // 104 的 header 行第一格是空（因為 column 0 是 # 序號），第二格是「公司統編」
    if (cells[1] === '公司統編' || cells.includes('員工編號')) {
      headerIdx = i
      break
    }
  }
  const headers = parseRow(lines[headerIdx])
  return lines.slice(headerIdx + 1).map(line => {
    const cells = parseRow(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = (cells[i] || '').trim() })
    return row
  }).filter(r => r['員工編號'] || r['姓名'])  // 跳過空行
}
function parseRow(line) {
  const result = []
  let cur = '', inQuote = false
  for (const c of line) {
    if (c === '"') inQuote = !inQuote
    else if (c === ',' && !inQuote) { result.push(cur); cur = '' }
    else cur += c
  }
  result.push(cur)
  return result.map(s => s.trim())
}

// ── 主流程 ──
async function main() {
  const csvPath = join(ROOT, '.tmp_104_employees.csv')
  let text
  try { text = readFileSync(csvPath, 'utf8') }
  catch { console.error(`找不到 ${csvPath}\n請先把 104 匯出檔轉成 CSV 放到專案根目錄`); process.exit(1) }

  const rows = parseCSV(text)
  console.log(`讀到 ${rows.length} 筆`)

  // 部門名稱 → id 的對照
  const { data: depts } = await sb.from('departments').select('id, name')
  const deptByName = Object.fromEntries((depts || []).map(d => [d.name, d.id]))

  // 門市名稱 → store + 對應 dept 的對照（104 匯出的「部門」欄常是門市名）
  const { data: stores } = await sb.from('stores').select('id, name, department_id, section_id')
  const storeByName = Object.fromEntries((stores || []).map(s => [s.name, s]))

  // 課別名稱 → section（如 研發暨品管課）
  const { data: secs } = await sb.from('department_sections').select('id, name, department_id')
  const sectionByName = Object.fromEntries((secs || []).map(s => [s.name, s]))

  const stats = { insert: 0, update: 0, skip: 0, error: 0 }
  const errors = []
  const unknownDepts = new Set()

  for (const r of rows) {
    const empData = {}
    // 套欄位 map
    for (const [k104, kOurs] of Object.entries(COLUMN_MAP)) {
      let v = r[k104]
      if (v === '' || v == null) continue
      if (VALUE_TRANSFORMS[kOurs]) v = VALUE_TRANSFORMS[kOurs](v)
      if (v == null) continue
      empData[kOurs] = v
    }

    // 「部門」欄 → 依序 try：departments / stores / sections
    const deptText = r['部門']
    if (deptText) {
      empData.dept = deptText
      if (deptByName[deptText]) {
        empData.department_id = deptByName[deptText]
      } else if (storeByName[deptText]) {
        const st = storeByName[deptText]
        empData.store_id = st.id
        if (st.department_id) empData.department_id = st.department_id
      } else if (sectionByName[deptText]) {
        const sec = sectionByName[deptText]
        empData.department_id = sec.department_id
      } else {
        unknownDepts.add(deptText)
      }
    }

    // 唯一鍵：身分證字號優先 → 失敗 fallback employee_number
    const idNumber = empData.id_number
    const empNum   = empData.employee_number
    if (!idNumber && !empNum) {
      stats.skip++
      errors.push({ name: empData.name, reason: '無身分證 + 無員工編號 → 跳過' })
      continue
    }

    // 比對既有員工
    let existing = null
    if (idNumber) {
      const { data } = await sb.from('employees').select('id, name, status').eq('id_number', idNumber).maybeSingle()
      if (data) existing = data
    }
    if (!existing && empNum) {
      const { data } = await sb.from('employees').select('id, name, status').eq('employee_number', empNum).maybeSingle()
      if (data) existing = data
    }

    if (DRY_RUN) {
      console.log(existing
        ? `[UPDATE] ${empData.name} (id=${existing.id}) ← ${idNumber}`
        : `[INSERT] ${empData.name} ← ${idNumber}`)
      stats[existing ? 'update' : 'insert']++
      continue
    }

    if (existing) {
      const { error } = await sb.from('employees').update(empData).eq('id', existing.id)
      if (error) { stats.error++; errors.push({ name: empData.name, reason: error.message }) }
      else stats.update++
    } else {
      // 新員工：補預設 organization_id（之後人工調）
      empData.organization_id = empData.organization_id || 1
      const { error } = await sb.from('employees').insert(empData)
      if (error) { stats.error++; errors.push({ name: empData.name, reason: error.message }) }
      else stats.insert++
    }
  }

  console.log('\n--- 結果 ---')
  console.table(stats)
  if (unknownDepts.size > 0) {
    console.log('\n⚠ 找不到對應的「部門」名稱（既不是 departments 也不是 stores 也不是 sections）：')
    console.log([...unknownDepts].map(d => '  ' + d).join('\n'))
    console.log('  → 這些員工會匯入但 department_id / store_id 是 NULL；先到 /org/departments 或 /org/locations 把它們建好再重跑')
  }
  if (errors.length) {
    console.log('\n錯誤 / 跳過：')
    console.table(errors.slice(0, 20))
    if (errors.length > 20) console.log(`...還有 ${errors.length - 20} 筆`)
  }
  if (DRY_RUN) console.log('\n[DRY-RUN] 沒實際寫 DB。確認 OK 後加 --execute 才真跑。')
}

main().catch(e => { console.error(e); process.exit(1) })
