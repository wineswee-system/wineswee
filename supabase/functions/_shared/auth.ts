// _shared/auth.ts — Edge Function 呼叫者驗證（JWT → 員工 org）
//
// service-role client 繞過 RLS，任何以 service key 查詢的 function 都必須
// 先驗 JWT 並解析呼叫者 org，再以該 org 限縮資料範圍（同 invite-employee 模式）。
// 注意：functions.invoke 無登入 session 時會帶 anon key，getUser() 會失敗 → 回 null。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface CallerInfo {
  userId: string
  email: string | null
  /** null = super_admin（無 org 綁定，org_visible 全放行語意） */
  orgId: number | null
}

/** 驗證 Authorization JWT 並解析呼叫者的員工 org。非員工/無效憑證回 null。 */
export async function verifyEmployeeCaller(req: Request): Promise<CallerInfo | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null

  // @ts-ignore — Deno global available at runtime in Supabase Edge Functions
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return null

  const { data: caller } = await db
    .from('employees')
    .select('organization_id')
    .eq('email', user.email)
    .maybeSingle()
  if (!caller) return null

  return { userId: user.id, email: user.email ?? null, orgId: caller.organization_id ?? null }
}
