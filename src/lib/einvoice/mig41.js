/**
 * MIG 4.1 XML 產生器（B2C 存證 + 折讓）
 *
 * 訊息別：
 *   F0401 開立發票、F0501 作廢發票、F0701 註銷發票
 *   D0401 開立折讓、D0501 作廢折讓
 * B2B（A/B/C 系列）列 4.1 第二階段，selectMessageType 已預留代碼。
 *
 * 所有 builder 欄位順序固定（陣列宣告即輸出順序），金額一律取整數
 * （四捨五入），TotalAmount = SalesAmount(+Free+Zero) + TaxAmount 恆成立。
 * 產出以官方 XSD 驗證為外部驗收（見計畫 4.4）。
 */
import {
  migNamespace,
  MESSAGE_TYPES,
  TAX_TYPE_CODES,
  TAX_RATE,
  INVOICE_TYPE_GENERAL,
  ALLOWANCE_TYPES,
  B2C_BUYER_IDENTIFIER,
} from './constants.js'
import { escapeXml, formatMIGDate, formatMIGTime, renderFields } from './xmlUtils.js'

/** 課稅別正規化：接受中文（'應稅'）或代碼（'1'） */
function normalizeTaxType(taxType) {
  if (taxType === '1' || taxType === '2' || taxType === '3') return taxType
  return TAX_TYPE_CODES[taxType] || '1'
}

/** 品項正規化（qty/quantity、unitPrice/unit_price 皆可），金額取整數 */
function normalizeItems(items) {
  return (items || []).map((it, i) => {
    const quantity = Number(it.quantity ?? it.qty ?? 1)
    const unitPrice = Number(it.unitPrice ?? it.unit_price ?? it.price ?? 0)
    const rawAmount = it.amount ?? it.line_total
    const amount = rawAmount !== undefined && rawAmount !== null
      ? Math.round(Number(rawAmount))
      : Math.round(quantity * unitPrice)
    return {
      description: it.description ?? it.product ?? it.name ?? '',
      quantity,
      unitPrice,
      amount,
      sequenceNumber: i + 1,
      tax: it.tax !== undefined ? Math.round(Number(it.tax)) : undefined,
      originalInvoiceNumber: it.originalInvoiceNumber ?? it.original_invoice_number,
      originalInvoiceDate: it.originalInvoiceDate ?? it.original_invoice_date,
      originalSequenceNumber: it.originalSequenceNumber ?? it.original_sequence_number,
    }
  })
}

/** 買賣方節點（欄位順序固定：Identifier → Name → Address） */
function renderParty(tag, party, { fallbackId = '', fallbackName = '' } = {}) {
  const id = party?.taxId ?? party?.identifier ?? fallbackId
  const name = party?.name ?? fallbackName
  const lines = [
    `    <${tag}>`,
    `      <Identifier>${escapeXml(id)}</Identifier>`,
    `      <Name>${escapeXml(name)}</Name>`,
  ]
  if (party?.address !== undefined && party?.address !== null) {
    lines.push(`      <Address>${escapeXml(party.address)}</Address>`)
  }
  lines.push(`    </${tag}>`)
  return lines.join('\n')
}

/**
 * F0401 開立發票（B2C 存證）
 * @param {Object} invoice
 *   {
 *     invoiceNumber, invoiceDate ('YYYY-MM-DD'|Date), invoiceTime ('HH:MM:SS' 可選),
 *     seller: { taxId, name, address? },
 *     buyer:  { taxId?, name? },          // B2C 無統編 → 0000000000 / 消費者
 *     items:  [{ description, quantity, unitPrice, amount? }],
 *     taxType: '應稅'|'零稅率'|'免稅'|'1'|'2'|'3',
 *     donateMark?: '0'|'1', printMark?: 'Y'|'N',
 *     carrierType?, carrierId1?, carrierId2?, npoban?, randomNumber?,
 *   }
 * @returns {string} MIG 4.1 F0401 XML
 */
export function buildF0401Xml(invoice) {
  const taxType = normalizeTaxType(invoice.taxType)
  const taxRate = taxType === '1' ? TAX_RATE : 0
  const items = normalizeItems(invoice.items)

  const lineSum = items.reduce((s, it) => s + it.amount, 0)
  // 依課稅別歸戶銷售額（MIG 4.1 Amount 區分應稅/免稅/零稅率）
  const salesAmount = taxType === '1' ? lineSum : 0
  const freeTaxSalesAmount = taxType === '3' ? lineSum : 0
  const zeroTaxSalesAmount = taxType === '2' ? lineSum : 0
  const taxAmount = invoice.taxAmount !== undefined && invoice.taxAmount !== null
    ? Math.round(Number(invoice.taxAmount))
    : Math.round(lineSum * taxRate)
  const totalAmount = lineSum + taxAmount

  const carrierType = invoice.carrierType ?? invoice.carrier_type ?? null
  const carrierId1 = invoice.carrierId1 ?? invoice.carrier_id ?? null
  const carrierId2 = invoice.carrierId2 ?? carrierId1

  const mainFields = renderFields([
    ['InvoiceNumber', invoice.invoiceNumber || invoice.invoice_number || ''],
    ['InvoiceDate', formatMIGDate(invoice.invoiceDate || invoice.invoice_date)],
    ['InvoiceTime', formatMIGTime(invoice.invoiceTime || invoice.invoiceDate || invoice.invoice_date)],
  ])

  const mainFields2 = renderFields([
    ['InvoiceType', invoice.invoiceType || INVOICE_TYPE_GENERAL],
    ['DonateMark', invoice.donateMark ?? '0'],
    ['CarrierType', carrierType],
    ['CarrierId1', carrierType ? (carrierId1 ?? '') : null],
    ['CarrierId2', carrierType ? (carrierId2 ?? '') : null],
    ['PrintMark', invoice.printMark ?? (carrierType ? 'N' : 'Y')],
    ['NPOBAN', invoice.npoban ?? null],             // 捐贈碼（DonateMark='1' 時必填）
    ['RandomNumber', invoice.randomNumber ?? null], // 4 位隨機碼
  ])

  const detailsXml = items.map((it) => `    <ProductItem>
${renderFields([
    ['Description', it.description],
    ['Quantity', it.quantity],
    ['UnitPrice', it.unitPrice],
    ['Amount', it.amount],
    ['SequenceNumber', it.sequenceNumber],
  ], '      ')}
    </ProductItem>`).join('\n')

  const amountFields = renderFields([
    ['SalesAmount', salesAmount],
    ['FreeTaxSalesAmount', freeTaxSalesAmount],
    ['ZeroTaxSalesAmount', zeroTaxSalesAmount],
    ['TaxType', taxType],
    ['TaxRate', taxType === '1' ? String(TAX_RATE) : '0'],
    ['TaxAmount', taxAmount],
    ['TotalAmount', totalAmount],
  ])

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="${migNamespace('F0401')}">
  <Main>
${mainFields}
${renderParty('Seller', invoice.seller)}
${renderParty('Buyer', invoice.buyer, { fallbackId: B2C_BUYER_IDENTIFIER, fallbackName: '消費者' })}
${mainFields2}
  </Main>
  <Details>
${detailsXml}
  </Details>
  <Amount>
${amountFields}
  </Amount>
</Invoice>`
}

/**
 * F0501 作廢發票（同日作廢）
 * @param {Object} p
 *   { invoiceNumber, invoiceDate, buyerId, sellerId, cancelDate, cancelTime?, cancelReason, remark? }
 * @returns {string}
 */
export function buildF0501Xml(p) {
  const fields = renderFields([
    ['CancelInvoiceNumber', p.invoiceNumber || p.cancelInvoiceNumber || ''],
    ['InvoiceDate', formatMIGDate(p.invoiceDate)],
    ['BuyerId', p.buyerId || B2C_BUYER_IDENTIFIER],
    ['SellerId', p.sellerId || ''],
    ['CancelDate', formatMIGDate(p.cancelDate)],
    ['CancelTime', formatMIGTime(p.cancelTime || p.cancelDate)],
    ['CancelReason', p.cancelReason || ''],
    ['Remark', p.remark ?? null],
  ], '  ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<CancelInvoice xmlns="${migNamespace('F0501')}">
${fields}
</CancelInvoice>`
}

/**
 * F0701 註銷發票（買賣方合意註銷 / 錯開更正）
 * @param {Object} p
 *   { invoiceNumber, invoiceDate, buyerId, sellerId, voidDate, voidTime?, voidReason, remark? }
 * @returns {string}
 */
export function buildF0701Xml(p) {
  const fields = renderFields([
    ['VoidInvoiceNumber', p.invoiceNumber || p.voidInvoiceNumber || ''],
    ['InvoiceDate', formatMIGDate(p.invoiceDate)],
    ['BuyerId', p.buyerId || B2C_BUYER_IDENTIFIER],
    ['SellerId', p.sellerId || ''],
    ['VoidDate', formatMIGDate(p.voidDate)],
    ['VoidTime', formatMIGTime(p.voidTime || p.voidDate)],
    ['VoidReason', p.voidReason || ''],
    ['Remark', p.remark ?? null],
  ], '  ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<VoidInvoice xmlns="${migNamespace('F0701')}">
${fields}
</VoidInvoice>`
}

/**
 * D0401 開立折讓（跨日退貨/折讓，逐行對回原發票）
 * @param {Object} allowance
 *   {
 *     allowanceNumber, allowanceDate ('YYYY-MM-DD'),
 *     seller: { taxId, name }, buyer: { taxId?, name? },
 *     allowanceType?: '1' 買方開立 | '2' 賣方開立（預設 '2'）,
 *     originalInvoiceNumber, originalInvoiceDate,   // 各 item 可覆寫
 *     taxType?: '應稅'|...,
 *     items: [{ description, quantity, unitPrice, amount?, tax?,
 *               originalInvoiceNumber?, originalInvoiceDate?, originalSequenceNumber? }],
 *   }
 * @returns {string}
 */
export function buildD0401Xml(allowance) {
  const taxType = normalizeTaxType(allowance.taxType)
  const taxRate = taxType === '1' ? TAX_RATE : 0
  const items = normalizeItems(allowance.items)

  const detailsXml = items.map((it) => {
    const tax = it.tax !== undefined ? it.tax : Math.round(it.amount * taxRate)
    return `    <AllowanceItem>
${renderFields([
      ['OriginalInvoiceDate', formatMIGDate(it.originalInvoiceDate || allowance.originalInvoiceDate)],
      ['OriginalInvoiceNumber', it.originalInvoiceNumber || allowance.originalInvoiceNumber || ''],
      ['OriginalSequenceNumber', it.originalSequenceNumber ?? it.sequenceNumber],
      ['OriginalDescription', it.description],
      ['Quantity', it.quantity],
      ['UnitPrice', it.unitPrice],
      ['Amount', it.amount],
      ['Tax', tax],
      ['AllowanceSequenceNumber', it.sequenceNumber],
      ['TaxType', taxType],
    ], '      ')}
    </AllowanceItem>`
  }).join('\n')

  const totalAmount = items.reduce((s, it) => s + it.amount, 0)
  const taxAmount = allowance.taxAmount !== undefined && allowance.taxAmount !== null
    ? Math.round(Number(allowance.taxAmount))
    : items.reduce((s, it) => s + (it.tax !== undefined ? it.tax : Math.round(it.amount * taxRate)), 0)

  const amountFields = renderFields([
    ['TaxAmount', taxAmount],
    ['TotalAmount', totalAmount],
  ])

  const mainFields = renderFields([
    ['AllowanceNumber', allowance.allowanceNumber || ''],
    ['AllowanceDate', formatMIGDate(allowance.allowanceDate)],
  ])

  return `<?xml version="1.0" encoding="UTF-8"?>
<Allowance xmlns="${migNamespace('D0401')}">
  <Main>
${mainFields}
${renderParty('Seller', allowance.seller)}
${renderParty('Buyer', allowance.buyer, { fallbackId: B2C_BUYER_IDENTIFIER, fallbackName: '消費者' })}
${renderFields([['AllowanceType', allowance.allowanceType || ALLOWANCE_TYPES.SELLER_ISSUED]])}
  </Main>
  <Details>
${detailsXml}
  </Details>
  <Amount>
${amountFields}
  </Amount>
</Allowance>`
}

/**
 * D0501 作廢折讓
 * @param {Object} p
 *   { allowanceNumber, allowanceDate, buyerId, sellerId, cancelDate, cancelTime?,
 *     cancelReason, originalInvoiceNumber?, remark? }
 * @returns {string}
 */
export function buildD0501Xml(p) {
  // 原發票號碼併入 Remark 供追溯（D0501 XSD 無獨立原發票欄位）
  // TODO(mig41-xsd)：官方 XSD 確認後如有對應欄位再搬移
  const remarkParts = []
  if (p.originalInvoiceNumber) remarkParts.push(`原發票號碼:${p.originalInvoiceNumber}`)
  if (p.remark) remarkParts.push(p.remark)
  const remark = remarkParts.length ? remarkParts.join(' ') : null

  const fields = renderFields([
    ['CancelAllowanceNumber', p.allowanceNumber || p.cancelAllowanceNumber || ''],
    ['AllowanceDate', formatMIGDate(p.allowanceDate)],
    ['BuyerId', p.buyerId || B2C_BUYER_IDENTIFIER],
    ['SellerId', p.sellerId || ''],
    ['CancelDate', formatMIGDate(p.cancelDate)],
    ['CancelTime', formatMIGTime(p.cancelTime || p.cancelDate)],
    ['CancelReason', p.cancelReason || ''],
    ['Remark', remark],
  ], '  ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<CancelAllowance xmlns="${migNamespace('D0501')}">
${fields}
</CancelAllowance>`
}

/**
 * 訊息別選擇（MIG-07）
 * @param {Object} opts
 * @param {'issue'|'cancel'|'void'|'allowance'|'cancelAllowance'} opts.action
 *   issue=開立, cancel=作廢, void=註銷, allowance=開立折讓, cancelAllowance=作廢折讓
 * @param {'b2c'|'b2b-storage'|'b2b-exchange'} [opts.channel='b2c']
 * @returns {string} 訊息別代碼（例 'F0401'）
 */
export function selectMessageType({ action, channel = 'b2c' }) {
  if (action === 'allowance' || action === 'cancelAllowance') {
    const key = action === 'allowance' ? 'issue' : 'cancel'
    // B2B 交換折讓走 B 系列；B2C / B2B 存證折讓共用 D 系列
    const table = channel === 'b2b-exchange' ? MESSAGE_TYPES.B2B_EXCHANGE_ALLOWANCE : MESSAGE_TYPES.ALLOWANCE
    const code = table[key]
    if (!code) throw new Error(`不支援的折讓動作：${action}（channel=${channel}）`)
    return code
  }

  const table = {
    'b2c': MESSAGE_TYPES.B2C_STORE,
    'b2b-storage': MESSAGE_TYPES.B2B_STORE,
    'b2b-exchange': MESSAGE_TYPES.B2B_EXCHANGE,
  }[channel]
  if (!table) throw new Error(`不支援的通路：${channel}`)

  const code = table[action]
  if (!code) throw new Error(`不支援的動作：${action}（channel=${channel}）`)
  return code
}

/**
 * 作廢 vs 折讓判斷：發票日 = 基準日（同日）→ 作廢(F0501)；跨日 → 折讓(D0401)
 * 與 void-invoice edge function 的 voidType 邏輯一致
 * @param {string|Date} invoiceDate
 * @param {string|Date} [asOfDate] - 預設今天
 * @returns {'cancel'|'allowance'}
 */
export function resolveVoidAction(invoiceDate, asOfDate = new Date()) {
  const a = formatMIGDate(invoiceDate)
  const b = formatMIGDate(asOfDate)
  return a === b ? 'cancel' : 'allowance'
}
