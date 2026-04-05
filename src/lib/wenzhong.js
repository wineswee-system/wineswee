/**
 * 文中資訊 (Wen-Chung) Connector
 * Supports CSV file import and API integration for:
 *   - Products / SKUs
 *   - Customers
 *   - Sales / POS transactions
 *   - Inventory / Stock levels
 *   - Suppliers
 *   - Accounting journal entries
 */

// ── CSV Parsing ────────────────────────────────────────────

/**
 * Parse a CSV string (handles BOM, quoted fields, CRLF/LF).
 * Returns { headers: string[], rows: Record<string, string>[] }
 */
export function parseCSV(text) {
  // Strip UTF-8 BOM
  const clean = text.replace(/^\uFEFF/, '')
  const lines = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if ((ch === '\n' || (ch === '\r' && clean[i + 1] === '\n')) && !inQuotes) {
      lines.push(current)
      current = ''
      if (ch === '\r') i++
    } else {
      current += ch
    }
  }
  if (current.trim()) lines.push(current)

  if (lines.length < 2) return { headers: [], rows: [] }

  const headers = splitCSVLine(lines[0])
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = splitCSVLine(line)
    const obj = {}
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim() })
    return obj
  })
  return { headers, rows }
}

function splitCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current); current = '' }
    else { current += ch }
  }
  result.push(current)
  return result
}

// ── Field Mapping Definitions ──────────────────────────────

/**
 * Each module maps 文中 CSV column headers → Supabase column names.
 * `required` fields must be present; `transform` converts values.
 */
export const FIELD_MAPS = {
  products: {
    label: '商品 / SKU',
    table: 'skus',
    fields: {
      '商品編號': { to: 'code', required: true },
      '商品名稱': { to: 'name', required: true },
      '單位':     { to: 'unit', default: '個' },
      '售價':     { to: 'sell_price', transform: Number },
      '成本':     { to: 'cost_price', transform: Number },
      '條碼':     { to: 'barcode' },
      '分類':     { to: 'category' },
      '規格':     { to: 'spec' },
      '品牌':     { to: 'brand' },
      '庫存單位':  { to: 'stock_unit' },
      '最低庫存':  { to: 'reorder_point', transform: Number },
      '狀態':     { to: 'status', transform: v => v === '停用' ? 'inactive' : 'active' },
    },
    // Alternate header names commonly seen in 文中 exports
    aliases: {
      '品號': '商品編號', '品名': '商品名稱', '單價': '售價',
      '進貨成本': '成本', 'BarCode': '條碼', '類別': '分類',
    },
  },

  customers: {
    label: '客戶',
    table: 'customers',
    fields: {
      '客戶編號': { to: 'code', required: true },
      '客戶名稱': { to: 'name', required: true },
      '聯絡人':   { to: 'contact_person' },
      '電話':     { to: 'phone' },
      '手機':     { to: 'mobile' },
      'Email':    { to: 'email' },
      '地址':     { to: 'address' },
      '統一編號': { to: 'tax_id' },
      '付款條件': { to: 'payment_terms' },
      '備註':     { to: 'notes' },
      '信用額度': { to: 'credit_limit', transform: Number },
      '客戶等級': { to: 'tier' },
    },
    aliases: {
      '客編': '客戶編號', '客名': '客戶名稱', '連絡人': '聯絡人',
      'TEL': '電話', '行動電話': '手機', '統編': '統一編號',
    },
  },

  suppliers: {
    label: '供應商',
    table: 'suppliers',
    fields: {
      '供應商編號': { to: 'code', required: true },
      '供應商名稱': { to: 'name', required: true },
      '聯絡人':     { to: 'contact_person' },
      '電話':       { to: 'phone' },
      'Email':      { to: 'email' },
      '地址':       { to: 'address' },
      '統一編號':   { to: 'tax_id' },
      '付款條件':   { to: 'payment_terms' },
      '備註':       { to: 'notes' },
    },
    aliases: {
      '廠商編號': '供應商編號', '廠商名稱': '供應商名稱', '廠編': '供應商編號',
      '廠名': '供應商名稱', '統編': '統一編號',
    },
  },

  sales: {
    label: '銷售 / POS 交易',
    table: 'pos_transactions',
    fields: {
      '單據編號':   { to: 'receipt_no', required: true },
      '交易日期':   { to: 'transaction_date', required: true, transform: parseDate },
      '商品編號':   { to: 'sku_code' },
      '商品名稱':   { to: 'sku_name' },
      '數量':       { to: 'qty', transform: Number },
      '單價':       { to: 'unit_price', transform: Number },
      '小計':       { to: 'subtotal', transform: Number },
      '折扣':       { to: 'discount', transform: Number },
      '合計':       { to: 'total', transform: Number },
      '付款方式':   { to: 'payment_method' },
      '收銀員':     { to: 'cashier' },
      '門市':       { to: 'store' },
      '會員編號':   { to: 'member_code' },
      '發票號碼':   { to: 'invoice_no' },
    },
    aliases: {
      '單號': '單據編號', '日期': '交易日期', '品號': '商品編號',
      '品名': '商品名稱', '金額': '合計', '收款方式': '付款方式',
    },
  },

  inventory: {
    label: '庫存',
    table: 'stock_levels',
    fields: {
      '商品編號':   { to: 'sku_code', required: true },
      '商品名稱':   { to: 'sku_name' },
      '倉庫':       { to: 'warehouse', default: '主倉' },
      '現有庫存':   { to: 'on_hand', transform: Number },
      '可用庫存':   { to: 'available', transform: Number },
      '已預留':     { to: 'reserved', transform: Number },
      '安全庫存':   { to: 'safety_stock', transform: Number },
      '最後盤點日': { to: 'last_count_date', transform: parseDate },
    },
    aliases: {
      '品號': '商品編號', '品名': '商品名稱', '庫存量': '現有庫存',
      '儲位': '倉庫', '盤點日': '最後盤點日',
    },
  },

  journal: {
    label: '會計傳票',
    table: 'journal_entries',
    fields: {
      '傳票編號':   { to: 'entry_no', required: true },
      '日期':       { to: 'date', required: true, transform: parseDate },
      '科目代號':   { to: 'account_code', required: true },
      '科目名稱':   { to: 'account_name' },
      '借方金額':   { to: 'debit', transform: Number },
      '貸方金額':   { to: 'credit', transform: Number },
      '摘要':       { to: 'description' },
      '部門':       { to: 'department' },
    },
    aliases: {
      '傳票號碼': '傳票編號', '會計科目': '科目代號', '科目': '科目代號',
      '借方': '借方金額', '貸方': '貸方金額', '說明': '摘要',
    },
  },
}

// ── Transform Helpers ──────────────────────────────────────

function parseDate(v) {
  if (!v) return null
  // Handle ROC year (民國) format: 113/01/15 or 113-01-15
  const rocMatch = v.match(/^(\d{2,3})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (rocMatch) {
    const year = parseInt(rocMatch[1], 10) + 1911
    const month = rocMatch[2].padStart(2, '0')
    const day = rocMatch[3].padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  // Handle standard ISO or slash format
  const d = new Date(v)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return v
}

// ── Row Mapping Engine ─────────────────────────────────────

/**
 * Apply a FIELD_MAP module to a single CSV row.
 * Returns { record, warnings[] }
 */
export function mapRow(row, moduleKey) {
  const mod = FIELD_MAPS[moduleKey]
  if (!mod) throw new Error(`Unknown module: ${moduleKey}`)

  const record = {}
  const warnings = []

  // Resolve aliases in the row first
  const resolved = {}
  for (const [key, val] of Object.entries(row)) {
    const canonical = mod.aliases?.[key] || key
    resolved[canonical] = val
  }

  for (const [header, spec] of Object.entries(mod.fields)) {
    let val = resolved[header]

    if ((val === undefined || val === '') && spec.default !== undefined) {
      val = spec.default
    }

    if ((val === undefined || val === '') && spec.required) {
      warnings.push(`缺少必填欄位: ${header}`)
      continue
    }

    if (val !== undefined && val !== '' && spec.transform) {
      const transformed = spec.transform(val)
      if (typeof transformed === 'number' && isNaN(transformed)) {
        warnings.push(`欄位 ${header} 數值無效: "${val}"`)
        continue
      }
      val = transformed
    }

    if (val !== undefined && val !== '') {
      record[spec.to] = val
    }
  }

  return { record, warnings }
}

/**
 * Map an entire CSV rows array. Returns { records[], errors[] }
 * where errors = [{ row: number, warnings: string[] }]
 */
export function mapCSV(rows, moduleKey) {
  const records = []
  const errors = []

  rows.forEach((row, i) => {
    const { record, warnings } = mapRow(row, moduleKey)
    if (warnings.length > 0) {
      errors.push({ row: i + 2, warnings }) // +2 for header + 0-index
    }
    if (Object.keys(record).length > 0) {
      records.push(record)
    }
  })

  return { records, errors }
}

/**
 * Auto-detect which module a CSV belongs to based on headers.
 */
export function detectModule(headers) {
  let bestMatch = null
  let bestScore = 0

  for (const [key, mod] of Object.entries(FIELD_MAPS)) {
    const allHeaders = new Set([
      ...Object.keys(mod.fields),
      ...Object.keys(mod.aliases || {}),
    ])
    const score = headers.filter(h => allHeaders.has(h.trim())).length
    if (score > bestScore) {
      bestScore = score
      bestMatch = key
    }
  }

  return bestScore >= 2 ? bestMatch : null
}

// ── API Connector ──────────────────────────────────────────

const DEFAULT_API_CONFIG = {
  baseUrl: '',
  apiKey: '',
  companyId: '',
}

/**
 * 文中 API client. Create with config, then call fetch methods.
 */
export class WenzhongAPI {
  constructor(config = {}) {
    this.config = { ...DEFAULT_API_CONFIG, ...config }
  }

  get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'X-Company-Id': this.config.companyId,
    }
  }

  async request(endpoint, params = {}) {
    const url = new URL(endpoint, this.config.baseUrl)
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    })

    const res = await fetch(url.toString(), { headers: this.headers })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`文中 API ${res.status}: ${text}`)
    }
    return res.json()
  }

  // ── Module-specific fetch methods ──

  async fetchProducts(params = {}) {
    const data = await this.request('/api/products', params)
    return (data.items || data).map(item => mapAPIRecord(item, 'products'))
  }

  async fetchCustomers(params = {}) {
    const data = await this.request('/api/customers', params)
    return (data.items || data).map(item => mapAPIRecord(item, 'customers'))
  }

  async fetchSuppliers(params = {}) {
    const data = await this.request('/api/suppliers', params)
    return (data.items || data).map(item => mapAPIRecord(item, 'suppliers'))
  }

  async fetchSales(params = {}) {
    const data = await this.request('/api/sales', {
      start_date: params.startDate,
      end_date: params.endDate,
      ...params,
    })
    return (data.items || data).map(item => mapAPIRecord(item, 'sales'))
  }

  async fetchInventory(params = {}) {
    const data = await this.request('/api/inventory', params)
    return (data.items || data).map(item => mapAPIRecord(item, 'inventory'))
  }

  async fetchJournalEntries(params = {}) {
    const data = await this.request('/api/journal', {
      start_date: params.startDate,
      end_date: params.endDate,
      ...params,
    })
    return (data.items || data).map(item => mapAPIRecord(item, 'journal'))
  }

  /** Test connection by fetching company info */
  async testConnection() {
    try {
      const data = await this.request('/api/company/info')
      return { ok: true, company: data.name || data.company_name || '連線成功' }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
}

// ── API Record Mapping ─────────────────────────────────────

/**
 * API responses use similar keys as CSV; reuse the same field map.
 */
function mapAPIRecord(apiObj, moduleKey) {
  const mod = FIELD_MAPS[moduleKey]
  if (!mod) return apiObj

  const record = {}
  // Build reverse lookup: all possible source keys → spec
  const lookup = {}
  for (const [header, spec] of Object.entries(mod.fields)) {
    lookup[header] = spec
  }
  for (const [alias, canonical] of Object.entries(mod.aliases || {})) {
    if (mod.fields[canonical]) lookup[alias] = mod.fields[canonical]
  }

  for (const [key, val] of Object.entries(apiObj)) {
    const spec = lookup[key]
    if (spec) {
      let v = val
      if (v != null && v !== '' && spec.transform) v = spec.transform(v)
      record[spec.to] = v
    }
  }

  return record
}

// ── Validation ─────────────────────────────────────────────

/**
 * Validate mapped records before import. Returns { valid[], invalid[] }
 */
export function validateRecords(records, moduleKey) {
  const mod = FIELD_MAPS[moduleKey]
  const requiredFields = Object.entries(mod.fields)
    .filter(([, spec]) => spec.required)
    .map(([, spec]) => spec.to)

  const valid = []
  const invalid = []

  records.forEach((rec, i) => {
    const missing = requiredFields.filter(f => !rec[f] && rec[f] !== 0)
    if (missing.length > 0) {
      invalid.push({ row: i + 1, record: rec, missing })
    } else {
      valid.push(rec)
    }
  })

  return { valid, invalid }
}

// ── Duplicate Detection ────────────────────────────────────

/**
 * Compare import records against existing data to flag duplicates.
 * Returns { newRecords[], duplicates[] }
 */
export function detectDuplicates(records, existing, keyField) {
  const existingKeys = new Set(existing.map(e => String(e[keyField] || '').toLowerCase()))
  const newRecords = []
  const duplicates = []

  records.forEach(rec => {
    const key = String(rec[keyField] || '').toLowerCase()
    if (key && existingKeys.has(key)) {
      duplicates.push(rec)
    } else {
      newRecords.push(rec)
    }
  })

  return { newRecords, duplicates }
}
