-- ============================================================
-- 防止升權：僅「超級管理員」可指派「超級管理員」角色
-- 2026-07-07
--
-- 背景：employees 的 UPDATE RLS 是 current_employee_role() IN
--       ('admin','super_admin') 即可寫，沒有針對 role 值的守門。
--       admin 因此可把任何人（含自己）的 role 設成 super_admin。
--
-- 真正決定權限的是 role_id → roles.name（見 AuthContext）；
-- 前端同時寫 role(text) 與 role_id，故兩者任一被設成 super_admin
-- 都算升權，必須一起擋（否則可用 role_id=1 繞過）。
--
-- 守門只擋「升權」：
--   - 目標列「即將成為」super_admin（role='super_admin' 或 role_id=1）
--   - 且原本不是 super_admin（改名/降級等一般編輯放行）
--   - 且呼叫者已登入（service_role/migration 種子 auth.uid()=NULL 放行）
--   - 且呼叫者自己不是 super_admin → 擋下
-- 冪等：CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_super_admin_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  becomes_super boolean;
  was_super     boolean;
BEGIN
  -- 目標列是否「成為」super_admin（role 文字或 role_id=1 任一即算）
  becomes_super := COALESCE(NEW.role = 'super_admin', false)
                OR COALESCE(NEW.role_id = 1, false);

  -- 不是要變 super_admin → 放行
  IF NOT becomes_super THEN
    RETURN NEW;
  END IF;

  -- UPDATE 且原本就已是 super_admin → 非升權（改名等）→ 放行
  IF TG_OP = 'UPDATE' THEN
    was_super := COALESCE(OLD.role = 'super_admin', false)
              OR COALESCE(OLD.role_id = 1, false);
    IF was_super THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 系統/service_role 寫入（無登入 JWT）→ 放行（migration / seed 需要）
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- 到這裡：有登入者，且正把某列升為 super_admin
  IF public.current_employee_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION '僅超級管理員可指派「超級管理員」角色（SUPER_ADMIN_ESCALATION_DENIED）';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_super_admin_escalation ON public.employees;
CREATE TRIGGER trg_prevent_super_admin_escalation
  BEFORE INSERT OR UPDATE OF role, role_id ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_super_admin_escalation();

COMMIT;
