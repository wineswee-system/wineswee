/**
 * 電子發票常數（MIG 4.1）
 * 稅別代碼、載具類型、訊息別、Turnkey 連線設定
 */

/** 目前採用之 MIG 版本（2026-01-01 起大平台僅收 4.0+） */
export const MIG_VERSION = '4.1'

/** MIG namespace 前綴：urn:GEINV:eInvoiceMessage:{訊息別}:{版本} */
export const MIG_NAMESPACE_PREFIX = 'urn:GEINV:eInvoiceMessage'

/** 依訊息別產生 MIG 4.1 namespace */
export function migNamespace(messageType, version = MIG_VERSION) {
  return `${MIG_NAMESPACE_PREFIX}:${messageType}:${version}`
}

// Turnkey 連線設定結構（自建 Turnkey 為二期，目前僅供 legacy 3.2 函式使用）
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

/** 課稅別代碼：'1' 應稅 / '2' 零稅率 / '3' 免稅 */
export const TAX_TYPE_CODES = {
  '應稅': '1',
  '零稅率': '2',
  '免稅': '3',
}

/** 課稅別稅率 */
export const TAX_RATES = {
  '應稅': 0.05,
  '零稅率': 0,
  '免稅': 0,
}

/** 應稅稅率（加值型營業稅 5%） */
export const TAX_RATE = 0.05

/** 發票類別：'07' 一般稅額計算、'08' 特種稅額計算 */
export const INVOICE_TYPE_GENERAL = '07'

/** 財政部載具類別代碼 */
export const CARRIER_TYPES = {
  MOBILE_BARCODE: '3J0002', // 手機條碼載具（/ 開頭 + 7 碼）
  CITIZEN_CERT: 'CQ0001',   // 自然人憑證條碼（2 碼大寫英文 + 14 碼數字）
  EASYCARD: '1K0001',       // 悠遊卡
  IPASS: '1H0001',          // 一卡通
}

/** 折讓單類型：'1' 買方開立折讓證明單 / '2' 賣方開立折讓證明單 */
export const ALLOWANCE_TYPES = {
  BUYER_ISSUED: '1',
  SELLER_ISSUED: '2',
}

/**
 * MIG 4.1 訊息別總表
 * - B2C 存證（F 系列）：本期實作
 * - B2B 存證（C 系列）/ B2B 交換（A/B 系列）：4.1 第二階段（B2C 先行）
 * - 折讓（D 系列）：B2C/B2B 存證共用
 */
export const MESSAGE_TYPES = {
  B2C_STORE: { issue: 'F0401', cancel: 'F0501', void: 'F0701' },
  B2B_STORE: { issue: 'C0401', cancel: 'C0501', void: 'C0701' },
  B2B_EXCHANGE: { issue: 'A0101', cancel: 'A0201' },
  B2B_EXCHANGE_ALLOWANCE: { issue: 'B0101', cancel: 'B0201' },
  ALLOWANCE: { issue: 'D0401', cancel: 'D0501' },
}

/** B2C 無統編買受人之預設 Identifier */
export const B2C_BUYER_IDENTIFIER = '0000000000'
