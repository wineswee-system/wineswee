import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  validateGTIN13,
  computeGTIN13CheckDigit,
  parseScaleBarcode,
  classifyBarcode,
  resolveScan,
} from '../barcode.js'

// ─── supabase mock（單一主要條碼契約用）──────────────────────
// 鏈式 builder：記錄 update/eq/neq 呼叫順序與參數，await 時回 {data, error}
const dbCalls = []
function makeBuilder(table) {
  const call = { table, op: null, payload: null, filters: [] }
  const builder = {
    update(payload) { call.op = 'update'; call.payload = payload; dbCalls.push(call); return builder },
    insert(payload) { call.op = 'insert'; call.payload = payload; dbCalls.push(call); return builder },
    delete() { call.op = 'delete'; dbCalls.push(call); return builder },
    select() { return builder },
    eq(col, val) { call.filters.push({ op: 'eq', col, val }); return builder },
    neq(col, val) { call.filters.push({ op: 'neq', col, val }); return builder },
    not() { return builder },
    order() { return builder },
    limit() { return builder },
    single() { return Promise.resolve({ data: { id: 99, is_primary: true }, error: null }) },
    maybeSingle() { return Promise.resolve({ data: null, error: null }) },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) },
  }
  return builder
}
vi.mock('../supabase', () => ({
  supabase: { from: (table) => makeBuilder(table) },
}))

// 固定測資：
// - '4006381333931'：真實有效 GTIN-13（檢查碼 1）
// - '2601234012500'：秤重碼 flag'2' + 部門'6' + 品號'01234' + 值'01250' + 檢查碼'0'
const VALID_GTIN = '4006381333931'
const SCALE_CODE = '2601234012500'

// ═════════════════════════════════════════════════════════════
//  BC-01 GTIN-13 檢查碼
// ═════════════════════════════════════════════════════════════

describe('BC-01 GTIN-13 checksum', () => {
  it('有效 GTIN-13 通過驗證', () => {
    expect(validateGTIN13(VALID_GTIN)).toBe(true)
  })

  it('檢查碼錯誤 / 格式錯誤皆拒絕', () => {
    expect(validateGTIN13('4006381333932')).toBe(false) // 末碼 +1
    expect(validateGTIN13('400638133393')).toBe(false)  // 12 碼
    expect(validateGTIN13('40063813339311')).toBe(false)// 14 碼
    expect(validateGTIN13('400638133393a')).toBe(false) // 非數字
    expect(validateGTIN13(null)).toBe(false)
    expect(validateGTIN13('')).toBe(false)
  })

  it('computeGTIN13CheckDigit 計算正確、可與 validate 互證', () => {
    expect(computeGTIN13CheckDigit('400638133393')).toBe(1)
    expect(computeGTIN13CheckDigit('260123401250')).toBe(0)
    // 任意前綴：算出的檢查碼組回去必定驗證通過
    const prefix = '471234567890'
    const d = computeGTIN13CheckDigit(prefix)
    expect(validateGTIN13(prefix + d)).toBe(true)
    // 非法輸入
    expect(computeGTIN13CheckDigit('12345')).toBe(null)
    expect(computeGTIN13CheckDigit(undefined)).toBe(null)
  })
})

// ═════════════════════════════════════════════════════════════
//  BC-02 秤重碼解析（price / weight 模式 + 竄改檢查碼）
// ═════════════════════════════════════════════════════════════

describe('BC-02 parseScaleBarcode', () => {
  it('price 模式：品號 + 內含金額（整數元）', () => {
    const r = parseScaleBarcode(SCALE_CODE, 'price')
    expect(r.valid).toBe(true)
    expect(r.flag).toBe('2')
    expect(r.deptCode).toBe('6')
    expect(r.itemCode).toBe('01234')
    expect(r.value).toBe(1250)
    expect(r.mode).toBe('price')
  })

  it('weight 模式：值欄位為公克 → 回傳公斤', () => {
    const r = parseScaleBarcode(SCALE_CODE, 'weight')
    expect(r.valid).toBe(true)
    expect(r.itemCode).toBe('01234')
    expect(r.value).toBe(1.25) // 01250 g = 1.25 kg
    expect(r.mode).toBe('weight')
  })

  it('檢查碼被竄改 → valid=false 且不回傳品號', () => {
    const tampered = SCALE_CODE.slice(0, 12) + '1' // 末碼 0 → 1
    const r = parseScaleBarcode(tampered, 'price')
    expect(r.valid).toBe(false)
    expect(r.itemCode).toBe(null)
    expect(r.value).toBe(null)
  })

  it('非 2 開頭 / 非 13 碼 → valid=false', () => {
    expect(parseScaleBarcode(VALID_GTIN).valid).toBe(false)   // 4 開頭
    expect(parseScaleBarcode('26012340125').valid).toBe(false) // 11 碼
  })
})

// ═════════════════════════════════════════════════════════════
//  BC-03 分類 + resolveScan + 單一主要條碼契約
// ═════════════════════════════════════════════════════════════

describe('BC-03 classifyBarcode', () => {
  it('分類正確：GTIN-13 / 秤重碼 / 店內碼 / unknown', () => {
    expect(classifyBarcode(VALID_GTIN)).toBe('GTIN-13')
    expect(classifyBarcode(SCALE_CODE)).toBe('秤重碼')
    expect(classifyBarcode('SKU-001')).toBe('店內碼')
    expect(classifyBarcode('A123456')).toBe('店內碼')
    expect(classifyBarcode('4006381333932')).toBe('unknown') // 13 碼但檢查碼錯
    expect(classifyBarcode('')).toBe('unknown')
    expect(classifyBarcode(null)).toBe('unknown')
  })
})

describe('BC-03 resolveScan', () => {
  it('秤重碼：以解析出的品號查 SKU 並帶回內含金額', async () => {
    const lookup = vi.fn(async (code) => code === '01234' ? { sku: { id: 7, code: '01234' } } : null)
    const r = await resolveScan(SCALE_CODE, lookup)
    expect(lookup).toHaveBeenCalledWith('01234')
    expect(r.type).toBe('秤重碼')
    expect(r.found).toBe(true)
    expect(r.embeddedPrice).toBe(1250)
    expect(r.embeddedWeight).toBe(null)
  })

  it('GTIN-13 / 店內碼：直接以原條碼查', async () => {
    const lookup = vi.fn(async () => ({ sku: { id: 1 } }))
    const r = await resolveScan(VALID_GTIN, lookup)
    expect(lookup).toHaveBeenCalledWith(VALID_GTIN)
    expect(r.type).toBe('GTIN-13')
    expect(r.found).toBe(true)
  })

  it('unknown 條碼不查詢、found=false', async () => {
    const lookup = vi.fn()
    const r = await resolveScan('!!', lookup)
    expect(lookup).not.toHaveBeenCalled()
    expect(r.found).toBe(false)
    expect(r.type).toBe('unknown')
  })
})

describe('BC-03 單一主要條碼契約（setPrimaryBarcode）', () => {
  beforeEach(() => { dbCalls.length = 0 })

  it('先清同 SKU 其他列 is_primary=false，再設目標列 true（順序契約）', async () => {
    const { setPrimaryBarcode } = await import('../db/skuBarcodes.js')
    await setPrimaryBarcode(42, 99)

    const updates = dbCalls.filter(c => c.op === 'update' && c.table === 'sku_barcodes')
    expect(updates).toHaveLength(2)

    // 第 1 步：清除其他列（sku_id=42、id≠99、is_primary:false）
    expect(updates[0].payload).toEqual({ is_primary: false })
    expect(updates[0].filters).toContainEqual({ op: 'eq', col: 'sku_id', val: 42 })
    expect(updates[0].filters).toContainEqual({ op: 'neq', col: 'id', val: 99 })

    // 第 2 步：設定目標列（id=99、is_primary:true）
    expect(updates[1].payload).toEqual({ is_primary: true })
    expect(updates[1].filters).toContainEqual({ op: 'eq', col: 'id', val: 99 })
  })
})
