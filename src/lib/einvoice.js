/**
 * 電子發票模組 (E-Invoice)
 * 符合財政部電子發票整合服務平台 (Turnkey) 規格
 * 支援：MIG 格式 XML 產生、統一編號驗證、字軌號碼產生、稅額計算
 */

// Turnkey 連線設定結構
export const TURNKEY_CONFIG = {
  // TODO: 正式環境請替換為實際的 Turnkey 端點
  endpoint: 'https://www-vc.einvoice.nat.gov.tw',       // 驗證環境
  productionEndpoint: 'https://www.einvoice.nat.gov.tw', // 正式環境
  appId: '',          // 財政部核發之 AppID
  apiKey: '',         // API Key
  sellerId: '',       // 營業人統一編號
  sellerName: '',     // 營業人名稱
  certificatePath: '', // 憑證路徑
  isProduction: false,
}

/**
 * 驗證統一編號（8 碼檢查）
 * 使用加權運算法驗證統一編號是否合法
 * @param {string} taxId - 統一編號
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTaxId(taxId) {
  if (!taxId || typeof taxId !== 'string') {
    return { valid: false, error: '統一編號不得為空' }
  }

  const cleaned = taxId.trim()
  if (!/^\d{8}$/.test(cleaned)) {
    return { valid: false, error: '統一編號必須為 8 位數字' }
  }

  // 加權因子
  const weights = [1, 2, 1, 2, 1, 2, 4, 1]
  const digits = cleaned.split('').map(Number)

  let sum = 0
  for (let i = 0; i < 8; i++) {
    const product = digits[i] * weights[i]
    // 若乘積 >= 10，十位數與個位數相加
    sum += Math.floor(product / 10) + (product % 10)
  }

  // 統一編號第 7 碼為 7 時有特殊規則
  if (sum % 5 === 0) return { valid: true }
  if (digits[6] === 7 && (sum + 1) % 5 === 0) return { valid: true }

  return { valid: false, error: '統一編號驗證碼不正確' }
}

/**
 * 產生發票號碼（字軌規則）
 * 格式：2 個大寫英文字母 + 8 位數字，例如 AB-12345678
 * @param {string} prefix   - 字軌前綴（2 碼英文），例如 'AB'
 * @param {number} sequence - 流水號
 * @returns {string} 發票號碼，例如 'AB12345678'
 */
export function generateInvoiceNumber(prefix, sequence) {
  if (!prefix || prefix.length !== 2 || !/^[A-Z]{2}$/.test(prefix)) {
    throw new Error('字軌必須為 2 碼大寫英文字母')
  }
  if (sequence < 0 || sequence > 99999999) {
    throw new Error('流水號必須介於 0 ~ 99999999')
  }
  const seq = String(sequence).padStart(8, '0')
  return `${prefix}${seq}`
}

/**
 * 計算發票稅額
 * @param {Array} items   - 品項 [{description, qty, unitPrice}]
 * @param {string} taxType - '應稅' | '零稅率' | '免稅'
 * @returns {{ subtotal: number, taxAmount: number, total: number, taxRate: number, items_with_tax: Array }}
 */
export function calculateInvoiceTax(items, taxType = '應稅') {
  const taxRates = {
    '應稅': 0.05,
    '零稅率': 0,
    '免稅': 0,
  }
  const taxRate = taxRates[taxType] ?? 0.05

  let subtotal = 0
  const items_with_tax = items.map(item => {
    const amount = Math.round(item.qty * item.unitPrice)
    const tax = Math.round(amount * taxRate)
    subtotal += amount
    return {
      description: item.description,
      qty: item.qty,
      unit_price: item.unitPrice,
      amount,
      tax,
    }
  })

  const taxAmount = Math.round(subtotal * taxRate)
  const total = subtotal + taxAmount

  return { subtotal, taxAmount, total, taxRate, items_with_tax }
}

/**
 * 格式化載具條碼資訊
 * @param {string} type  - 載具類型: 'phone_barcode'(手機條碼), 'natural_person'(自然人憑證), 'company'(公司統編)
 * @param {string} value - 載具值
 * @returns {{ type: string, typeName: string, value: string, display: string }}
 */
export function formatCarrierBarcode(type, value) {
  const typeMap = {
    phone_barcode: { typeName: '手機條碼', prefix: '/' },
    natural_person: { typeName: '自然人憑證', prefix: '' },
    company: { typeName: '公司統編載具', prefix: '' },
  }

  const config = typeMap[type]
  if (!config) {
    return { type, typeName: '未知載具', value, display: value }
  }

  const display = config.prefix && !value.startsWith(config.prefix)
    ? `${config.prefix}${value}`
    : value

  return {
    type,
    typeName: config.typeName,
    value,
    display,
  }
}

/**
 * 產生 MIG 格式 XML（財政部 Turnkey 用）
 * @param {Object} invoice - 發票資料
 *   { invoiceNumber, date, seller: {taxId, name}, buyer: {taxId, name},
 *     items: [{description, qty, unitPrice}], taxType }
 * @param {Object} [config] - Turnkey 設定
 * @returns {string} XML 字串
 */
export function generateEInvoiceXML(invoice, config = TURNKEY_CONFIG) {
  const { subtotal, taxAmount, total, items_with_tax } = calculateInvoiceTax(
    invoice.items,
    invoice.taxType || '應稅'
  )

  const taxTypeCode = {
    '應稅': '1',
    '零稅率': '2',
    '免稅': '3',
  }[invoice.taxType || '應稅'] || '1'

  // 日期格式化 YYYYMMDD
  const dateStr = (invoice.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '')

  // TODO: 正式環境需加入數位簽章
  const itemsXML = items_with_tax.map((item, idx) => `
    <InvoiceItem>
      <Description>${escapeXml(item.description)}</Description>
      <Quantity>${item.qty}</Quantity>
      <UnitPrice>${item.unit_price}</UnitPrice>
      <Amount>${item.amount}</Amount>
      <SequenceNumber>${idx + 1}</SequenceNumber>
      <TaxType>${taxTypeCode}</TaxType>
    </InvoiceItem>`).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:GEINV:eInvoiceMessage:C0401:3.2">
  <Main>
    <InvoiceNumber>${escapeXml(invoice.invoiceNumber || '')}</InvoiceNumber>
    <InvoiceDate>${dateStr}</InvoiceDate>
    <InvoiceTime>${new Date().toTimeString().slice(0, 8)}</InvoiceTime>
    <Seller>
      <Identifier>${escapeXml(invoice.seller?.taxId || config.sellerId || '')}</Identifier>
      <Name>${escapeXml(invoice.seller?.name || config.sellerName || '')}</Name>
    </Seller>
    <Buyer>
      <Identifier>${escapeXml(invoice.buyer?.taxId || '')}</Identifier>
      <Name>${escapeXml(invoice.buyer?.name || '')}</Name>
    </Buyer>
    <InvoiceType>07</InvoiceType>
    <DonateMark>0</DonateMark>
    <TaxType>${taxTypeCode}</TaxType>
    <TaxRate>${invoice.taxType === '應稅' || !invoice.taxType ? '0.05' : '0'}</TaxRate>
  </Main>
  <Details>${itemsXML}
  </Details>
  <Amount>
    <SalesAmount>${subtotal}</SalesAmount>
    <TaxAmount>${taxAmount}</TaxAmount>
    <TotalAmount>${total}</TotalAmount>
  </Amount>
</Invoice>`

  return xml
}

/**
 * 驗證發票號碼格式（2 碼大寫英文 + 8 位數字）
 * @param {string} num - 發票號碼，例如 'AB12345678' 或 'AB-12345678'
 * @returns {boolean}
 */
export function validateInvoiceNumber(num) {
  if (!num) return false
  return /^[A-Z]{2}-?\d{8}$/.test(num.trim())
}

/**
 * 產生 MIG 3.2 格式 XML（供 Turnkey 上傳用，C0401 開立發票）
 * @param {Object} invoice - 發票資料
 *   { invoice_number, invoice_date|date, buyer_name, buyer_tax_id, carrier_type, carrier_id,
 *     items|lines: [{description|product, quantity|qty, unit_price, line_total}],
 *     total|amount, tax_type }
 * @param {Object} seller  - 賣方 { taxId, name, address }
 * @param {Object} buyer   - 買方 { taxId, name } (可選，會從 invoice 取值)
 * @returns {string} MIG XML 字串
 */
export function generateMIGXml(invoice, seller = {}, buyer = {}) {
  const lines = invoice.lines || invoice.items || []
  const parsedLines = typeof lines === 'string' ? JSON.parse(lines) : lines

  const itemsXml = parsedLines.map((line, i) => {
    const desc = line.description || line.product || line.name || ''
    const qty = line.quantity || line.qty || 1
    const price = line.unit_price || line.unitPrice || line.price || 0
    const amount = line.line_total || line.amount || Math.round(qty * price)
    return `
    <ProductItem>
      <Description>${escapeXml(desc)}</Description>
      <Quantity>${qty}</Quantity>
      <UnitPrice>${price}</UnitPrice>
      <Amount>${amount}</Amount>
      <SequenceNumber>${i + 1}</SequenceNumber>
    </ProductItem>`
  }).join('')

  const taxTypeMap = { '應稅': '1', '零稅率': '2', '免稅': '3' }
  const taxType = taxTypeMap[invoice.tax_type] || '1'
  const totalAmount = invoice.total || invoice.amount || 0
  const salesAmount = taxType === '1' ? Math.round(totalAmount / 1.05) : totalAmount
  const taxAmount = totalAmount - salesAmount

  const invDate = invoice.invoice_date || invoice.date || new Date().toISOString().slice(0, 10)
  const dateStr = formatMIGDate(invDate)
  const timeStr = formatMIGTime(invDate)

  const buyerTaxId = buyer?.taxId || invoice.buyer_tax_id || '0000000000'
  const buyerName = buyer?.name || invoice.buyer_name || '一般消費者'

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:GEINV:eInvoiceMessage:C0401:3.2">
  <Main>
    <InvoiceNumber>${escapeXml(invoice.invoice_number || '')}</InvoiceNumber>
    <InvoiceDate>${dateStr}</InvoiceDate>
    <InvoiceTime>${timeStr}</InvoiceTime>
    <Seller>
      <Identifier>${escapeXml(seller?.taxId || TURNKEY_CONFIG.sellerId || '')}</Identifier>
      <Name>${escapeXml(seller?.name || TURNKEY_CONFIG.sellerName || '')}</Name>
      <Address>${escapeXml(seller?.address || '')}</Address>
    </Seller>
    <Buyer>
      <Identifier>${escapeXml(buyerTaxId)}</Identifier>
      <Name>${escapeXml(buyerName)}</Name>
    </Buyer>
    <InvoiceType>07</InvoiceType>
    <DonateMark>0</DonateMark>
    <CarrierType>${escapeXml(invoice.carrier_type || '')}</CarrierType>
    <CarrierId1>${escapeXml(invoice.carrier_id || invoice.carrier_value || '')}</CarrierId1>
  </Main>
  <Details>${itemsXml}
  </Details>
  <Amount>
    <SalesAmount>${salesAmount}</SalesAmount>
    <TaxType>${taxType}</TaxType>
    <TaxRate>${taxType === '1' ? '0.05' : '0'}</TaxRate>
    <TaxAmount>${taxAmount}</TaxAmount>
    <TotalAmount>${totalAmount}</TotalAmount>
  </Amount>
</Invoice>`
}

/**
 * 產生 Turnkey 批次上傳格式（pipe-delimited）
 * H = Header, D = Detail
 * @param {Array} invoices - 發票陣列
 * @param {Object} seller  - 賣方 { taxId, name }
 * @returns {string} Turnkey 批次格式字串
 */
export function generateTurnkeyBatch(invoices, seller = {}) {
  const outputLines = []
  const sellerId = seller?.taxId || TURNKEY_CONFIG.sellerId || ''

  invoices.forEach(inv => {
    const totalAmount = inv.total || inv.amount || 0
    const salesAmt = Math.round(totalAmount / 1.05)
    const taxAmt = totalAmount - salesAmt
    const dateStr = formatMIGDate(inv.invoice_date || inv.date || '')

    // Header line
    outputLines.push(
      `H|${inv.invoice_number || ''}|${dateStr}|${sellerId}|${inv.buyer_tax_id || '0000000000'}|${salesAmt}|1|0.05|${taxAmt}|${totalAmount}`
    )

    // Detail lines
    const lines = inv.lines || inv.items || []
    const parsedLines = typeof lines === 'string' ? JSON.parse(lines) : lines
    const detailItems = parsedLines.length > 0
      ? parsedLines
      : [{ description: inv.description || '商品', quantity: 1, unit_price: totalAmount, line_total: totalAmount }]

    detailItems.forEach((item, i) => {
      const desc = item.description || item.product || item.name || '商品'
      const qty = item.quantity || item.qty || 1
      const price = item.unit_price || item.unitPrice || item.price || 0
      const amount = item.line_total || item.amount || Math.round(qty * price)
      outputLines.push(`D|${inv.invoice_number || ''}|${i + 1}|${desc}|${qty}|${price}|${amount}`)
    })
  })

  return outputLines.join('\n')
}

// ── Helper functions ──

/**
 * XML 特殊字元轉義
 */
function escapeXml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 格式化日期為 MIG 格式 YYYYMMDD
 */
function formatMIGDate(d) {
  if (!d) {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  }
  // Handle ISO string or date string
  const date = new Date(d)
  if (isNaN(date.getTime())) {
    // Try as YYYY-MM-DD string
    return String(d).replace(/-/g, '').slice(0, 8)
  }
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 格式化時間為 HH:MM:SS
 */
function formatMIGTime(d) {
  const date = new Date(d)
  if (isNaN(date.getTime())) return new Date().toTimeString().slice(0, 8)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}
