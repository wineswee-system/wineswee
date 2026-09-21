// e首發票（e-First）加值中心共用 client
//
// 官方 API 文件尚未到位（外部依賴：e首發票合約/金鑰，見 PLAN F-B1）。
// 本檔先以「內部契約」定型：payload builder 產出固定形狀，HTTP 呼叫隔離於
// callEfirst()（timeout + 錯誤正規化）。文件到位後只需調整欄位名稱對應
// （搜尋 TODO(efirst-mapping)），呼叫端（issue-invoice / void-invoice）不動。
//
// env（Supabase edge secrets）：
//   EFIRST_API_KEY   — API 金鑰
//   EFIRST_SELLER_ID — 營業人統一編號
//   EFIRST_ENDPOINT  — API base URL（不含尾斜線）

export interface EfirstConfig {
  endpoint: string
  apiKey: string
  sellerId: string
}

/** 讀取 e首發票環境設定；缺任一項回傳 null（呼叫端回 501） */
export function getEfirstConfig(): EfirstConfig | null {
  const apiKey = Deno.env.get('EFIRST_API_KEY')
  const sellerId = Deno.env.get('EFIRST_SELLER_ID')
  const endpoint = Deno.env.get('EFIRST_ENDPOINT')
  if (!apiKey || !sellerId || !endpoint) return null
  return { apiKey, sellerId, endpoint: endpoint.replace(/\/+$/, '') }
}

export interface EfirstItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

/** B2C 開立（F0401 對應） */
export interface EfirstIssuePayload {
  action: 'issue'
  sellerId: string
  relateNumber: string        // 冪等鍵（pos_payments.id）— 重試不重號
  invoiceNumber: string       // 由 allocate_invoice_number RPC 配出（AB12345678）
  invoiceDate: string         // YYYY-MM-DD
  buyerId: string             // 統編；B2C 無統編 = '0000000000'
  buyerName: string
  carrierType: string | null  // '3J0002' 手機條碼等；null = 無載具（列印）
  carrierId: string | null
  donateMark: '0' | '1'
  printMark: 'Y' | 'N'
  taxType: '1' | '2' | '3'    // 1 應稅 / 2 零稅率 / 3 免稅
  taxRate: number             // 應稅 0.05
  salesAmount: number         // 整數（未稅）
  taxAmount: number
  totalAmount: number
  items: EfirstItem[]
}

/** 同日作廢（F0501 對應） */
export interface EfirstVoidPayload {
  action: 'void'
  sellerId: string
  relateNumber: string
  invoiceNumber: string       // 原發票號碼
  invoiceDate: string         // 原發票日期 YYYY-MM-DD
  voidDate: string            // 作廢日期 YYYY-MM-DD
  reason: string
}

/** 跨日折讓（D0401 對應） */
export interface EfirstAllowancePayload {
  action: 'allowance'
  sellerId: string
  relateNumber: string             // 冪等鍵（`${paymentId}:allowance`）
  originalInvoiceNumber: string    // 原發票號碼
  originalInvoiceDate: string      // 原發票日期 YYYY-MM-DD
  allowanceDate: string            // 折讓日期 YYYY-MM-DD
  buyerId: string
  taxAmount: number
  totalAmount: number              // 折讓金額（未稅）
  items: EfirstItem[]
  reason: string
}

export interface EfirstCallResult {
  ok: boolean
  status: number                          // HTTP status；0 = 網路層失敗/逾時
  data: Record<string, unknown> | null    // 供應商回應原文 → 存 provider_response
  error?: string                          // 正規化錯誤訊息（zh-TW）
}

interface IssueInput {
  relateNumber: string
  invoiceNumber: string
  invoiceDate: string
  buyerId: string | null
  buyerName: string | null
  carrierType: string | null
  carrierId: string | null
  donateMark?: '0' | '1'
  taxType?: '1' | '2' | '3'
  salesAmount: number
  taxAmount: number
  totalAmount: number
  items: EfirstItem[]
}

/** 組開立 payload — TODO(efirst-mapping)：欄位名稱待官方文件對齊（結構/值不變） */
export function buildIssuePayload(cfg: EfirstConfig, input: IssueInput): EfirstIssuePayload {
  const taxType = input.taxType ?? '1'
  return {
    action: 'issue',
    sellerId: cfg.sellerId,
    relateNumber: input.relateNumber,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    buyerId: input.buyerId ?? '0000000000',
    buyerName: input.buyerName ?? '消費者',
    carrierType: input.carrierType,
    carrierId: input.carrierId,
    donateMark: input.donateMark ?? '0',
    printMark: input.carrierType || input.buyerId ? 'N' : 'Y',
    taxType,
    taxRate: taxType === '1' ? 0.05 : 0,
    salesAmount: input.salesAmount,
    taxAmount: input.taxAmount,
    totalAmount: input.totalAmount,
    items: input.items,
  }
}

/** 組同日作廢 payload — TODO(efirst-mapping)：欄位名稱待官方文件對齊 */
export function buildVoidPayload(
  cfg: EfirstConfig,
  input: { relateNumber: string; invoiceNumber: string; invoiceDate: string; voidDate: string; reason?: string },
): EfirstVoidPayload {
  return {
    action: 'void',
    sellerId: cfg.sellerId,
    relateNumber: input.relateNumber,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    voidDate: input.voidDate,
    reason: input.reason ?? '交易作廢',
  }
}

/** 組跨日折讓 payload — TODO(efirst-mapping)：欄位名稱待官方文件對齊；
 *  折讓單號由 e首發票端配發，回應存 provider_response */
export function buildAllowancePayload(
  cfg: EfirstConfig,
  input: {
    relateNumber: string
    originalInvoiceNumber: string
    originalInvoiceDate: string
    allowanceDate: string
    buyerId: string | null
    taxAmount: number
    totalAmount: number
    items: EfirstItem[]
    reason?: string
  },
): EfirstAllowancePayload {
  return {
    action: 'allowance',
    sellerId: cfg.sellerId,
    relateNumber: input.relateNumber,
    originalInvoiceNumber: input.originalInvoiceNumber,
    originalInvoiceDate: input.originalInvoiceDate,
    allowanceDate: input.allowanceDate,
    buyerId: input.buyerId ?? '0000000000',
    taxAmount: input.taxAmount,
    totalAmount: input.totalAmount,
    items: input.items,
    reason: input.reason ?? '銷貨折讓',
  }
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * e首發票 HTTP 呼叫（唯一出口）— timeout + 錯誤正規化，永不 throw。
 * @param endpoint 完整 URL（呼叫端負責組路徑）
 * @param apiKey   EFIRST_API_KEY
 * @param body     builder 產出的 payload
 */
export async function callEfirst(
  endpoint: string,
  apiKey: string,
  body: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<EfirstCallResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // TODO(efirst-mapping)：驗證方式待官方文件確認（Bearer / 自訂 header / 簽章）
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    let data: Record<string, unknown> | null = null
    try {
      data = await res.json()
    } catch {
      data = null // 非 JSON 回應
    }

    if (!res.ok) {
      // TODO(efirst-mapping)：錯誤訊息欄位名稱待官方文件確認（暫取 message / error）
      const providerMsg =
        (data && typeof data.message === 'string' && data.message) ||
        (data && typeof data.error === 'string' && data.error) ||
        `HTTP ${res.status}`
      return { ok: false, status: res.status, data, error: `e首發票 API 錯誤：${providerMsg}` }
    }

    return { ok: true, status: res.status, data }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      data: null,
      error: aborted
        ? `e首發票 API 逾時（${timeoutMs}ms）`
        : `e首發票 API 連線失敗：${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    clearTimeout(timer)
  }
}
