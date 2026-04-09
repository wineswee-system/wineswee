/**
 * 台灣勞動法規合規引擎
 *
 * 涵蓋三大法律：
 * 1. 勞動基準法（勞基法）
 * 2. 性別平等工作法（性平法）
 * 3. 職業安全衛生法
 *
 * 本模組專注於「工時與排班」相關規定
 *
 * 2026 重大更新：
 * - 基本工資：月薪 29,500 / 時薪 196
 * - 國定假日：採「只補假不補班」新制
 * - 職安法修正：職場霸凌專章、罰則提高至300萬
 * - 病假新制：10天內不得不利處分、全勤按比例扣
 */

// ══════════════════════════════════════
//  勞基法 — 工時與排班規定
// ══════════════════════════════════════

export const LABOR_STANDARDS = {
  // ── 第30條：正常工時 ──
  normalHours: {
    law: '勞基法 §30',
    title: '正常工作時間',
    daily: 8,      // 每日不得超過 8 小時
    weekly: 40,    // 每週不得超過 40 小時
    desc: '勞工正常工作時間，每日不得超過 8 小時，每週不得超過 40 小時。',
    note: '雇主經工會或勞資會議同意，得將其2週內2日之正常工時分配於其他工作日（彈性工時）。',
  },

  // ── 第30-1條：變形工時（4週彈性工時）──
  flexibleHours: {
    law: '勞基法 §30-1',
    title: '四週變形工時',
    biWeekly: 80,    // 2週不超過80小時
    fourWeekly: 160,  // 4週不超過160小時
    maxDaily: 10,     // 單日最高10小時
    desc: '經工會或勞資會議同意，得採四週彈性工時制：4週內正常工時不得超過160小時，單日不超過10小時。',
  },

  // ── 第32條：延長工時（加班）──
  overtime: {
    law: '勞基法 §32',
    title: '延長工作時間',
    maxDaily: 4,         // 一日延長連同正常不超過12小時
    maxMonthly: 46,      // 每月不得超過46小時
    maxMonthlyAgreed: 54, // 經工會同意，每月不超過54小時（每3個月不超過138小時）
    maxQuarterly: 138,
    desc: '延長工時連同正常工時一日不超過12小時。每月延長工時不得超過46小時；經工會同意得延長至54小時，但每3個月合計不超過138小時。',
    rates: [
      { desc: '延長工時前2小時', rate: 1.34, formula: '時薪 × 1⅓' },
      { desc: '延長工時第3-4小時', rate: 1.67, formula: '時薪 × 1⅔' },
      { desc: '休息日前2小時', rate: 1.34, formula: '時薪 × 1⅓' },
      { desc: '休息日第3-8小時', rate: 1.67, formula: '時薪 × 1⅔' },
      { desc: '休息日第9-12小時', rate: 2.67, formula: '時薪 × 2⅔' },
      { desc: '例假日出勤', rate: 2.0, formula: '加倍工資' },
      { desc: '國定假日出勤', rate: 2.0, formula: '加倍工資' },
    ],
  },

  // ── 第34條：輪班間隔 ──
  shiftInterval: {
    law: '勞基法 §34',
    title: '輪班間隔',
    minHours: 11,  // 更換班次至少間隔11小時
    minHoursAgreed: 8, // 經工會同意得縮短為8小時
    desc: '勞工工作採輪班制者，更換班次時，至少應有連續11小時之休息時間；經工會同意得縮短為8小時。',
  },

  // ── 第35條：休息時間 ──
  breakTime: {
    law: '勞基法 §35',
    title: '休息時間',
    after4Hours: 30, // 工作4小時至少休息30分鐘
    desc: '勞工繼續工作4小時，至少應有30分鐘之休息。但實行輪班制或工作有連續性或緊急性者，雇主得在工作時間內另行調配。',
  },

  // ── 第36條：例假與休息日 ──
  restDays: {
    law: '勞基法 §36',
    title: '例假與休息日',
    restPerWeek: 1,    // 每7天至少1天例假
    offPerWeek: 1,     // 每7天至少1天休息日
    totalPerWeek: 2,   // 合計每週至少2天
    desc: '勞工每7日中應有2日之休息，其中1日為例假，1日為休息日。例假日除天災、事變外不得使勞工工作。',
    detail: [
      '例假（§36-1）：非天災事變不得要求出勤，違者處罰',
      '休息日（§36-2）：經勞工同意可出勤，但須給加班費',
      '2週彈性：每2週至少2日例假+2日休息日',
      '4週彈性：每4週至少4日例假+4日休息日',
    ],
  },

  // ── 第37條：國定假日 ──
  nationalHolidays: {
    law: '勞基法 §37',
    title: '國定假日',
    desc: '紀念日、勞動節及其他中央主管機關規定應放假之日，均應休假。',
    note2026: '2026年起採「只補假不補班」新制。國定假日逢週六→前一個週五補假；逢週日→後一個週一補假。全年無補班日。',
    holidays2026: [
      { date: '01-01', name: '元旦', weekday: '四' },
      { date: '02-15', name: '小年夜', weekday: '日' },
      { date: '02-16', name: '除夕', weekday: '一' },
      { date: '02-17', name: '春節初一', weekday: '二' },
      { date: '02-18', name: '春節初二', weekday: '三' },
      { date: '02-19', name: '春節初三', weekday: '四' },
      { date: '02-28', name: '和平紀念日', weekday: '六' },
      { date: '04-04', name: '兒童節', weekday: '六' },
      { date: '04-05', name: '清明節', weekday: '日' },
      { date: '05-01', name: '勞動節', weekday: '五' },
      { date: '05-31', name: '端午節', weekday: '日' },
      { date: '09-21', name: '中秋節', weekday: '一' },
      { date: '10-10', name: '國慶日', weekday: '六' },
    ],
  },

  // ── 第49條：女性夜間工作 ──
  femaleNightWork: {
    law: '勞基法 §49',
    title: '女性夜間工作限制',
    nightStart: 22,  // 晚上10點
    nightEnd: 6,     // 早上6點
    desc: '雇主不得使女工於午後10時至翌晨6時之時間內工作。但經工會或勞資會議同意，且符合安全衛生條件者，不在此限。',
    conditions: [
      '提供必要之安全衛生設施',
      '提供交通工具或安排女工宿舍',
      '經工會或勞資會議同意',
      '妊娠或哺乳期間之女工，不得於夜間工作',
    ],
  },

  // ── 第84-1條：責任制 ──
  exemptWorkers: {
    law: '勞基法 §84-1',
    title: '責任制工作者',
    desc: '經中央主管機關核定公告之監督、管理人員或責任制專業人員等，得由勞雇雙方另行約定工作時間、例假、休假。但仍應報當地主管機關核備。',
    note: '即便是責任制，仍不得損及勞工健康及福祉，且須經勞工書面同意。',
  },
}

// ══════════════════════════════════════
//  性平法 — 排班相關
// ══════════════════════════════════════

export const GENDER_EQUALITY = {
  // ── 第15條：產假期間 ──
  maternityProtection: {
    law: '性平法 §15',
    title: '產假期間不得排班',
    desc: '女性員工產假期間，雇主不得安排其工作。',
  },

  // ── 第18條：哺乳時間 ──
  nursingTime: {
    law: '性平法 §18',
    title: '哺乳時間',
    desc: '子女未滿2歲需受僱者親自哺(集)乳者，除規定之休息時間外，雇主應每日另給哺(集)乳時間60分鐘（可分2次各30分鐘）。',
    impact: '排班時應將哺乳時間視為工作時間，不得扣薪。',
  },

  // ── 第19條：減少工時 ──
  reducedHours: {
    law: '性平法 §19',
    title: '育兒減少工時',
    desc: '受僱於僱用30人以上之雇主之受僱者，撫育未滿3歲子女，得向雇主請求每天減少工作時間1小時（減少之工時不得請求報酬）或調整工作時間。',
  },

  // ── 第21條：防止不利對待 ──
  antiRetaliation: {
    law: '性平法 §21',
    title: '禁止不利對待',
    desc: '受僱者依性平法相關規定為請求時，雇主不得拒絕。受僱者為上述請求時，雇主不得視為缺勤而影響全勤獎金、考績或為其他不利之處分。',
  },
}

// ══════════════════════════════════════
//  職業安全衛生法 — 排班相關
// ══════════════════════════════════════

export const OCCUPATIONAL_SAFETY = {
  overworkPrevention: {
    law: '職安法 §6-2',
    title: '過勞預防',
    desc: '雇主對於輪班、夜間工作、長時間工作等異常工作負荷促發疾病之預防，應採取必要之安全衛生措施。',
    measures: [
      '辨識及評估高風險群',
      '安排醫師面談及健康指導',
      '調整或縮短工作時間',
      '更換工作內容',
      '提供保健指導及促進方案',
    ],
  },

  healthCheck: {
    law: '職安法 §20',
    title: '特殊健康檢查',
    desc: '對從事特別危害健康作業者，應定期施行特殊健康檢查，並建立健康檢查手冊。夜間工作者應每年施行特殊健康檢查。',
  },

  pregnantWorker: {
    law: '職安法 §30-1',
    title: '妊娠與哺乳期間保護',
    desc: '雇主不得使妊娠中之女性勞工從事危險性或有害性工作。對於哺乳期間之女性勞工，不得使其從事有害母乳之工作。',
    prohibitedWork: [
      '處理有害物質之作業',
      '鋅、鉛等有害物質之工作',
      '起重機、人字臂起重桿之運轉工作',
      '振動機械或動力衝剪機械之操作',
      '一定重量以上之重物搬運',
    ],
  },

  // ── 2025/12 三讀通過，2026施行 ──
  workplaceBullying: {
    law: '職安法修正案（2026新增專章）',
    title: '職場霸凌防治',
    desc: '2025年12月立法院三讀通過職安法修正案，新增「職場霸凌」專章，為職安法自102年全文修正以來最大幅度調整。',
    measures: [
      '明確定義職場霸凌行為',
      '事業單位應訂定防治措施、申訴管道',
      '通報機制與調查程序',
      '行政罰最高300萬、刑事罰最高關5年',
      '死亡職災罰鍰提高至150萬',
    ],
    note: '施行日期由行政院另定，預計2026年內上路。',
  },

  sourceSafety: {
    law: '職安法修正案（2026強化）',
    title: '源頭防災與承攬管理',
    desc: '一定規模以上工程業主應在規劃階段即分析潛在危害，採取預防作為並編列安全衛生費用。加強承攬安全管理。',
  },
}

// ══════════════════════════════════════
//  排班合規驗證
// ══════════════════════════════════════

export function validateSchedule(schedules, weekDates, shiftDefs = []) {
  const warnings = []
  const errors = []

  // Build shift time lookup from definitions
  const shiftTimeMap = {}
  const shiftHoursMap = {}
  shiftDefs.forEach(d => {
    const startH = parseInt(d.start_time) || 0
    const startM = parseInt((d.start_time || '').split(':')[1]) || 0
    const endH = parseInt(d.end_time) || 0
    const endM = parseInt((d.end_time || '').split(':')[1]) || 0
    const start = startH + startM / 60
    const end = endH + endM / 60
    shiftTimeMap[d.name] = { start: startH, end: endH }
    // Calculate shift duration
    shiftHoursMap[d.name] = end > start ? end - start : (24 - start + end)
  })

  // Group by employee
  const byEmployee = {}
  schedules.forEach(s => {
    if (!byEmployee[s.employee]) byEmployee[s.employee] = []
    byEmployee[s.employee].push(s)
  })

  for (const [emp, empSchedules] of Object.entries(byEmployee)) {
    const workDays = empSchedules.filter(s => s.shift && s.shift !== '休')
    const restDays = empSchedules.filter(s => s.shift === '休')

    // H10: 每週至少2天休息 (§36)
    if (restDays.length < 2 && empSchedules.length >= 7) {
      errors.push({
        employee: emp,
        constraint: 'H10',
        law: '勞基法 §36',
        message: `${emp} 本週僅排 ${restDays.length} 天休息，違反每7日應有2日休息之規定`,
        severity: 'error',
      })
    }

    // H2: 每日工時檢查 — 正常8h，含加班最高12h (§30, §32)
    for (const s of workDays) {
      const hours = shiftHoursMap[s.shift]
      if (hours && hours > 12) {
        errors.push({
          employee: emp,
          constraint: 'H2',
          law: '勞基法 §32',
          message: `${emp} ${s.date} 班次「${s.shift}」工時 ${hours.toFixed(1)}h，超過每日12小時上限`,
          severity: 'error',
        })
      } else if (hours && hours > 8) {
        warnings.push({
          employee: emp,
          constraint: 'H2',
          law: '勞基法 §30',
          message: `${emp} ${s.date} 班次「${s.shift}」工時 ${hours.toFixed(1)}h，超過正常8小時（含加班）`,
          severity: 'warning',
        })
      }
    }

    // 每週工時不超過40小時 (§30)
    let weeklyHours = 0
    for (const s of workDays) {
      weeklyHours += shiftHoursMap[s.shift] || 8
    }
    if (weeklyHours > 40) {
      warnings.push({
        employee: emp,
        constraint: 'S3',
        law: '勞基法 §30',
        message: `${emp} 本週工時 ${weeklyHours.toFixed(1)}h 超過40小時上限`,
        severity: 'warning',
      })
    }

    // H3: 連續工作不超過6天 (§36 七休一)
    let consecutiveWork = 0
    let maxConsecutive = 0
    for (const date of weekDates) {
      const s = empSchedules.find(s => s.date === date)
      if (s?.shift && s.shift !== '休') {
        consecutiveWork++
        maxConsecutive = Math.max(maxConsecutive, consecutiveWork)
      } else {
        consecutiveWork = 0
      }
    }
    if (maxConsecutive > 6) {
      errors.push({
        employee: emp,
        constraint: 'H3',
        law: '勞基法 §36',
        message: `${emp} 連續工作 ${maxConsecutive} 天，超過6天上限（每7日應有1日例假）`,
        severity: 'error',
      })
    }

    // H4: 輪班間隔檢查 (§34) — 用 shift_definitions 的時間
    for (let i = 1; i < empSchedules.length; i++) {
      const prev = empSchedules[i - 1]
      const curr = empSchedules[i]
      if (prev.shift && curr.shift && prev.shift !== '休' && curr.shift !== '休') {
        const prevTime = shiftTimeMap[prev.shift] || parseShiftString(prev.shift)
        const currTime = shiftTimeMap[curr.shift] || parseShiftString(curr.shift)

        if (!prevTime || !currTime) continue

        const prevStart = prevTime.start
        const prevEnd = prevTime.end
        const currStart = currTime.start
        const prevCrossesMidnight = prevEnd < prevStart // e.g., 22:00-06:00

        // Calculate actual gap
        let gap
        if (prevCrossesMidnight) {
          gap = currStart - prevEnd
        } else {
          gap = currStart + (24 - prevEnd)
        }

        if (gap < 11) {
          errors.push({
            employee: emp,
            constraint: 'H4',
            law: '勞基法 §34',
            message: `${emp} ${prev.date}→${curr.date} 輪班間隔僅 ${gap}h（${prev.shift}→${curr.shift}），應至少11小時`,
            severity: 'error',
          })
        }
      }
    }
  }

  return { errors, warnings, isValid: errors.length === 0 }
}

/**
 * Parse a shift string like '14-22' or '6-14' into { start, end }.
 * Fallback for when shiftDefs are not provided.
 */
function parseShiftString(shift) {
  if (!shift || typeof shift !== 'string') return null
  const match = shift.match(/^(\d{1,2})-(\d{1,2})$/)
  if (!match) return null
  return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) }
}

// ══════════════════════════════════════
//  加班費計算
// ══════════════════════════════════════

export function calculateOvertimePay(baseSalary, overtimeHours, type = 'weekday') {
  const hourlyRate = Math.round(baseSalary / 30 / 8)

  if (type === 'weekday') {
    // 平日加班
    const first2 = Math.min(overtimeHours, 2)
    const rest = Math.max(0, overtimeHours - 2)
    return Math.round(hourlyRate * first2 * 1.34 + hourlyRate * rest * 1.67)
  }

  if (type === 'restday') {
    // 休息日
    const first2 = Math.min(overtimeHours, 2)
    const next6 = Math.min(Math.max(0, overtimeHours - 2), 6)
    const rest = Math.max(0, overtimeHours - 8)
    return Math.round(hourlyRate * first2 * 1.34 + hourlyRate * next6 * 1.67 + hourlyRate * rest * 2.67)
  }

  if (type === 'holiday') {
    // 例假日/國定假日
    return Math.round(hourlyRate * overtimeHours * 2)
  }

  return 0
}
