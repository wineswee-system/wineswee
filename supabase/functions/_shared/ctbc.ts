// Shared CTBC (中國信託) 網路收單 helpers — auth request build / callback MAC verify.
// Used by ctbc-card-checkout (build) and ctbc-card-callback (verify).
//
// ⚠️ Contract-first skeleton：中信網路收單正式 API 文件尚未到手（待收單業務窗口
// 提供技術規格與測試商店）。以下「欄位名稱」與「MAC 演算法細節」以 TODO 標註，
// 待文件到手後對齊；呼叫端（checkout/callback）的流程與介面不需再動。
//
// Env（只存 edge secrets，絕不進前端 bundle）：
//   CTBC_MERCHANT_ID  商店代號
//   CTBC_TERMINAL_ID  端末代號
//   CTBC_MAC_KEY      交易押碼金鑰
//   CTBC_ENDPOINT     授權頁 URL（測試/正式環境由此切換）

export interface CtbcAuthRequestInput {
  merchantId: string
  terminalId: string
  orderNo: string
  amount: number // 整數新台幣
  callbackUrl: string // server-to-server 授權結果通知（ctbc-card-callback）
  clientBackUrl?: string // 付款完成後瀏覽器返回頁
}

/** CTBC 訂單編號：暫依「英數字、上限 19 碼」清洗。TODO: 依正式文件確認長度/字元集 */
export function toCtbcOrderNo(orderId: string): string {
  const cleaned = String(orderId).replace(/[^0-9A-Za-z]/g, '').slice(0, 19)
  return cleaned || `SME${Date.now()}`
}

/**
 * 建立中信授權請求表單參數（前端以表單 POST 導向授權頁）。
 * TODO: 欄位名稱為佔位（比照中信收單常見欄位 lidm/purchAmt/...），
 *       待正式 API 文件確認實際欄位名、必填欄位與金額格式後對齊。
 */
export async function buildAuthRequest(
  input: CtbcAuthRequestInput,
  macKey: string,
): Promise<Record<string, string>> {
  const params: Record<string, string> = {
    // TODO: 確認欄位名 — 商店代號
    MerchantID: input.merchantId,
    // TODO: 確認欄位名 — 端末代號
    TerminalID: input.terminalId,
    // TODO: 確認欄位名 — 訂單編號（lidm？）
    lidm: input.orderNo,
    // TODO: 確認欄位名與格式 — 交易金額（purchAmt？是否含小數/分）
    purchAmt: String(Math.round(input.amount)),
    // TODO: 確認欄位名 — 幣別（固定新台幣？）
    currency: 'NTD',
    // TODO: 確認欄位名 — 授權結果 server-to-server 通知 URL（AuthResURL？）
    AuthResURL: input.callbackUrl,
  }
  if (input.clientBackUrl) {
    // TODO: 確認欄位名 — 消費者返回頁
    params.ClientBackURL = input.clientBackUrl
  }

  // TODO: 確認押碼欄位名（macValue？chkValue？）
  params.macValue = await computeMac(params, macKey)
  return params
}

/**
 * 計算交易押碼（MAC）。
 * 暫定演算法：key 依字典序排序 → `k=v` 以 & 串接 → 尾端附加 MAC key → SHA-256 → 大寫 hex。
 * TODO: 依正式文件確認實際演算法（欄位順序表？HMAC-SHA256？3DES？）與大小寫規則。
 */
export async function computeMac(
  params: Record<string, string>,
  macKey: string,
  macFieldNames: string[] = ['macValue', 'chkValue', 'MAC'],
): Promise<string> {
  const keys = Object.keys(params)
    .filter((k) => !macFieldNames.includes(k))
    .sort()
  const raw = keys.map((k) => `${k}=${params[k]}`).join('&') + `&key=${macKey}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * 驗證中信授權結果通知的押碼（不符 → 拒絕，防偽造回呼）。
 * TODO: 依正式文件確認回呼押碼欄位名與參與押碼計算的欄位清單。
 */
export async function verifyCallbackMac(
  params: Record<string, string>,
  macKey: string,
): Promise<boolean> {
  const macFieldNames = ['macValue', 'chkValue', 'MAC']
  const received = macFieldNames.map((f) => params[f]).find((v) => v)
  if (!received) return false
  const expected = await computeMac(params, macKey, macFieldNames)
  return expected === received.toUpperCase()
}

/**
 * 判斷授權是否成功。
 * TODO: 確認回應代碼欄位名（status？errcode？）與成功值（'0'？'00'？）。
 */
export function isAuthSuccess(params: Record<string, string>): boolean {
  const code = params.status ?? params.errcode ?? params.RespCode ?? ''
  return code === '0' || code === '00' || code === '0000'
}
