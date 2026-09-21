#!/usr/bin/env node
// 產生永春店 2026/04 班表 + 打卡的匯入 SQL — V2 安全版
// 用法：node scripts/gen_yongchun_data_only.mjs > scripts/yongchun_april_data.sql
//
// V2 跟 V1 差異：
//   - 不建店（用既有 store_id=31）
//   - 不 INSERT / UPDATE 員工（假設 7 人都已存在 系統中）
//   - 不碰 salary_structures
//   - 只 INSERT schedules + attendance_records
//   - 用名字精準對應到既有員工的 id
//
// 工時公式（每天 total_hours）：
//   start = max(actual_in, sched_in)
//   end   = min(actual_out, sched_out)
//   raw   = end - start
//   total = raw - lunch (raw >= 8h ? 1h : 0h)
//
// 跨午夜：sched_out 可能 24/25/26 等（>24 = 隔日）

import fs from 'node:fs'

const SCHED_PATH = new URL('./data/yongchun/schedule.json', import.meta.url).pathname.replace(/^\//, '')
const PUNCH_PATH = new URL('./data/yongchun/punches.json', import.meta.url).pathname.replace(/^\//, '')

const schedJson = JSON.parse(fs.readFileSync(SCHED_PATH, 'utf8'))
const punchJson = JSON.parse(fs.readFileSync(PUNCH_PATH, 'utf8'))

const STORE_ID = 31  // 既有「台北永春」

// ─── helpers ───────────────────────────────────────────
const toHours = (t) => {
  if (!t) return null
  const [h, m = '0', s = '0'] = t.split(':')
  return parseInt(h) + parseInt(m) / 60 + parseInt(s) / 3600
}

const parseShift = (code) => {
  if (!code || code === '休') return null
  let store = '永春'
  let raw = code
  if (raw.startsWith('六張犁')) { store = '六張犁'; raw = raw.slice(3) }
  if (raw.startsWith('巡店')) { raw = raw.slice(2) || '11-20' }
  if (raw === '生理') return { absence: '生理', store }
  const m = raw.match(/^(\d+)-(\d+)$/)
  if (!m) return null
  let inH = parseInt(m[1])
  let outH = parseInt(m[2])
  if (outH < inH) outH += 24
  if (m[2] === '00') outH = 24
  return { sched_in: inH, sched_out: outH, store }
}

const calcHours = (sched_in, sched_out, actual_in, actual_out, lunchThreshold = 8) => {
  if (sched_in == null || sched_out == null) return 0
  if (actual_in == null || actual_out == null) return 0
  const start = Math.max(actual_in, sched_in)
  const end = Math.min(actual_out, sched_out)
  const raw = Math.max(0, end - start)
  const lunch = raw >= lunchThreshold ? 1 : 0
  return Math.round((raw - lunch) * 100) / 100
}

const calcLateMin = (sched_in, actual_in) => {
  if (actual_in == null || sched_in == null) return 0
  return Math.max(0, Math.round((actual_in - sched_in) * 60))
}

const fmtTime = (h) => {
  if (h == null) return 'NULL'
  let v = h % 24
  const hh = Math.floor(v)
  const mm = Math.floor((v - hh) * 60)
  const ss = Math.round(((v - hh) * 60 - mm) * 60)
  return `'${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}'`
}

const Q = (s) => s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`

const sql = []
sql.push(`-- =============================================`)
sql.push(`-- 永春店 2026/04 schedules + attendance 匯入 (V2 安全版)`)
sql.push(`-- 自動產生 by scripts/gen_yongchun_data_only.mjs`)
sql.push(`--`)
sql.push(`-- 前提：以下 7 員工必須已存在於 employees 表（store_id=31）：`)
sql.push(`--   陳嘉益 / 許亦翎 / 徐宥芯 / 洪瑛妏 / 蔡伊真 / 林思妤 / 陳姿螢`)
sql.push(`-- =============================================`)
sql.push(``)
sql.push(`BEGIN;`)
sql.push(``)
sql.push(`DO $$`)
sql.push(`DECLARE`)
sql.push(`  v_org_id INT;`)
sql.push(`  v_store_id INT := ${STORE_ID};`)
sql.push(`BEGIN`)
sql.push(`  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;`)
sql.push(``)
sql.push(`  -- 檢查 7 員工是否都存在`)

const names = schedJson.employees.map(e => Q(e.name)).join(',')
sql.push(`  IF (SELECT COUNT(*) FROM employees WHERE name = ANY(ARRAY[${names}]) AND organization_id = v_org_id) < 7 THEN`)
sql.push(`    RAISE EXCEPTION '7 員工沒到齊，先跑 rebuild SQL';`)
sql.push(`  END IF;`)
sql.push(``)
sql.push(`  -- 清掉 4 月既有資料（idempotent）`)
sql.push(`  DELETE FROM schedules WHERE date >= DATE '2026-04-01' AND date <= DATE '2026-04-30'`)
sql.push(`    AND employee_id IN (SELECT id FROM employees WHERE name = ANY(ARRAY[${names}]) AND organization_id = v_org_id);`)
sql.push(`  DELETE FROM attendance_records WHERE date >= DATE '2026-04-01' AND date <= DATE '2026-04-30'`)
sql.push(`    AND employee_id IN (SELECT id FROM employees WHERE name = ANY(ARRAY[${names}]) AND organization_id = v_org_id);`)
sql.push(``)

// schedules
sql.push(`  -- ═══ 班表 ═══`)
for (const e of schedJson.employees) {
  for (let i = 0; i < e.shifts.length; i++) {
    const shift = e.shifts[i]
    const date = `2026-04-${String(i + 1).padStart(2, '0')}`
    if (!shift) continue
    const parsed = parseShift(shift)
    let absenceType = null
    let sourceStore = null
    if (shift === '休') absenceType = '休'
    else if (parsed?.absence === '生理') absenceType = '生理'
    else if (parsed?.store === '六張犁') sourceStore = '六張犁'

    sql.push(`  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)`)
    sql.push(`    SELECT ${Q(e.name)}, id, DATE '${date}', ${Q(shift)}, ${absenceType ? Q(absenceType) : 'NULL'}, ${sourceStore ? Q(sourceStore) : 'NULL'}, '2026-04'`)
    sql.push(`      FROM employees WHERE name = ${Q(e.name)} AND organization_id = v_org_id`)
    sql.push(`  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;`)
  }
}

// attendance
sql.push(``)
sql.push(`  -- ═══ 打卡 ═══`)
const codeToName = Object.fromEntries(schedJson.employees.map(e => [e.code, e.name]))
for (const p of punchJson.punches) {
  const empName = codeToName[p.code]
  if (!empName) continue
  const actualIn = toHours(p.actual_in)
  const actualOut = toHours(p.actual_out)
  let schedIn = toHours(p.sched_in)
  let schedOut = toHours(p.sched_out)
  if (schedIn && schedOut && schedOut <= schedIn) schedOut += 24
  if (p.sched_out === '24:00') schedOut = 24
  if (p.sched_out === '25:00') schedOut = 25
  if (p.sched_out === '26:00') schedOut = 26

  let normIn = actualIn
  let normOut = actualOut
  if (normIn != null && schedIn != null && normIn < schedIn - 4) normIn = null
  if (normOut != null && schedOut != null && normOut < schedOut - 4) normOut = null

  const totalH = calcHours(schedIn, schedOut, normIn, normOut)
  const lateMin = calcLateMin(schedIn, normIn)
  const isLate = lateMin > 0 ? 'TRUE' : 'FALSE'
  const status = p.status || (totalH > 0 ? '正常' : '異常')

  sql.push(`  INSERT INTO attendance_records (employee, employee_id, store_id, date, clock_in, clock_out, total_hours, is_late, late_minutes, status)`)
  sql.push(`    SELECT ${Q(empName)}, id, v_store_id, DATE '${p.date}', ${normIn != null ? fmtTime(normIn) : 'NULL'}, ${normOut != null ? fmtTime(normOut) : 'NULL'}, ${totalH}, ${isLate}, ${lateMin}, ${Q(status)}`)
  sql.push(`      FROM employees WHERE name = ${Q(empName)} AND organization_id = v_org_id;`)
}

sql.push(``)
sql.push(`  RAISE NOTICE '永春 4 月 schedules + attendance 匯入完成';`)
sql.push(`END $$;`)
sql.push(``)
sql.push(`COMMIT;`)
sql.push(``)
sql.push(`-- 驗證`)
sql.push(`SELECT e.name, COUNT(*) AS days, ROUND(SUM(ar.total_hours), 2) AS total_hours`)
sql.push(`  FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id`)
sql.push(` WHERE e.name = ANY(ARRAY[${names}])`)
sql.push(`   AND ar.date >= DATE '2026-04-01' AND ar.date <= DATE '2026-04-30'`)
sql.push(` GROUP BY e.name ORDER BY e.name;`)

process.stdout.write(sql.join('\n'))
