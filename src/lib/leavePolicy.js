/**
 * 台灣勞動法規 — 假別規則引擎
 *
 * 依據：
 * - 勞動基準法（勞基法）
 * - 性別平等工作法（性平法）
 * - 勞工請假規則
 * - 就業保險法（育嬰留停）
 *
 * 最後更新：2026-04（含2026/1/1新制）
 *
 * 2026 重大修正：
 * - 勞工請假規則修正（2026/1/1施行）：
 *   1. 病假10天內不得做不利處分（§4-1新增）
 *   2. 全勤獎金改按比例扣除，不得全扣（§9修正）
 *   3. 家庭照顧假可以小時為單位（§7修正）
 * - 育嬰留停彈性化（2026新制）：
 *   1. 可以「日」為單位申請（每人30日額度）
 *   2. 雙親可同時申請，合計領160%投保薪資
 * - 基本工資調升：月薪29,500元、時薪196元
 */

// ══════════════════════════════════════
//  假別完整定義
// ══════════════════════════════════════

export const LEAVE_TYPES = [
  // ── 勞基法 第38條：特別休假 ──
  {
    code: 'annual',
    name: '特別休假',
    shortName: '特休',
    law: '勞基法 §38',
    paid: true,
    unit: 'day', // day | hour
    minUnit: 0.5, // 最小請假單位（天）
    allowHourly: true,
    salary: '照給',
    description: '年度特別休假，未休完應折算工資',
    calcEntitlement: (yearsWorked) => {
      // 勞基法 §38 年資對應特休天數
      if (yearsWorked < 0.5) return 0
      if (yearsWorked < 1) return 3    // 6個月以上未滿1年：3天
      if (yearsWorked < 2) return 7    // 1年以上未滿2年：7天
      if (yearsWorked < 3) return 10   // 2年以上未滿3年：10天
      if (yearsWorked < 5) return 14   // 3年以上未滿5年：14天
      if (yearsWorked < 10) return 15  // 5年以上未滿10年：15天
      return Math.min(30, 15 + (Math.floor(yearsWorked) - 10)) // 10年以上：每年+1天，上限30天
    },
    settlement: '到職週年未休完，應於次月薪資結清折算工資（勞基法 §38-4）',
  },

  // ── 勞工請假規則 第4條：普通傷病假 ──
  {
    code: 'sick',
    name: '普通傷病假',
    shortName: '病假',
    law: '勞工請假規則 §4、§4-1（2026新制）',
    paid: true,
    unit: 'hour',
    minUnit: 1,
    allowHourly: true,
    maxDays: 30,
    salary: '減半發給（不得低於基本工資 NT$29,500）',
    description: '因普通傷害、疾病或生理原因必須治療或休養',
    deduction: '折半扣薪',
    note2026: '【2026新制】一年內病假10天以內，雇主不得做任何不利處分（扣考績、降績效等），違者最高罰100萬。全勤獎金改按比例計算，不得因請1天病假就全扣。',
  },

  // ── 勞工請假規則 第7條：事假 ──
  {
    code: 'personal',
    name: '事假',
    shortName: '事假',
    law: '勞工請假規則 §7',
    paid: false,
    unit: 'hour',
    minUnit: 1,
    allowHourly: true,
    maxDays: 14, // 1年內合計不得超過14天
    salary: '不給薪',
    description: '因事必須親自處理',
    deduction: '全日扣薪',
  },

  // ── 勞工請假規則 第8條：公假 ──
  {
    code: 'official',
    name: '公假',
    shortName: '公假',
    law: '勞工請假規則 §8',
    paid: true,
    unit: 'day',
    minUnit: 0.5,
    allowHourly: false,
    salary: '照給',
    description: '依法令規定應給予公假（選舉投票、教召、作證等）',
  },

  // ── 勞基法 第50條 + 性平法 §15：產假 ──
  {
    code: 'maternity',
    name: '產假',
    shortName: '產假',
    law: '勞基法 §50、性平法 §15',
    paid: true,
    unit: 'day',
    minUnit: 1,
    allowHourly: false,
    gender: 'female',
    conditions: [
      { desc: '分娩（任職滿6個月）', days: 56, salary: '8週全薪' },
      { desc: '分娩（任職未滿6個月）', days: 56, salary: '8週半薪' },
      { desc: '妊娠3個月以上流產', days: 28, salary: '4週全薪' },
      { desc: '妊娠2-3個月流產', days: 7, salary: '1週全薪' },
      { desc: '妊娠未滿2個月流產', days: 5, salary: '5天全薪' },
    ],
    description: '女性員工分娩或流產時給予之假期',
  },

  // ── 性平法 §15：陪產檢及陪產假 ──
  {
    code: 'paternity',
    name: '陪產檢及陪產假',
    shortName: '陪產假',
    law: '性平法 §15',
    paid: true,
    unit: 'day',
    minUnit: 1,
    allowHourly: false,
    maxDays: 7, // 2024年修法後為7天
    salary: '照給',
    description: '配偶分娩時，給予7日陪產檢及陪產假（可分次請，應於配偶分娩當日及前後合計15日內請畢）',
  },

  // ── 性平法 §16 + 就業保險法 §11：育嬰留職停薪 ──
  {
    code: 'parental',
    name: '育嬰留職停薪',
    shortName: '育嬰假',
    law: '性平法 §16、就業保險法 §11（2026彈性新制）',
    paid: false,
    unit: 'day',
    minUnit: 1,
    allowHourly: false,
    maxDays: 730,
    salary: '留停期間：就保津貼60% + 政府補助20% = 投保薪資80%（最長6個月/人）',
    description: '子女滿3歲前，得申請育嬰留職停薪，期間最長2年',
    note2026: '【2026新制】可以「日」為單位申請（每人30日彈性額度）。雙親可同時申請留停，合計可領160%投保薪資補助（各領80%）。津貼免稅、直接入戶。',
  },

  // ── 性平法 §14：生理假 ──
  {
    code: 'menstrual',
    name: '生理假',
    shortName: '生理假',
    law: '性平法 §14',
    paid: true,
    unit: 'day',
    minUnit: 0.5,
    allowHourly: true,
    maxDays: 12, // 每月1天，超過病假30天部分減半發給
    gender: 'female',
    salary: '前3天（併入病假30天計算）減半發給；超過30天部分減半發給',
    description: '女性員工因生理日致工作有困難，每月得請生理假1日',
  },

  // ── 勞工請假規則 第2條：婚假 ──
  {
    code: 'marriage',
    name: '婚假',
    shortName: '婚假',
    law: '勞工請假規則 §2',
    paid: true,
    unit: 'day',
    minUnit: 1,
    allowHourly: false,
    maxDays: 8, // 8天
    salary: '照給',
    description: '結婚給予8日婚假（自結婚登記日前10日起3個月內請畢）',
  },

  // ── 勞工請假規則 第3條：喪假 ──
  {
    code: 'bereavement',
    name: '喪假',
    shortName: '喪假',
    law: '勞工請假規則 §3',
    paid: true,
    unit: 'day',
    minUnit: 1,
    allowHourly: false,
    conditions: [
      { desc: '父母、養父母、繼父母、配偶喪亡', days: 8 },
      { desc: '祖父母、子女、配偶之父母喪亡', days: 6 },
      { desc: '曾祖父母、兄弟姊妹、配偶之祖父母喪亡', days: 3 },
    ],
    salary: '照給',
    description: '親屬喪亡給予喪假（應於百日內請畢）',
  },

  // ── 性平法 §20：家庭照顧假 ──
  {
    code: 'family_care',
    name: '家庭照顧假',
    shortName: '家庭照顧',
    law: '性平法 §20、勞工請假規則 §7（2026修正）',
    paid: false,
    unit: 'hour',
    minUnit: 1,
    allowHourly: true,
    maxDays: 7,
    salary: '不給薪（日數併入事假計算），不得扣全勤獎金',
    description: '家庭成員預防接種、發生嚴重疾病或其他重大事故須親自照顧',
    note2026: '【2026新制】可以「小時」為單位請假。雇主不得因請家庭照顧假而扣發全勤獎金。',
  },

  // ── 心理健康假（公司自訂福利，非勞基法強制）──
  // 註：勞基法 / 勞工請假規則「未」將員工心理健康假納入強制；
  //     教育部 2024 推「身心調適假」僅適用學生（高中、大學），不含員工。
  //     2026/1/1 上路的勞工請假規則修法也沒含此假別。
  //     部分企業（台積電、Google 等）自願提供，屬「福利」性質。
  {
    code: 'mental_health',
    name: '心理健康假',
    shortName: '心理假',
    law: '公司自訂福利（非勞基法強制）',
    paid: true,
    unit: 'day',
    minUnit: 0.5,
    allowHourly: true,
    maxDays: 3, // 公司自訂，每年 3 天
    salary: '依公司政策（一般比照病假，不併入病假計算）',
    description: '公司自願提供之心理健康假，非法定假別，每年 3 天',
    note: '勞基法 / 勞工請假規則尚未強制要求；公司可自行決定是否提供',
  },

  // ── 勞基法 第59條（職業災害補償）+ 勞工請假規則 第6條：公傷病假 ──
  {
    code: 'occupational',
    name: '公傷病假',
    shortName: '工傷假',
    law: '勞基法 §59、勞工請假規則 §6',
    paid: true,
    unit: 'day',
    minUnit: 1,
    allowHourly: false,
    salary: '照給原領工資（依勞基法§59職業災害補償）',
    description: '因職業災害而致殘廢、傷害或疾病，公傷病假期間工資照給',
  },

  // ── 性平法 §18：哺(集)乳時間 ──
  {
    code: 'nursing',
    name: '哺乳時間',
    shortName: '哺乳',
    law: '性平法 §18',
    paid: true,
    unit: 'hour',
    minUnit: 0.5,
    allowHourly: true,
    gender: 'female',
    salary: '照給（每日2次，每次30分鐘）',
    description: '子女未滿2歲需哺乳者，每日2次哺乳時間各30分鐘，視為工作時間',
  },

  // ── 性平法 §15：產檢假 ──
  {
    code: 'prenatal',
    name: '產檢假',
    shortName: '產檢假',
    law: '性平法 §15',
    paid: true,
    unit: 'day',
    minUnit: 0.5,
    allowHourly: true,
    maxDays: 7, // 2024年修法後7天
    gender: 'female',
    salary: '照給',
    description: '妊娠期間產檢，給予7日產檢假（可以小時為單位請假）',
  },
]

// ══════════════════════════════════════
//  計算特休天數
// ══════════════════════════════════════

export function getAnnualLeaveEntitlement(joinDate) {
  if (!joinDate) return { days: 0, yearsWorked: 0 }
  const now = new Date()
  const join = new Date(joinDate)
  const yearsWorked = (now - join) / (365.25 * 86400000)
  const policy = LEAVE_TYPES.find(t => t.code === 'annual')
  return {
    days: policy.calcEntitlement(yearsWorked),
    yearsWorked: Math.round(yearsWorked * 10) / 10,
  }
}

// ══════════════════════════════════════
//  取得假別完整資訊
// ══════════════════════════════════════

export function getLeaveTypeInfo(code) {
  return LEAVE_TYPES.find(t => t.code === code || t.shortName === code || t.name === code)
}

// ══════════════════════════════════════
//  驗證請假規則
// ══════════════════════════════════════

export function validateLeaveRequest({ type, days, hours, usedDays, gender, customPolicy, joinDate }) {
  const policy = getLeaveTypeInfo(type)
  if (!policy) return { valid: false, error: '無效的假別' }

  // 性別限制
  if (policy.gender === 'female' && gender === 'male') {
    return { valid: false, error: `${policy.name}僅限女性員工申請` }
  }

  // 特休年資檢查（勞基法 §38：須滿 6 個月才有特休）
  if (policy.code === 'annual') {
    if (!joinDate) {
      return { valid: false, error: '員工資料缺到職日，無法計算特休年資' }
    }
    const { days: entitlement, yearsWorked } = getAnnualLeaveEntitlement(joinDate)
    if (entitlement === 0) {
      return { valid: false, error: `未滿 6 個月年資（目前 ${yearsWorked} 年），尚無特休資格` }
    }
    const extraDays = Math.max(0, customPolicy?.extra_days || 0)
    const totalEntitlement = entitlement + extraDays
    const requestDays = days || (hours ? hours / 8 : 0)
    const used = usedDays || 0
    if (used + requestDays > totalEntitlement) {
      const suffix = extraDays > 0 ? `（含加給 ${extraDays} 天）` : ''
      const remaining = totalEntitlement - used
      return {
        valid: false,
        error: `特休餘額不足：年度 ${totalEntitlement} 天${suffix}，已用 ${used} 天，剩餘 ${remaining} 天，不足申請 ${requestDays} 天`,
      }
    }
  }

  // 其他假別天數上限（法定 + 門市/員工加給）
  if (policy.maxDays && usedDays !== undefined) {
    const extraDays = Math.max(0, customPolicy?.extra_days || 0)
    const effectiveMax = policy.maxDays + extraDays
    const remaining = effectiveMax - usedDays
    const requestDays = days || (hours ? hours / 8 : 0)
    if (requestDays > remaining) {
      const suffix = extraDays > 0 ? `（含加給 ${extraDays} 天）` : ''
      return {
        valid: false,
        error: `${policy.name}已使用 ${usedDays} 天，上限 ${effectiveMax} 天${suffix}，剩餘 ${remaining} 天，不足申請 ${requestDays} 天`,
      }
    }
  }

  return { valid: true, policy }
}

// ══════════════════════════════════════
//  計算扣薪
// ══════════════════════════════════════

export function calculateDeduction({ type, days, hours, baseSalary }) {
  const policy = getLeaveTypeInfo(type)
  if (!policy) return 0

  const dailyRate = baseSalary ? Math.round(baseSalary / 30) : 0
  const hourlyRate = Math.round(dailyRate / 8)
  const effectiveDays = days || (hours ? hours / 8 : 0)

  if (policy.paid === false) {
    // 不給薪：全額扣
    return hours ? hourlyRate * hours : dailyRate * effectiveDays
  }

  if (policy.code === 'sick' || policy.code === 'menstrual') {
    // 病假/生理假：減半發給
    return hours ? Math.round(hourlyRate * hours * 0.5) : Math.round(dailyRate * effectiveDays * 0.5)
  }

  return 0 // 有薪假不扣
}
