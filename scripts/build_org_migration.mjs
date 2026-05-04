// 從 _org_data.mjs 產生 SQL migration
// 輸出：supabase/migrations/<timestamp>_org_rebuild_2026_05_04.sql
//
// Migration 內容：
//   Section 1: CREATE 缺漏的 department (外部接案 / 稽核室)
//   Section 2: UPDATE 既有 row（71 + 6 rename = 77 筆）
//   Section 3: INSERT 9 個新人
//   Section 4: SOFT DELETE 27 個 row（status='離職'）
//   Section 5: 安全檢查 assertion

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NEW_ORG, DEPT_NAME_TO_ID, STORE_NAME_TO_ID,
  LINE_BOUND_IDS,
} from './_org_data.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// 載入 DB
const raw = readFileSync(join(ROOT, '.tmp_db_employees.json'), 'utf8')
const dbEmployees = JSON.parse(raw.slice(raw.indexOf('{'))).rows.map(r => r.row)
const dbById = new Map(dbEmployees.map(e => [e.id, e]))

// ── 計算動作 ──
const keepIdSet = new Set(NEW_ORG.filter(p => p.keepId).map(p => p.keepId))
const explicitDeleteIds = new Set(NEW_ORG.flatMap(p => p.deleteIds || []))
const dbOnlyIds = dbEmployees
  .filter(e => !keepIdSet.has(e.id) && !explicitDeleteIds.has(e.id))
  .map(e => e.id)
const allDeleteIds = [...new Set([...explicitDeleteIds, ...dbOnlyIds])]

// 安全檢查
const lineConflicts = [...LINE_BOUND_IDS].filter(id => allDeleteIds.includes(id))
if (lineConflicts.length > 0) {
  console.error('❌ FATAL: 以下 LINE 綁定 id 將被刪：', lineConflicts)
  process.exit(1)
}

// ── SQL helpers ──
const sqlString = v => v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const sqlInt    = v => v == null ? 'NULL' : String(v)
const deptId    = name => {
  if (!name) return 'NULL'
  if (!(name in DEPT_NAME_TO_ID)) {
    throw new Error(`Unknown dept: ${name}`)
  }
  const id = DEPT_NAME_TO_ID[name]
  if (id == null) {
    // 待 INSERT 的部門 → 用 subquery
    return `(SELECT id FROM departments WHERE name = ${sqlString(name)} ORDER BY id LIMIT 1)`
  }
  return String(id)
}
const storeId = name => {
  if (!name) return 'NULL'
  if (!(name in STORE_NAME_TO_ID)) {
    throw new Error(`Unknown store: ${name}`)
  }
  return String(STORE_NAME_TO_ID[name])
}

// ── 產生 SQL ──
const ts = '20260504120000'
const lines = []

lines.push(`-- =============================================`)
lines.push(`-- 組織圖重建 migration — ${new Date().toISOString().slice(0,10)}`)
lines.push(`-- 來源：docs/ORG_RECONCILE_2026-05-04.md`)
lines.push(`-- 動作：`)
lines.push(`--   ${NEW_ORG.filter(p => p.keepId && !p.rename).length} 筆 UPDATE`)
lines.push(`--   ${NEW_ORG.filter(p => p.rename).length} 筆 UPDATE+rename`)
lines.push(`--   ${NEW_ORG.filter(p => !p.keepId).length} 筆 INSERT`)
lines.push(`--   ${allDeleteIds.length} 筆 SOFT DELETE (status='離職')`)
lines.push(`-- =============================================`)
lines.push(``)
lines.push(`BEGIN;`)
lines.push(``)

// ── Section 1: 新部門 ──
lines.push(`-- =============================================`)
lines.push(`-- Section 1: 缺漏部門 (外部接案 / 稽核室)`)
lines.push(`-- =============================================`)
const newDepts = Object.entries(DEPT_NAME_TO_ID).filter(([, v]) => v == null).map(([k]) => k)
for (const name of newDepts) {
  lines.push(`INSERT INTO departments (organization_id, name)`)
  lines.push(`SELECT 1, ${sqlString(name)}`)
  lines.push(`WHERE NOT EXISTS (SELECT 1 FROM departments WHERE name = ${sqlString(name)});`)
}
lines.push(``)

// ── Section 2: UPDATE 既有 row ──
lines.push(`-- =============================================`)
lines.push(`-- Section 2: UPDATE 既有 row (${NEW_ORG.filter(p => p.keepId).length} 筆)`)
lines.push(`-- =============================================`)
for (const p of NEW_ORG) {
  if (!p.keepId) continue
  const dbRow = dbById.get(p.keepId)
  if (!dbRow) {
    console.warn(`⚠️ keepId=${p.keepId} not found in DB (${p.zh})`)
    continue
  }
  const sets = []
  // name 只有 rename 才改
  if (p.rename) sets.push(`name = ${sqlString(p.zh)}`)
  // name_en 永遠以圖為主
  sets.push(`name_en = ${sqlString(p.en || null)}`)
  // dept TEXT denorm
  sets.push(`dept = ${sqlString(p.dept)}`)
  // department_id
  sets.push(`department_id = ${deptId(p.dept)}`)
  // store TEXT denorm
  sets.push(`store = ${sqlString(p.store)}`)
  // store_id
  sets.push(`store_id = ${storeId(p.store)}`)
  // employment_type
  sets.push(`employment_type = ${p.type === 'N/A' ? 'NULL' : sqlString(p.type)}`)
  // status 確保在職
  sets.push(`status = '在職'`)

  lines.push(`-- ${p.zh} ${p.en ? `(${p.en})` : ''} → ${p.dept}/${p.store || '–'}${p.note ? ' — ' + p.note : ''}`)
  lines.push(`UPDATE employees SET`)
  lines.push(`  ${sets.join(',\n  ')}`)
  lines.push(`WHERE id = ${p.keepId};`)
  lines.push(``)
}

// ── Section 3: INSERT 新人 ──
const inserts = NEW_ORG.filter(p => !p.keepId)
lines.push(`-- =============================================`)
lines.push(`-- Section 3: INSERT 新人 (${inserts.length} 筆)`)
lines.push(`-- =============================================`)
for (const p of inserts) {
  lines.push(`-- ${p.zh} ${p.en ? `(${p.en})` : ''} → ${p.dept}/${p.store || '–'}`)
  lines.push(`INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)`)
  lines.push(`VALUES (`)
  lines.push(`  1, ${sqlString(p.zh)}, ${sqlString(p.en || null)},`)
  lines.push(`  ${sqlString(p.dept)}, ${deptId(p.dept)},`)
  lines.push(`  ${sqlString(p.store)}, ${storeId(p.store)},`)
  lines.push(`  ${sqlString(p.position)}, ${sqlString(p.type)}, '在職'`)
  lines.push(`);`)
  lines.push(``)
}

// ── Section 4: SOFT DELETE ──
lines.push(`-- =============================================`)
lines.push(`-- Section 4: SOFT DELETE (status='離職') ${allDeleteIds.length} 筆`)
lines.push(`-- 不 hard DELETE 是因為 23 個 NO ACTION FK 會擋。`)
lines.push(`-- 後續 cleanup 階段可以另外處理硬刪。`)
lines.push(`-- =============================================`)

// 4a. 雙胞胎 / typo merge
lines.push(`-- 4a. 雙胞胎 / typo merge (${explicitDeleteIds.size} 筆)`)
for (const p of NEW_ORG) {
  if (!p.deleteIds) continue
  for (const did of p.deleteIds) {
    const r = dbById.get(did)
    if (!r) { console.warn(`⚠️ deleteId=${did} not in DB`); continue }
    lines.push(`-- id=${did} ${r.name} → merge 到 ${p.zh} (id=${p.keepId})`)
  }
}
lines.push(`UPDATE employees SET status = '離職'`)
lines.push(`WHERE id IN (${[...explicitDeleteIds].sort((a,b)=>a-b).join(', ')});`)
lines.push(``)

// 4b. 真離職 / 測試帳號 / 漏列
lines.push(`-- 4b. 真離職 / 測試帳號 / 漏列 (${dbOnlyIds.length} 筆)`)
for (const id of dbOnlyIds.sort((a,b)=>a-b)) {
  const e = dbById.get(id)
  lines.push(`-- id=${id} ${e.name} (${e.dept || '–'}/${e.position || '–'})`)
}
lines.push(`UPDATE employees SET status = '離職'`)
lines.push(`WHERE id IN (${dbOnlyIds.sort((a,b)=>a-b).join(', ')});`)
lines.push(``)

// ── Section 5: 安全檢查 assertion ──
lines.push(`-- =============================================`)
lines.push(`-- Section 5: 安全檢查 assertion`)
lines.push(`-- =============================================`)
lines.push(`-- 確認 8 個 LINE 綁定 id 還在且 status='在職'`)
lines.push(`DO $$`)
lines.push(`DECLARE`)
lines.push(`  missing_count INT;`)
lines.push(`BEGIN`)
lines.push(`  SELECT COUNT(*) INTO missing_count`)
lines.push(`  FROM (VALUES (10),(44),(48),(52),(58),(62),(148),(152)) AS t(id)`)
lines.push(`  WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = t.id AND e.status = '在職');`)
lines.push(`  IF missing_count > 0 THEN`)
lines.push(`    RAISE EXCEPTION 'LINE 綁定 id 缺失或變成離職: %', missing_count;`)
lines.push(`  END IF;`)
lines.push(`END $$;`)
lines.push(``)

lines.push(`-- 確認在職人數 = 86`)
lines.push(`DO $$`)
lines.push(`DECLARE`)
lines.push(`  active_count INT;`)
lines.push(`BEGIN`)
lines.push(`  SELECT COUNT(*) INTO active_count FROM employees WHERE status = '在職';`)
lines.push(`  IF active_count <> 86 THEN`)
lines.push(`    RAISE EXCEPTION '在職人數異常: 期望 86, 實際 %', active_count;`)
lines.push(`  END IF;`)
lines.push(`END $$;`)
lines.push(``)

lines.push(`COMMIT;`)
lines.push(``)

const out = lines.join('\n')
const path = join(ROOT, `supabase/migrations/${ts}_org_rebuild_2026_05_04.sql`)
writeFileSync(path, out)
console.log(`Wrote: supabase/migrations/${ts}_org_rebuild_2026_05_04.sql`)
console.log(`Lines: ${lines.length}`)
console.log(`Updates: ${NEW_ORG.filter(p => p.keepId).length}`)
console.log(`Inserts: ${inserts.length}`)
console.log(`Soft deletes: ${allDeleteIds.length}`)
