-- ════════════════════════════════════════════════════════════
-- Fix: 個人簽章上傳失敗「permission denied for table users」
--
-- Root cause：employees_self_update policy 在 RLS 表達式裡直接
--   SELECT email FROM auth.users WHERE id = auth.uid()
-- RLS policy 表達式以「呼叫者身份」執行（不像 SECURITY DEFINER
-- function），但 authenticated role 沒有 SELECT auth.users 的權限，
-- 於是 ANY 員工觸發 self-update（例：寫 signature_url）都會 42501。
--
-- 修法跟 20260429000011 / 20260511110000 一致：
--   - 加 auth_user_id = auth.uid() 分支（不需要 join auth.users）
--   - email 比對改走 auth.jwt() ->> 'email'（不需要 query auth.users）
--
-- 嚴格只「加分支」，不刪原條件 → 原本能 update 自己的還是能 update。
-- ════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS employees_self_update ON public.employees;

CREATE POLICY employees_self_update ON public.employees
FOR UPDATE TO authenticated
USING (
  auth_user_id = auth.uid()
  OR email = (auth.jwt() ->> 'email')
)
WITH CHECK (
  auth_user_id = auth.uid()
  OR email = (auth.jwt() ->> 'email')
);

COMMIT;

NOTIFY pgrst, 'reload schema';
