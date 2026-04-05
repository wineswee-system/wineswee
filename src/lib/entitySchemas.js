/**
 * 實體資料結構定義 (Entity Schemas)
 * 定義各模組實體的標準欄位，用於表單驗證、資料匯入/匯出
 * 補充原有 Supabase 資料表中缺少的欄位定義
 */

// ─── 傳票 (Journal Entry) ────────────────────────────────────

export const JOURNAL_ENTRY_FIELDS = {
  // 既有欄位
  id: { type: 'uuid', required: true, label: '傳��� ID' },
  entry_date: { type: 'date', required: true, label: '傳票日期' },
  description: { type: 'text', required: true, label: '摘要' },
  status: { type: 'enum', required: true, label: '狀態', values: ['草稿', '已過帳', '已作廢'] },
  posted_at: { type: 'datetime', required: false, label: '過帳時間' },

  // 新增欄位
  entry_number: { type: 'text', required: true, label: '傳票編號', auto: true, format: 'JE-YYYYMM-NNNN' },
  reference_number: { type: 'text', required: false, label: '來源單號', description: '關聯的發票/採購單/出貨單編號' },
  reference_type: { type: 'enum', required: false, label: '來源類型', values: ['invoice', 'po', 'shipment', 'payroll', 'depreciation', 'manual'] },
  reversal_of: { type: 'uuid', required: false, label: '沖銷對象', description: '被沖銷的傳票 ID' },
  reversed_by: { type: 'uuid', required: false, label: '沖銷傳票', description: '沖銷此傳票的新傳票 ID' },
  period: { type: 'text', required: true, label: '會計期間', format: 'YYYY-MM' },
  cost_center: { type: 'text', required: false, label: '成本中心' },
  approved_by: { type: 'uuid', required: false, label: '核准人' },
  approved_at: { type: 'datetime', required: false, label: '核准時間' },
  attachments: { type: 'json', required: false, label: '附件', description: '支援上傳佐證文件' },
  is_recurring: { type: 'boolean', required: false, label: '定期分錄', default: false },
  recurring_template_id: { type: 'uuid', required: false, label: '定期範本 ID' },
}

// ─── 採購單 (Purchase Order) ─────────────────────────────────

export const PURCHASE_ORDER_FIELDS = {
  // 既有欄位
  id: { type: 'uuid', required: true, label: '採購單 ID' },
  po_number: { type: 'text', required: true, label: '採購單號', auto: true },
  supplier: { type: 'text', required: true, label: '供應商' },
  supplier_id: { type: 'uuid', required: false, label: '供應商 ID' },
  total_amount: { type: 'number', required: true, label: '總金額' },
  line_items: { type: 'json', required: true, label: '品項明細' },
  status: { type: 'enum', required: true, label: '狀態', values: ['草稿', '待核准', '已核准', '已發送', '部分收貨', '已收貨', '已結案', '已取消'] },

  // 新增欄位
  version: { type: 'integer', required: true, label: '版本號', default: 1 },
  version_history: { type: 'json', required: false, label: '版本歷程' },
  payment_terms: { type: 'enum', required: true, label: '付款條件', values: ['COD', 'NET7', 'NET15', 'NET30', 'NET60', 'NET90'], default: 'NET30' },
  delivery_address: { type: 'text', required: false, label: '交貨地址' },
  incoterms: { type: 'enum', required: false, label: '貿易條件', values: ['EXW', 'FOB', 'CIF', 'DDP', 'DAP'] },
  approval_status: { type: 'enum', required: false, label: '核准狀態', values: ['pending', 'approved', 'rejected'] },
  approved_by: { type: 'uuid', required: false, label: '核准人' },
  approved_at: { type: 'datetime', required: false, label: '核准時間' },
  buyer_id: { type: 'uuid', required: false, label: '採購負責人' },
  currency: { type: 'text', required: true, label: '幣別', default: 'TWD' },
  exchange_rate: { type: 'number', required: false, label: '��率', default: 1 },
  expected_delivery_date: { type: 'date', required: false, label: '預計交貨日' },
  tax_amount: { type: 'number', required: false, label: '稅額' },
  shipping_cost: { type: 'number', required: false, label: '運費' },
  notes: { type: 'text', required: false, label: '備註' },
  hold_status: { type: 'enum', required: false, label: '���結狀態', values: [null, 'held', 'released'] },
  hold_reason: { type: 'text', required: false, label: '凍結原因' },
}

// 採購單品項欄位
export const PO_LINE_ITEM_FIELDS = {
  product: { type: 'text', required: true, label: '品項代碼' },
  product_name: { type: 'text', required: true, label: '品項名稱' },
  qty: { type: 'number', required: true, label: '訂購數量' },
  unit_price: { type: 'number', required: true, label: '單價' },
  unit: { type: 'text', required: false, label: '單位', default: 'pcs' },
  tax_code: { type: 'enum', required: false, label: '稅碼', values: ['T5', 'T0', 'TX'], default: 'T5', description: 'T5=應稅5%, T0=零稅率, TX=免稅' },
  expected_date: { type: 'date', required: false, label: '預計交貨日' },
  received_qty: { type: 'number', required: false, label: '已收數量', default: 0 },
  remaining_qty: { type: 'number', required: false, label: '未收數量' },
}

// ─── 銷售單 (Sales Order) ───────��────────────────────────────

export const SALES_ORDER_FIELDS = {
  // 既有欄位
  id: { type: 'uuid', required: true, label: '銷售單 ID' },
  so_number: { type: 'text', required: true, label: '銷售單號', auto: true },
  customer_id: { type: 'uuid', required: true, label: '客戶 ID' },
  customer_name: { type: 'text', required: true, label: '客戶名稱' },
  total_amount: { type: 'number', required: true, label: '總金額' },
  line_items: { type: 'json', required: true, label: '品項明細' },
  status: { type: 'enum', required: true, label: '狀態', values: ['草稿', '已確認', '部分出貨', '已出貨', '已開立發票', '已結案', '已取消'] },

  // 新增欄位
  quote_id: { type: 'uuid', required: false, label: '報價單 ID', description: '轉換來源的報價單' },
  shipping_method: { type: 'enum', required: false, label: '運送方式', values: ['self_pickup', '7-11', 'familymart', 'hct', 'sf_express', 'post', 'other'] },
  shipping_address: { type: 'text', required: false, label: '送貨地址' },
  promised_delivery_date: { type: 'date', required: false, label: '承諾交期' },
  credit_status: { type: 'enum', required: false, label: '信用狀態', values: ['within_limit', 'over_limit', 'approved_override'], default: 'within_limit' },
  credit_approved_by: { type: 'uuid', required: false, label: '信用核准人' },
  sales_rep_id: { type: 'uuid', required: false, label: '業務負責人' },
  commission_rate: { type: 'number', required: false, label: '佣金率 (%)' },
  payment_terms: { type: 'enum', required: true, label: '付款條件', values: ['COD', 'NET7', 'NET15', 'NET30', 'NET60'], default: 'NET30' },
  discount_code: { type: 'text', required: false, label: '折扣碼' },
  order_discount: { type: 'number', required: false, label: '訂單折扣金額' },
  tax_amount: { type: 'number', required: false, label: '稅額' },
  currency: { type: 'text', required: true, label: '幣別', default: 'TWD' },
  notes: { type: 'text', required: false, label: '���註' },
  terms_conditions: { type: 'text', required: false, label: '條款與條件' },
}

// 銷售單品項欄位
export const SO_LINE_ITEM_FIELDS = {
  sku: { type: 'text', required: true, label: 'SKU' },
  product_name: { type: 'text', required: true, label: '品名' },
  qty: { type: 'number', required: true, label: '訂購數量' },
  unit_price: { type: 'number', required: true, label: '單價' },
  discount_percent: { type: 'number', required: false, label: '折扣 (%)', default: 0 },
  discount_amount: { type: 'number', required: false, label: '折扣金額', default: 0 },
  tax_code: { type: 'enum', required: false, label: '稅碼', values: ['T5', 'T0', 'TX'], default: 'T5' },
  shipped_qty: { type: 'number', required: false, label: '已出貨數量', default: 0 },
  remaining_qty: { type: 'number', required: false, label: '未出貨數量' },
  backorder_qty: { type: 'number', required: false, label: '欠品數量', default: 0 },
  promised_date: { type: 'date', required: false, label: '承諾交期' },
}

// ─── 員工 (Employee) ───────────────���─────────────────────────

export const EMPLOYEE_FIELDS = {
  // 既有欄位
  id: { type: 'uuid', required: true, label: '員工 ID' },
  name: { type: 'text', required: true, label: '姓名' },
  employee_id: { type: 'text', required: true, label: '員工編號' },
  department: { type: 'text', required: true, label: '部門' },
  position: { type: 'text', required: true, label: '職位' },
  hire_date: { type: 'date', required: true, label: '到職日' },
  salary: { type: 'number', required: true, label: '月薪' },
  email: { type: 'text', required: false, label: '電子郵件' },
  phone: { type: 'text', required: false, label: '電話' },
  status: { type: 'enum', required: true, label: '狀態', values: ['在職', '離職', '留職停薪', '試用期'] },

  // 新增欄位
  id_number: { type: 'text', required: true, label: '身分證字號', masked: true },
  birth_date: { type: 'date', required: false, label: '出生日期' },
  gender: { type: 'enum', required: false, label: '性別', values: ['M', 'F', 'O'] },
  nationality: { type: 'text', required: false, label: '國籍', default: 'TW' },
  address: { type: 'text', required: false, label: '戶籍地址' },
  mailing_address: { type: 'text', required: false, label: '通訊地址' },

  // 緊急聯絡人
  emergency_contact_name: { type: 'text', required: true, label: '緊急聯絡人姓名' },
  emergency_contact_phone: { type: 'text', required: true, label: '緊急聯絡人電話' },
  emergency_contact_relation: { type: 'text', required: false, label: '與本人關係' },

  // 薪轉帳戶
  bank_code: { type: 'text', required: false, label: '銀行代碼' },
  bank_name: { type: 'text', required: false, label: '銀行名稱' },
  bank_account: { type: 'text', required: false, label: '帳號', masked: true },

  // 合約資訊
  contract_type: { type: 'enum', required: true, label: '合約類型', values: ['full_time', 'part_time', 'contract', 'intern', 'dispatched'], default: 'full_time' },
  contract_end_date: { type: 'date', required: false, label: '合約到期日' },
  probation_end_date: { type: 'date', required: false, label: '試用期結束日' },
  probation_passed: { type: 'boolean', required: false, label: '試用期通過' },

  // 外籍勞工
  work_permit_number: { type: 'text', required: false, label: '工作證號碼' },
  arc_number: { type: 'text', required: false, label: '居留證號碼' },
  arc_expiry: { type: 'date', required: false, label: '居留證到期日' },

  // 保險相關
  labor_insurance_grade: { type: 'number', required: false, label: '勞保投保級距' },
  health_insurance_grade: { type: 'number', required: false, label: '健保投保級距' },
  dependents_count: { type: 'integer', required: false, label: '健保眷屬人數', default: 0, max: 3 },

  // 學歷/技能
  education: { type: 'enum', required: false, label: '最高學歷', values: ['高中', '專科', '學士', '碩士', '博士'] },
  education_school: { type: 'text', required: false, label: '畢業學校' },
  certifications: { type: 'json', required: false, label: '證照', description: '[{name, issuer, expiry_date}]' },

  // 離職資訊
  termination_date: { type: 'date', required: false, label: '離職日' },
  termination_reason: { type: 'text', required: false, label: '離職原因' },
  final_settlement_date: { type: 'date', required: false, label: '結算日' },
}

// ─── 庫存品項 (SKU Master) ────────��──────────────────────────

export const SKU_FIELDS = {
  // 既有欄位
  id: { type: 'uuid', required: true, label: 'SKU ID' },
  sku_code: { type: 'text', required: true, label: 'SKU 代碼' },
  sku_name: { type: 'text', required: true, label: '品名' },
  barcode: { type: 'text', required: false, label: '條碼' },
  unit: { type: 'text', required: true, label: '基本單位', default: 'pcs' },
  cost: { type: 'number', required: false, label: '標準成本' },
  price: { type: 'number', required: false, label: '建議售價' },

  // 新增欄位
  category: { type: 'text', required: false, label: '分類' },
  sub_category: { type: 'text', required: false, label: '子分類' },
  abc_class: { type: 'enum', required: false, label: 'ABC 分級', values: ['A', 'B', 'C'] },
  description: { type: 'text', required: false, label: '品項說明' },

  // 庫存控制
  reorder_point: { type: 'number', required: false, label: '再訂購點' },
  reorder_qty: { type: 'number', required: false, label: '再訂購量' },
  min_stock: { type: 'number', required: false, label: '最低庫存量' },
  max_stock: { type: 'number', required: false, label: '最高庫存量' },
  safety_stock: { type: 'number', required: false, label: '安全庫存量' },
  lead_time_days: { type: 'integer', required: false, label: '前置天數' },

  // 物流資訊
  weight_kg: { type: 'number', required: false, label: '重量 (kg)' },
  length_cm: { type: 'number', required: false, label: '長 (cm)' },
  width_cm: { type: 'number', required: false, label: '寬 (cm)' },
  height_cm: { type: 'number', required: false, label: '高 (cm)' },
  volume_cbm: { type: 'number', required: false, label: '體積 (CBM)' },

  // 保存期限
  shelf_life_days: { type: 'integer', required: false, label: '保存天數' },
  requires_lot_tracking: { type: 'boolean', required: false, label: '需批號追蹤', default: false },
  requires_serial_tracking: { type: 'boolean', required: false, label: '需序號追���', default: false },

  // 供應商
  default_supplier_id: { type: 'uuid', required: false, label: '預設供應商' },
  supplier_sku: { type: 'text', required: false, label: '供應商料號' },
  moq: { type: 'number', required: false, label: '最低訂購量 (MOQ)' },

  // 單位換算
  uom_conversions: { type: 'json', required: false, label: '單位換算', description: '[{from, to, factor}]' },

  // 成本計算
  costing_method: { type: 'enum', required: false, label: '成本計算方法', values: ['fifo', 'lifo', 'weighted_avg', 'moving_avg'], default: 'weighted_avg' },

  // 狀態
  is_active: { type: 'boolean', required: true, label: '啟用', default: true },
  is_purchasable: { type: 'boolean', required: true, label: '可採購', default: true },
  is_saleable: { type: 'boolean', required: true, label: '可銷售', default: true },
  is_manufactured: { type: 'boolean', required: false, label: '自製品', default: false },
}

// ─── 客戶 (Customer) ─────────────────────────────────────────

export const CUSTOMER_FIELDS = {
  id: { type: 'uuid', required: true, label: '客戶 ID' },
  customer_code: { type: 'text', required: true, label: '客戶編號' },
  company_name: { type: 'text', required: true, label: '公司名稱' },
  tax_id: { type: 'text', required: false, label: '統一編號' },
  contact_name: { type: 'text', required: false, label: '聯絡人' },
  phone: { type: 'text', required: false, label: '電話' },
  email: { type: 'text', required: false, label: '電子郵件' },
  address: { type: 'text', required: false, label: '地址' },
  shipping_address: { type: 'text', required: false, label: '送貨地址' },

  // 信用管理
  credit_limit: { type: 'number', required: false, label: '信用額度', default: 0 },
  credit_tier: { type: 'enum', required: false, label: '信用等級', values: ['A', 'B', 'C', 'D'] },
  payment_terms: { type: 'enum', required: false, label: '付款條件', values: ['COD', 'NET7', 'NET15', 'NET30', 'NET60'] },

  // CRM
  loyalty_tier: { type: 'enum', required: false, label: '會員等級', values: ['一般', '白銀', '黃金', '鑽石'] },
  loyalty_points: { type: 'number', required: false, label: '累計點數', default: 0 },
  assigned_rep_id: { type: 'uuid', required: false, label: '負責業務' },
  industry: { type: 'text', required: false, label: '產業別' },
  source: { type: 'text', required: false, label: '客戶來源' },

  is_active: { type: 'boolean', required: true, label: '啟用', default: true },
}

// ─── 供應商 (Vendor/Supplier) ──────��─────────────────────────

export const VENDOR_FIELDS = {
  id: { type: 'uuid', required: true, label: '供應商 ID' },
  vendor_code: { type: 'text', required: true, label: '供應商編號' },
  company_name: { type: 'text', required: true, label: '公司名稱' },
  tax_id: { type: 'text', required: false, label: '統一編號' },
  contact_name: { type: 'text', required: false, label: '聯絡人' },
  phone: { type: 'text', required: false, label: '電話' },
  email: { type: 'text', required: false, label: '電子郵件' },
  address: { type: 'text', required: false, label: '地址' },

  // 採購管理
  payment_terms: { type: 'enum', required: false, label: '付款條件', values: ['COD', 'NET7', 'NET15', 'NET30', 'NET60', 'NET90'] },
  currency: { type: 'text', required: false, label: '交易幣別', default: 'TWD' },
  lead_time_days: { type: 'integer', required: false, label: '交貨天數' },

  // 評鑑
  vendor_rating: { type: 'enum', required: false, label: '評等', values: ['A', 'B', 'C', 'D', 'F'] },
  vendor_score: { type: 'number', required: false, label: '評分 (0-100)' },
  last_evaluation_date: { type: 'date', required: false, label: '最近評鑑日' },

  // 銀行資訊
  bank_code: { type: 'text', required: false, label: '銀行代碼' },
  bank_account: { type: 'text', required: false, label: '銀行帳號', masked: true },

  is_active: { type: 'boolean', required: true, label: '啟用', default: true },
  is_approved: { type: 'boolean', required: false, label: '已核准', default: false },
}

// ─── 欄位驗證工具 ──────��─────────────────────────────────────

/**
 * 驗證實體資料是否符合 Schema 定義
 * @param {object} data — 待驗證的資料
 * @param {object} schema — 欄位定義（如 EMPLOYEE_FIELDS）
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEntity(data, schema) {
  const errors = []

  for (const [field, def] of Object.entries(schema)) {
    const value = data[field]

    // 必填檢查
    if (def.required && (value === undefined || value === null || value === '')) {
      errors.push(`${def.label}（${field}）為必填欄位`)
      continue
    }

    if (value === undefined || value === null) continue

    // 型別檢查
    if (def.type === 'number' && typeof value !== 'number') {
      errors.push(`${def.label}（${field}）必須為數字`)
    }
    if (def.type === 'integer' && (!Number.isInteger(value))) {
      errors.push(`${def.label}（${field}）必須為整數`)
    }
    if (def.type === 'enum' && def.values && !def.values.includes(value)) {
      errors.push(`${def.label}（${field}）值 "${value}" 不在允許範圍: ${def.values.join(', ')}`)
    }
    if (def.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`${def.label}（${field}）日期格式應為 YYYY-MM-DD`)
    }
    if (def.max !== undefined && value > def.max) {
      errors.push(`${def.label}（${field}）不可超過 ${def.max}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 取得 Schema 中的必填欄位列表
 * @param {object} schema — 欄位定義
 * @returns {string[]} 必填欄位名稱
 */
export function getRequiredFields(schema) {
  return Object.entries(schema)
    .filter(([, def]) => def.required)
    .map(([field]) => field)
}

/**
 * 取得 Schema 中新增的欄位（非基本欄位）
 * @param {object} schema — 欄位定義
 * @returns {Array<{field: string, label: string, type: string}>}
 */
export function getEnhancedFields(schema) {
  return Object.entries(schema).map(([field, def]) => ({
    field,
    label: def.label,
    type: def.type,
    required: def.required,
  }))
}
