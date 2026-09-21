// Shared ECPay helpers — CheckMacValue generation/verification (EncryptType=1, SHA256).
// Used by ecpay-checkout (generate) and ecpay-callback (verify).
// Spec: https://developers.ecpay.com.tw/?p=2902

/**
 * .NET HttpUtility.UrlEncode style encoding, as required by ECPay:
 * - space  → '+'   (encodeURIComponent gives %20)
 * - '~'    → %7e   (encodeURIComponent leaves it literal)
 * - "'"    → %27   (encodeURIComponent leaves it literal)
 * - '-' '_' '.' '!' '*' '(' ')' stay literal (encodeURIComponent already keeps them)
 * The final string is lowercased before hashing per ECPay spec.
 */
function dotNetUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/~/g, '%7e')
    .replace(/'/g, '%27')
}

/**
 * Generate ECPay CheckMacValue for a param set (CheckMacValue key is ignored if present).
 * Steps: sort keys alphabetically (case-insensitive) → HashKey=..&k=v..&HashIV=..
 *        → .NET URL-encode → lowercase → SHA256 → uppercase hex.
 */
export async function generateCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): Promise<string> {
  const keys = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => {
      const la = a.toLowerCase()
      const lb = b.toLowerCase()
      return la < lb ? -1 : la > lb ? 1 : 0
    })

  const raw =
    `HashKey=${hashKey}&` +
    keys.map((k) => `${k}=${params[k]}`).join('&') +
    `&HashIV=${hashIV}`

  const encoded = dotNetUrlEncode(raw).toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** ECPay AioCheckOut gateway URL. stage=true → 測試環境 */
export function ecpayGatewayUrl(stage: boolean): string {
  return stage
    ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
}

/** MerchantTradeDate in 'yyyy/MM/dd HH:mm:ss', Asia/Taipei (UTC+8). */
export function formatTradeDate(d: Date = new Date()): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000) // shift to UTC+8, then read UTC fields
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ` +
    `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`
}

/** MerchantTradeNo: ECPay allows max 20 alphanumeric chars, must be unique per merchant. */
export function toMerchantTradeNo(orderId: string): string {
  const cleaned = String(orderId).replace(/[^0-9A-Za-z]/g, '').slice(0, 20)
  return cleaned || `SME${Date.now()}`
}
