-- 修正多租戶資料外洩:一般 admin 不應跨組織看到其他 org 的資料。
--
-- 背景:org_visible() 原本對「任何 admin/super_admin」都回傳 true(跨 org),
-- 導致 demo 帳號(org 2 的 admin)可讀取真實公司 org 1(威耀時代/Wineswee)的資料。
--
-- 修正:只有 super_admin(平台擁有者)保留跨 org 存取;
-- 一般 admin 及其他角色一律限縮在自己的 organization。
-- 僅影響 SELECT 可見性(org_visible 用於 SELECT policy),不動 is_admin() 所控管的寫入權限。

BEGIN;

-- 1) 新增 is_super_admin():只認 super_admin 角色
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
      JOIN roles r ON r.id = e.role_id
     WHERE (e.auth_user_id = auth.uid()
            OR e.email = auth.jwt() ->> 'email')
       AND r.name = 'super_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, anon;

-- 2) 重寫 org_visible():admin 不再跨 org,改由 super_admin 保留跨 org
CREATE OR REPLACE FUNCTION public.org_visible(p_org bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_super_admin() THEN RETURN true; END IF;      -- 平台擁有者保留跨 org
  RETURN p_org IS NOT NULL AND p_org = current_user_org();
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
