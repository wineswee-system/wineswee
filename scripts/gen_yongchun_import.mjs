#!/usr/bin/env node
// 產生永春店 2026/04 班表 + 打卡的匯入 SQL
// 用法：node scripts/gen_yongchun_import.mjs > scripts/yongchun_april_import.sql
//
// 工時公式（每天 total_hours）：
//   start = max(actual_in, sched_in)
//   end   = min(actual_out, sched_out)
//   raw   = end - start
//   total = raw - lunch
//   lunch = raw >= 8h ? 1h : 0h
//
// 跨午夜：sched_out 可能是 24:00 / 25:00 / 26:00 等（>24 表跨日）
// 系統 attendance_records.clock_out 是 TIME 欄位，超過 24:00 需 mod 24 並把 date+1（這裡簡化：clock_out 存 TIME，跨日由 total_hours 反映）

import fs from 'node:fs'
import path from 'node:path'

const SCHED_PATH = '/tmp/yongchun/schedule.json'
const PUNCH_PATH = '/tmp/yongchun/punches.json'

const schedJson = JSON.parse(fs.readFileSync(SCHED_PATH, 'utf8'))
const punchJson = JSON.parse(fs.readFileSync(PUNCH_PATH, 'utf8'))

// ─── helpers ───────────────────────────────────────────
// "HH:MM[:SS]" 或 ">=24:00" 形式 → 小時(numeric)，可跨日
const toHours = (t) => {
  if (!t) return null
  const [h, m = '0', s = '0'] = t.split(':')
  return parseInt(h) + parseInt(m) / 60 + parseInt(s) / 3600
}

// shift code → {sched_in, sched_out}（>24 表跨日）
const parseShift = (code) => {
  if (!code || code === '休') return null
  // 巡店 / 生理 / 跨店 等特殊處理
  let store = '永春'
  let raw = code
  if (raw.startsWith('六張犁')) {
    store = '六張犁'
    raw = raw.slice(3)
  }
  if (raw.startsWith('巡店')) {
    // "巡店11-20" → 11-20 ; 單純"巡店" → 視同 11-20
    raw = raw.slice(2) || '11-20'
  }
  if (raw === '生理') return { absence: '生理', store }
  // "11-20" / "19-01" / "16-01" / "20-01" 等
  const m = raw.match(/^(\d+)-(\d+)$/)
  if (!m) return null
  let inH = parseInt(m[1])
  let outH = parseInt(m[2])
  // 跨日判斷：outH < inH 或 outH 為 00 / 01 等小時 → 表示隔日
  if (outH < inH) outH += 24
  // 19-00 表示 19 → 24:00 (= 24)，所以 outH=0 → outH=24
  if (m[2] === '00') outH = 24
  return { sched_in: inH, sched_out: outH, store }
}

// 工時計算
const calcHours = (sched_in, sched_out, actual_in, actual_out, lunchThreshold = 8) => {
  if (sched_in == null || sched_out == null) return 0
  // 沒打卡視為 0
  if (actual_in == null || actual_out == null) return 0
  const start = Math.max(actual_in, sched_in)
  const end = Math.min(actual_out, sched_out)
  const raw = Math.max(0, end - start)
  const lunch = raw >= lunchThreshold ? 1 : 0
  return Math.round((raw - lunch) * 100) / 100
}

// 加班時數（晚走超出排定下班）
const calcOT = (sched_out, actual_out) => {
  if (actual_out == null || sched_out == null) return 0
  return Math.max(0, Math.round((actual_out - sched_out) * 100) / 100)
}

// 遲到分鐘
const calcLateMin = (sched_in, actual_in) => {
  if (actual_in == null || sched_in == null) return 0
  return Math.max(0, Math.round((actual_in - sched_in) * 60))
}

// TIME -> "HH:MM:SS"（>=24 → mod 24）
const fmtTime = (h) => {
  if (h == null) return 'NULL'
  let v = h % 24
  const hh = Math.floor(v)
  const mm = Math.floor((v - hh) * 60)
  const ss = Math.round(((v - hh) * 60 - mm) * 60)
  return `'${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}'`
}

// SQL escape
const Q = (s) => s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`

// ─── SQL 產生 ───────────────────────────────────────────
const sql = []
const month = '2026-04'

sql.push(`-- =============================================`)
sql.push(`-- 永春店 2026/04 測試資料匯入`)
sql.push(`-- 自動產生 by scripts/gen_yongchun_import.mjs`)
sql.push(`--`)
sql.push(`-- 內容：`)
sql.push(`--   1. 找/建 永春店 + 7 員工（用 emp.code 比對；沒 code 欄位則用名稱）`)
sql.push(`--   2. 建 salary_structures（PT 時薪 220；正職本薪先設 0，等公式確認後補）`)
sql.push(`--   3. 匯入 4 月班表到 schedules`)
sql.push(`--   4. 匯入 4 月打卡到 attendance_records（total_hours 用「排定 ∩ 實際」公式）`)
sql.push(`--   5. (尚未) overtime_requests — 等公式確認後再 INSERT`)
sql.push(`--`)
sql.push(`-- 重複跑：先 DELETE 該店 + 該月既有資料再 INSERT，所以 idempotent`)
sql.push(`-- =============================================`)
sql.push(``)
sql.push(`BEGIN;`)
sql.push(``)
sql.push(`-- 找 org（用既有第一個）`)
sql.push(`DO $$`)
sql.push(`DECLARE`)
sql.push(`  v_org_id INT;`)
sql.push(`  v_store_id INT;`)
sql.push(`BEGIN`)
sql.push(`  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;`)
sql.push(`  IF v_org_id IS NULL THEN RAISE EXCEPTION '無 org，請先建立 organization'; END IF;`)
sql.push(``)
sql.push(`  -- 找/建永春店`)
sql.push(`  SELECT id INTO v_store_id FROM stores WHERE name = '台北永春連鎖店' AND organization_id = v_org_id;`)
sql.push(`  IF v_store_id IS NULL THEN`)
sql.push(`    INSERT INTO stores (name, organization_id) VALUES ('台北永春連鎖店', v_org_id) RETURNING id INTO v_store_id;`)
sql.push(`    RAISE NOTICE '建立永春店 store_id=%', v_store_id;`)
sql.push(`  ELSE`)
sql.push(`    RAISE NOTICE '永春店已存在 store_id=%', v_store_id;`)
sql.push(`  END IF;`)
sql.push(``)
sql.push(`  -- 7 員工 — 用 name 比對（沒 employee code 欄位）`)
sql.push(`  -- 若已存在就更新 store / status；不存在則 INSERT`)

for (const e of schedJson.employees) {
  const dept = e.type === '正職' ? '門市' : '門市'
  const role = e.title === '店長' ? 'manager' : 'store_staff'
  sql.push(``)
  sql.push(`  -- ${e.code} ${e.name}${e.alias ? ' ('+e.alias+')' : ''} ${e.title}`)
  sql.push(`  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = ${Q(e.name)} AND organization_id = v_org_id) THEN`)
  sql.push(`    INSERT INTO employees (name, dept, position, store, store_id, status, organization_id, role)`)
  sql.push(`      VALUES (${Q(e.name)}, ${Q(dept)}, ${Q(e.title)}, ${Q('台北永春連鎖店')}, v_store_id, '在職', v_org_id, ${Q(role)});`)
  sql.push(`  ELSE`)
  sql.push(`    UPDATE employees SET store_id = v_store_id, store = '台北永春連鎖店', status = '在職'`)
  sql.push(`      WHERE name = ${Q(e.name)} AND organization_id = v_org_id;`)
  sql.push(`  END IF;`)
}

sql.push(``)
sql.push(`  -- salary_structures — UPSERT`)
for (const e of schedJson.employees) {
  const salaryType = e.type === '正職' ? 'monthly' : 'hourly'
  const hourlyRate = e.type === '正職' ? 0 : 220
  const baseSalary = e.type === '正職' ? 40000 : 0   // 正職本薪暫設 40,000 (店長之後 update 為 41,000)
  sql.push(``)
  sql.push(`  -- ${e.name} (${e.type})`)
  sql.push(`  INSERT INTO salary_structures (employee_id, salary_type, hourly_rate, base_salary, meal_allowance, effective_from)`)
  sql.push(`    SELECT id, ${Q(salaryType)}, ${hourlyRate}, ${baseSalary}, ${e.type === '正職' ? 3000 : 0}, DATE '2026-04-01'`)
  sql.push(`      FROM employees WHERE name = ${Q(e.name)} AND organization_id = v_org_id`)
  sql.push(`  ON CONFLICT (employee_id) DO UPDATE SET`)
  sql.push(`    salary_type = EXCLUDED.salary_type,`)
  sql.push(`    hourly_rate = EXCLUDED.hourly_rate,`)
  sql.push(`    base_salary = EXCLUDED.base_salary,`)
  sql.push(`    meal_allowance = EXCLUDED.meal_allowance;`)
}

// 店長加給 — 額外 UPDATE
sql.push(``)
sql.push(`  -- 店長 Tako 本薪 + 加給（待之後修正廠商公式）`)
sql.push(`  UPDATE salary_structures ss`)
sql.push(`    SET base_salary = 41000, role_allowance = 8000, meal_allowance = 3000`)
sql.push(`   FROM employees e`)
sql.push(`   WHERE ss.employee_id = e.id AND e.name = '陳尚琪' AND e.organization_id = v_org_id;`)

sql.push(``)
sql.push(`  -- 清掉永春 7 員工 4 月既有 schedule / attendance（idempotent）`)
sql.push(`  DELETE FROM schedules WHERE date >= DATE '2026-04-01' AND date <= DATE '2026-04-30'`)
sql.push(`    AND employee_id IN (SELECT id FROM employees WHERE name = ANY(ARRAY[${schedJson.employees.map(e => Q(e.name)).join(',')}]) AND organization_id = v_org_id);`)
sql.push(`  DELETE FROM attendance_records WHERE date >= DATE '2026-04-01' AND date <= DATE '2026-04-30'`)
sql.push(`    AND employee_id IN (SELECT id FROM employees WHERE name = ANY(ARRAY[${schedJson.employees.map(e => Q(e.name)).join(',')}]) AND organization_id = v_org_id);`)

// 班表
sql.push(``)
sql.push(`  -- 班表 (schedules)`)
let scheduleRows = []
for (const e of schedJson.employees) {
  for (let i = 0; i < e.shifts.length; i++) {
    const shift = e.shifts[i]
    const date = `2026-04-${String(i + 1).padStart(2, '0')}`
    if (!shift) continue  // 空白（中途入職）
    const parsed = parseShift(shift)
    let absenceType = null
    let shiftLabel = shift
    let sourceStore = null
    if (shift === '休') {
      absenceType = '休'
      shiftLabel = '休'
    } else if (parsed?.absence === '生理') {
      absenceType = '生理'
      shiftLabel = '生理'
    } else if (parsed) {
      if (parsed.store === '六張犁') sourceStore = '六張犁'  // 表示去六張犁支援
    }
    scheduleRows.push({
      emp_name: e.name,
      date,
      shift: shiftLabel,
      absence_type: absenceType,
      source_store: sourceStore,
    })
  }
}

// 用 SELECT FROM employees 拿 employee_id
for (const r of scheduleRows) {
  sql.push(`  INSERT INTO schedules (employee, employee_id, date, shift, absence_type, source_store, month_group)`)
  sql.push(`    SELECT ${Q(r.emp_name)}, id, DATE '${r.date}', ${Q(r.shift)}, ${r.absence_type ? Q(r.absence_type) : 'NULL'}, ${r.source_store ? Q(r.source_store) : 'NULL'}, '2026-04'`)
  sql.push(`      FROM employees WHERE name = ${Q(r.emp_name)} AND organization_id = v_org_id`)
  sql.push(`  ON CONFLICT (employee, date) DO UPDATE SET shift = EXCLUDED.shift, absence_type = EXCLUDED.absence_type, source_store = EXCLUDED.source_store, month_group = EXCLUDED.month_group;`)
}

// 打卡
sql.push(``)
sql.push(`  -- 打卡 (attendance_records)`)
const codeToName = Object.fromEntries(schedJson.employees.map(e => [e.code, e.name]))

for (const p of punchJson.punches) {
  const empName = codeToName[p.code]
  if (!empName) continue
  const actualIn = toHours(p.actual_in)
  const actualOut = toHours(p.actual_out)
  let schedIn = toHours(p.sched_in)
  let schedOut = toHours(p.sched_out)
  if (schedIn && schedOut && schedOut <= schedIn) schedOut += 24  // 跨日
  if (p.sched_out === '24:00') schedOut = 24
  if (p.sched_out === '25:00') schedOut = 25
  if (p.sched_out === '26:00') schedOut = 26

  // 處理異常時序：actual_in 比 sched_in 早超過 4 小時 → 視為前一天的補打卡，作 NULL
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
sql.push(`  RAISE NOTICE '永春 4 月匯入完成';`)
sql.push(`END $$;`)
sql.push(``)
sql.push(`COMMIT;`)
sql.push(``)
sql.push(`-- ────────────────────────────────────────────────────────`)
sql.push(`-- 匯入後核對：`)
sql.push(`-- ────────────────────────────────────────────────────────`)
sql.push(`-- 看每員工的工時加總`)
sql.push(`SELECT e.name, COUNT(*) AS days, SUM(ar.total_hours) AS total_hours`)
sql.push(`  FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id`)
sql.push(` WHERE e.name = ANY(ARRAY[${schedJson.employees.map(e => Q(e.name)).join(',')}])`)
sql.push(`   AND ar.date >= DATE '2026-04-01' AND ar.date <= DATE '2026-04-30'`)
sql.push(` GROUP BY e.name`)
sql.push(` ORDER BY e.name;`)
sql.push(``)
sql.push(`-- 預期 PT 各人工時（廠商薪資反推）：`)
sql.push(`-- 洪瑛奴 (P20260013) = 49.5h`)
sql.push(`-- 蔡伊真 (P20260024) = 67.5h`)
sql.push(`-- 林思妤 (P20260030) = 66h`)
sql.push(`-- 陳姿螢 (P20260033) = 73.5h`)
sql.push(``)

process.stdout.write(sql.join('\n'))
