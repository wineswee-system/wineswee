/**
 * F-B4 扣繳憑單媒體申報檔 + 二代健保補充保費（WH-01 ~ WH-06）
 */
import { describe, it, expect } from 'vitest'
import { generateWithholdingSummary } from '../taxReport.js'
import {
  WITHHOLDING_MEDIA_LAYOUT,
  generateWithholdingMediaFile,
  big5ByteLength,
  big5PadRight,
  sliceMediaField,
} from '../withholdingMedia.js'
import {
  calcBonusSupplement,
  calcSinglePaymentSupplement,
  calcEmployerSupplement,
  NHI_SUPPLEMENT_RATE_2026,
  NHI_PARTTIME_THRESHOLD_2026,
  NHI_OTHER_INCOME_THRESHOLD,
  NHI_PAYMENT_CAP,
} from '../nhiSupplement.js'

// ═════════════════════════════════════════════════════════════
describe('WH-01: generateWithholdingSummary 所得類別分組不變', () => {
  const records = [
    { payee_id: 'A123456789', payee_name: '王小明', income_type: '50', gross_amount: 600000, tax_withheld: 30000 },
    { payee_id: 'B987654321', payee_name: '李小華', income_type: '50', gross_amount: 480000, tax_withheld: 15000 },
    { payee_id: 'C111222333', payee_name: '張顧問', income_type: '9A', gross_amount: 200000, tax_withheld: 20000 },
    { payee_id: 'D444555666', payee_name: '房東陳', income_type: '92', gross_amount: 360000, tax_withheld: 36000 },
  ]
  const period = { year: 2026, startMonth: 1, endMonth: 12 }

  it('依 income_type 分組彙總（50/9A/92 三組）', () => {
    const report = generateWithholdingSummary(records, period)
    expect(report.summary_by_type).toHaveLength(3)

    const salary = report.summary_by_type.find(s => s.income_type === '50')
    expect(salary.count).toBe(2)
    expect(salary.total_gross).toBe(1080000)
    expect(salary.total_withheld).toBe(45000)
    expect(salary.income_type_name).toBe('薪資所得')

    const prof = report.summary_by_type.find(s => s.income_type === '9A')
    expect(prof.count).toBe(1)
    expect(prof.income_type_name).toBe('執行業務所得')

    const rent = report.summary_by_type.find(s => s.income_type === '92')
    expect(rent.income_type_name).toBe('租賃所得')
  })

  it('總計正確且逐筆記錄保留', () => {
    const report = generateWithholdingSummary(records, period)
    expect(report.records).toHaveLength(4)
    expect(report.summary.total_records).toBe(4)
    expect(report.summary.total_gross).toBe(1640000)
    expect(report.summary.total_withheld).toBe(101000)
  })
})

// ═════════════════════════════════════════════════════════════
describe('WH-02: 媒體檔固定長度 + CJK byte 補齊 + 欄位位置', () => {
  const records = [
    { format_code: '50', payee_id: 'A123456789', payee_name: '王小明', gross_amount: 600000, tax_withheld: 30000, nhi_premium: 1200 },
    { format_code: '9A', payee_id: 'C111222333', payee_name: '歐陽司徒長姓名', gross_amount: 200000, tax_withheld: 20000, nhi_premium: 4220 },
    { format_code: '50', payee_id: 'E555666777', payee_name: 'John Doe', gross_amount: 480000, tax_withheld: 0, nhi_premium: 0 },
  ]
  const file = generateWithholdingMediaFile(records, { year: 2026, filerUbn: '12345678' })
  const lines = file.split('\n')

  it('每筆記錄 byte 長度 === 120（CJK 一字計 2 bytes）', () => {
    expect(lines).toHaveLength(records.length)
    for (const line of lines) {
      expect(big5ByteLength(line)).toBe(WITHHOLDING_MEDIA_LAYOUT.recordLength)
      expect(big5ByteLength(line)).toBe(120)
    }
  })

  it('版面規格自身一致：起訖相連、總長 120', () => {
    let cursor = 1
    for (const f of WITHHOLDING_MEDIA_LAYOUT.fields) {
      expect(f.start).toBe(cursor)
      cursor += f.length
    }
    expect(cursor - 1).toBe(WITHHOLDING_MEDIA_LAYOUT.recordLength)
  })

  it('CJK byte 補齊：3 個中文字（6 bytes）補到 20 bytes、不切半字', () => {
    const padded = big5PadRight('王小明', 20)
    expect(big5ByteLength(padded)).toBe(20)
    expect(padded.startsWith('王小明')).toBe(true)
    expect(padded.slice(3)).toBe(' '.repeat(14)) // 6 bytes 中文 + 14 空白

    // 超長截斷：12 個中文字 = 24 bytes → 只留 10 字（20 bytes）、不切半字
    const long = big5PadRight('歐陽司徒長姓名測試超長字', 20)
    expect(big5ByteLength(long)).toBe(20)
    expect(long).toBe('歐陽司徒長姓名測試超')

    // 奇數缺口：9 個中文字 = 18 bytes，第 10 字塞不下（2 bytes > 剩 1）→ 整字捨去補空白
    const odd = big5PadRight('一二三四五六七八九', 19)
    expect(big5ByteLength(odd)).toBe(19)
    expect(odd).toBe('一二三四五六七八九 ')
  })

  it('欄位位置符合 WITHHOLDING_MEDIA_LAYOUT（byte-aware 取值）', () => {
    const first = lines[0]
    expect(sliceMediaField(first, 'format_code')).toBe('50')
    expect(sliceMediaField(first, 'filer_ubn')).toBe('12345678')
    expect(sliceMediaField(first, 'roc_year')).toBe('115') // 2026 − 1911
    expect(sliceMediaField(first, 'payee_id')).toBe('A123456789')
    expect(sliceMediaField(first, 'payee_name').trimEnd()).toBe('王小明')
    expect(sliceMediaField(first, 'gross_amount')).toBe('000000600000')
    expect(sliceMediaField(first, 'tax_withheld')).toBe('0000030000')
    expect(sliceMediaField(first, 'nhi_premium')).toBe('0000001200')

    // 含字母格式代別（9A）不可被數字化成 00
    expect(sliceMediaField(lines[1], 'format_code')).toBe('9A')

    // 純 ASCII 姓名列：可用一般 slice 直接對版面位置驗證
    const ascii = lines[2]
    const nameField = WITHHOLDING_MEDIA_LAYOUT.fields.find(f => f.name === 'payee_name')
    expect(ascii.slice(nameField.start - 1, nameField.start - 1 + nameField.length).trimEnd()).toBe('John Doe')
  })
})

// ═════════════════════════════════════════════════════════════
describe('WH-03: 高額獎金 — 只課超過 4 倍投保薪資的超額（跨月累計）', () => {
  const insured = 45800 // 4 倍門檻 = 183,200
  const base = { insuredSalary: insured, rate: NHI_SUPPLEMENT_RATE_2026 }

  it('累計未達 4 倍 → 免扣', () => {
    const r = calcBonusSupplement({ ...base, cumulativeBonusBefore: 0, thisBonus: 100000 })
    expect(r.taxableBase).toBe(0)
    expect(r.premium).toBe(0)
  })

  it('本次跨越門檻 → 只課超過門檻那一段', () => {
    // 累計前 150,000、本次 50,000 → 累計後 200,000、超額 16,800
    const r = calcBonusSupplement({ ...base, cumulativeBonusBefore: 150000, thisBonus: 50000 })
    expect(r.taxableBase).toBe(16800)
    expect(r.premium).toBe(Math.round(16800 * 0.0211)) // 354
  })

  it('累計前已超門檻 → 本次全額計費', () => {
    const r = calcBonusSupplement({ ...base, cumulativeBonusBefore: 200000, thisBonus: 30000 })
    expect(r.taxableBase).toBe(30000)
    expect(r.premium).toBe(Math.round(30000 * 0.0211)) // 633
  })

  it('多次給付情境表：全年逐月累計正確（各月分段相加 = 年度總超額）', () => {
    // 投保 45,800 → 門檻 183,200；1 月 100k、2 月 100k、3 月 50k
    const table = [
      { before: 0,      bonus: 100000, expectTaxable: 0 },      // 累計 100,000 ≤ 門檻
      { before: 100000, bonus: 100000, expectTaxable: 16800 },  // 跨越：200,000 − 183,200
      { before: 200000, bonus: 50000,  expectTaxable: 50000 },  // 已超門檻 → 全額
    ]
    let totalTaxable = 0
    for (const c of table) {
      const r = calcBonusSupplement({ ...base, cumulativeBonusBefore: c.before, thisBonus: c.bonus })
      expect(r.taxableBase).toBe(c.expectTaxable)
      totalTaxable += r.taxableBase
    }
    // 年度總超額 = 累計 250,000 − 門檻 183,200
    expect(totalTaxable).toBe(250000 - 183200)
  })

  it('無投保金額（未在本單位投保）→ 不屬本類，回 0', () => {
    const r = calcBonusSupplement({ cumulativeBonusBefore: 0, thisBonus: 500000, insuredSalary: 0 })
    expect(r.taxableBase).toBe(0)
    expect(r.premium).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('WH-04: 門檻與 1,000 萬計費上限（雙向）', () => {
  it('單次給付低於門檻 → 免扣；達門檻 → 全額計費', () => {
    const below = calcSinglePaymentSupplement({ amount: 19999, category: '股利' })
    expect(below.belowThreshold).toBe(true)
    expect(below.premium).toBe(0)

    const at = calcSinglePaymentSupplement({ amount: 20000, category: '股利' })
    expect(at.belowThreshold).toBe(false)
    expect(at.taxableBase).toBe(20000)
    expect(at.premium).toBe(Math.round(20000 * NHI_SUPPLEMENT_RATE_2026)) // 422
  })

  it('超過 1,000 萬 → 計費基礎以上限計', () => {
    const r = calcSinglePaymentSupplement({ amount: 25000000, category: '股利' })
    expect(r.taxableBase).toBe(NHI_PAYMENT_CAP) // 10,000,000
    expect(r.premium).toBe(Math.round(NHI_PAYMENT_CAP * NHI_SUPPLEMENT_RATE_2026)) // 211,000
  })

  it('恰在上限 → 全額；上限內 → 不截斷', () => {
    const atCap = calcSinglePaymentSupplement({ amount: NHI_PAYMENT_CAP, category: '利息' })
    expect(atCap.taxableBase).toBe(NHI_PAYMENT_CAP)

    const under = calcSinglePaymentSupplement({ amount: 9999999, category: '利息' })
    expect(under.taxableBase).toBe(9999999)
  })

  it('高額獎金類的超額也套 1,000 萬上限', () => {
    const r = calcBonusSupplement({
      cumulativeBonusBefore: 100000000, // 已遠超門檻 → 本次全額
      thisBonus: 25000000,
      insuredSalary: 45800,
    })
    expect(r.taxableBase).toBe(NHI_PAYMENT_CAP)
    expect(r.premium).toBe(211000)
  })
})

// ═════════════════════════════════════════════════════════════
describe('WH-05: 兼職所得類（門檻 = 基本工資）', () => {
  it('低於基本工資 29,500 → 免扣', () => {
    const r = calcSinglePaymentSupplement({ amount: 29499, category: '兼職所得' })
    expect(r.belowThreshold).toBe(true)
    expect(r.premium).toBe(0)
  })

  it('達基本工資 → 全額計費（非只課超過部分）', () => {
    const r = calcSinglePaymentSupplement({ amount: NHI_PARTTIME_THRESHOLD_2026, category: '兼職所得' })
    expect(r.belowThreshold).toBe(false)
    expect(r.taxableBase).toBe(29500)
    expect(r.premium).toBe(Math.round(29500 * 0.0211)) // 622
  })

  it('兼職門檻（29,500）與其他類門檻（20,000）分開', () => {
    // 25,000：兼職免扣、股利要扣
    const pt = calcSinglePaymentSupplement({ amount: 25000, category: '兼職所得' })
    const dividend = calcSinglePaymentSupplement({ amount: 25000, category: '股利' })
    expect(pt.belowThreshold).toBe(true)
    expect(dividend.belowThreshold).toBe(false)
    expect(NHI_PARTTIME_THRESHOLD_2026).toBe(29500)
    expect(NHI_OTHER_INCOME_THRESHOLD).toBe(20000)
  })

  it('外部傳入年度門檻（參數表）覆蓋預設', () => {
    const r = calcSinglePaymentSupplement({ amount: 28000, category: '兼職所得', threshold: 27470 })
    expect(r.belowThreshold).toBe(false)
    expect(r.taxableBase).toBe(28000)
  })
})

// ═════════════════════════════════════════════════════════════
describe('WH-06: 雇主負擔公式（含負值 → 0 下限）', () => {
  it('薪資總額 > 投保總額 → 差額 × 2.11%', () => {
    const r = calcEmployerSupplement({ salaryTotal: 1200000, insuredTotal: 1000000 })
    expect(r.taxableBase).toBe(200000)
    expect(r.premium).toBe(Math.round(200000 * 0.0211)) // 4,220
  })

  it('投保總額 ≥ 薪資總額 → 0（不得為負）', () => {
    const r = calcEmployerSupplement({ salaryTotal: 900000, insuredTotal: 1000000 })
    expect(r.taxableBase).toBe(0)
    expect(r.premium).toBe(0)
  })

  it('相等 → 0；空值防禦 → 0', () => {
    expect(calcEmployerSupplement({ salaryTotal: 500000, insuredTotal: 500000 }).premium).toBe(0)
    expect(calcEmployerSupplement({}).premium).toBe(0)
  })

  it('自訂費率（年度參數）生效', () => {
    const r = calcEmployerSupplement({ salaryTotal: 1100000, insuredTotal: 1000000, rate: 0.02 })
    expect(r.premium).toBe(2000)
  })
})
