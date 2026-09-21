// Shared LINE Pay v3 helpers — HMAC signature + API base URL.
// Used by linepay-checkout and linepay-confirm.
// Spec: https://pay.line.me/documents/online_v3_en.html

/**
 * LINE Pay v3 request signature:
 *   base64( HMAC-SHA256( channelSecret, channelSecret + uri + requestBody + nonce ) )
 * For GET requests, requestBody is the query string; for POST it is the JSON body.
 * `uri` must include the path AND query string (if any), without the host.
 */
export async function lineSignature(
  channelSecret: string,
  uri: string,
  bodyOrQuery: string,
  nonce: string,
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(channelSecret + uri + bodyOrQuery + nonce))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

/** LINE Pay API base — LINEPAY_SANDBOX='1' → sandbox. */
export function lineApiBase(sandbox: boolean): string {
  return sandbox ? 'https://sandbox-api-pay.line.me' : 'https://api-pay.line.me'
}

/**
 * Parse a LINE Pay JSON response while preserving int64 transactionId precision.
 * transactionId can be a 19-digit number which exceeds Number.MAX_SAFE_INTEGER,
 * so quote it before JSON.parse.
 */
// deno-lint-ignore no-explicit-any
export function parseLinePayResponse(rawText: string): any {
  const safe = rawText.replace(/"(transactionId|refundTransactionId)"\s*:\s*(\d+)/g, '"$1":"$2"')
  return JSON.parse(safe)
}

/** Build the standard LINE Pay auth headers for a signed request. */
export async function lineHeaders(
  channelId: string,
  channelSecret: string,
  uri: string,
  body: string,
): Promise<Record<string, string>> {
  const nonce = crypto.randomUUID()
  const signature = await lineSignature(channelSecret, uri, body, nonce)
  return {
    'Content-Type': 'application/json',
    'X-LINE-ChannelId': channelId,
    'X-LINE-Authorization-Nonce': nonce,
    'X-LINE-Authorization': signature,
  }
}
