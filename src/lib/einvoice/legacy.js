/**
 * MIG 3.2 產生器（LEGACY — 已被 MIG 4.1 取代）
 *
 * 2026-01-01 起大平台僅收 MIG 4.0+，新流程一律使用 `./mig41.js`。
 * 本檔保留舊格式輸出供既有頁面/測試相容，並待自建 Turnkey 二期評估後移除。
 */
import { TURNKEY_CONFIG } from './constants.js'
import { calculateInvoiceTax } from './tax.js'
import { escapeXml, formatMIGDate, formatMIGTime } from './xmlUtils.js'

/**
 * @deprecated MIG 3.2 — 新流程請改用 `buildF0401Xml`（MIG 4.1）
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
 * @deprecated MIG 3.2 — 新流程請改用 `buildF0401Xml`（MIG 4.1）
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
 * @deprecated 自訂 pipe 格式，未對齊財政部規範（F-B3 將正規化）
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
