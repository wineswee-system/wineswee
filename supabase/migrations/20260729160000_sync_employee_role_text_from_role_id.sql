-- 根治:employees.role 文字欄永遠自動跟 role_id 一致 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:role(文字)與 role_id 是兩個分開的欄位,靠前端多條路徑各自同步(新增用
--   ROLE_ID_MAP 文字→id、編輯下拉 id→文字),只要任一路徑漏寫一欄就 drift。
--   web/RLS 讀 role_id(current_employee_role=COALESCE(roles.name,role))沒事,但
--   LIFF HRHub 讀 role 文字欄 → drift 就看不到簽核中心。全庫掃到 11 人 drift。
-- 做法:BEFORE INSERT/UPDATE(OF role_id)自動 NEW.role := roles.name(role_id),
--   把 role_id 當單一真相,前端怎麼寫都不會再對不上;role_id 為 null 時不動 role。
--   純新增 trigger,不動現有邏輯;idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_sync_employee_role_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role_id IS NOT NULL THEN
    NEW.role := (SELECT name FROM public.roles WHERE id = NEW.role_id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_employee_role_text ON public.employees;
CREATE TRIGGER trg_sync_employee_role_text
  BEFORE INSERT OR UPDATE OF role_id ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_employee_role_text();

-- 回填現有 drift(11 人:10 個 demo 文字=employee + 已修的容甄等)
UPDATE public.employees e
   SET role = r.name
  FROM public.roles r
 WHERE e.role_id = r.id
   AND e.role IS DISTINCT FROM r.name;

NOTIFY pgrst, 'reload schema';
