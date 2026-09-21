-- ════════════════════════════════════════════════════════════════════════════
-- 修：店長/課督導 要能排班(寫 schedules)— 之前被我鎖成 admin-only 擋掉了
-- 2026-06-18
--
-- 慘案(自己造):20260618100000 把 schedules 寫入設成 is_admin() OR service_role。
--   但店長/督導都是 role=manager(非 admin)→ 他們存班表(前端直接 insert/update/delete
--   schedules)會被 RLS 擋 → 排班功能對店長/督導壞掉。違反「manager 職責範圍要能運作」。
--
-- 修法:寫入改成「能管理該班所屬員工門市的人」:
--   admin / service / 該門市店長(stores.manager_id) / 該門市所屬課督導(section supervisor)。
--   不放給一般店員(避免自己改自己班;且前端 canEditSchedule 也只給管理者)。
--
-- 新 helper:
--   can_manage_store(store)   : admin/service / 店長 / 課督導(不含一般店員)
--   can_manage_emp_store(emp) : 由員工查其門市再套 can_manage_store(SECURITY DEFINER 避 RLS)
--
-- 讀(schedules_v_sel = can_see_request)不變。idempotent：CREATE OR REPLACE + 重建寫 policy。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.can_manage_store(p_store_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id();
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_admin() THEN RETURN true; END IF;
  IF v_me IS NULL OR p_store_id IS NULL THEN RETURN false; END IF;
  -- 該門市店長
  IF EXISTS (SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.manager_id = v_me) THEN RETURN true; END IF;
  -- 該門市所屬課的督導/課長
  IF EXISTS (
    SELECT 1 FROM stores st JOIN department_sections ds ON ds.id = st.section_id
     WHERE st.id = p_store_id AND ds.supervisor_id = v_me
  ) THEN RETURN true; END IF;
  RETURN false;
END $$;

-- 由「員工 id 或姓名」查其門市再套 can_manage_store
-- (schedules 新增/upsert 是用 employee 姓名、不帶 employee_id → 必須能用姓名 fallback)
CREATE OR REPLACE FUNCTION public.can_manage_emp_store(p_emp_id int, p_emp_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store int;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_admin() THEN RETURN true; END IF;
  SELECT COALESCE(
    (SELECT store_id FROM employees WHERE id = p_emp_id),
    (SELECT store_id FROM employees WHERE name = p_emp_name AND status = '在職' ORDER BY id LIMIT 1)
  ) INTO v_store;
  RETURN can_manage_store(v_store);
END $$;

GRANT EXECUTE ON FUNCTION public.can_manage_store(bigint)         TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_emp_store(int, text)  TO authenticated, anon;

-- schedules 寫入：店長/課督導/admin 都能排（讀政策不動）。用 (employee_id, employee 姓名) 解門市。
DROP POLICY IF EXISTS schedules_v_write ON public.schedules;
CREATE POLICY schedules_v_write ON public.schedules FOR ALL
  USING (can_manage_emp_store(employee_id, employee))
  WITH CHECK (can_manage_emp_store(employee_id, employee));

COMMIT;

NOTIFY pgrst, 'reload schema';
