import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// 薪資單 PDF 簽短效下載網址:LIFF 先上傳到私有桶 payslips,再呼叫本函式用 service_role 簽 URL。
// 路徑是隨機 UUID(不可猜)、URL 120 秒失效 → Android LINE 用系統瀏覽器開此網址即可下載,薪資不進公開桶。
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { path } = await req.json()
    // 只允許 payslips 桶內的 .pdf、擋路徑穿越
    if (!path || typeof path !== 'string' || !path.endsWith('.pdf') || path.includes('..') || path.startsWith('/')) {
      return json({ error: 'bad path' }, 400)
    }
    // @ts-ignore Deno runtime
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await sb.storage.from('payslips').createSignedUrl(path, 120)
    if (error) return json({ error: error.message }, 500)
    return json({ url: data.signedUrl })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
