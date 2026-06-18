-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 提早下班登記 RPC（anon 走 SECURITY DEFINER）
-- 2026-06-18
--
-- 店長在 LIFF 幫員工登記提早下班。RPC 內把 line_user_id 解成「呼叫者員工」，
-- 權限：① 必須是「店長/督導/manager/admin」(一般店員不可) ② 非 admin 只能對同店員工登記。
-- 寫入 early_leave_records（同 web 端表）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 是否為「可登記者」（店長/督導/manager/admin）
CREATE OR REPLACE FUNCTION public._is_early_leave_manager(e public.employees)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT e.role IN ('admin','super_admin','manager')
      OR e.is_manager IS TRUE
      OR COALESCE(e.position,'') LIKE '%店長%'
      OR COALESCE(e.position,'') LIKE '%督導%'
$$;

-- 1) 列出可登記的員工（同店 / 管理者看全公司）；非店長 → 空
CREATE OR REPLACE FUNCTION public.liff_list_early_leave_employees(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH caller AS (
    SELECT e.* FROM employees e JOIN employee_line_accounts ela ON ela.employee_id = e.id
    WHERE ela.line_user_id = p_line_user_id AND e.status = '在職'
    ORDER BY ela.is_primary DESC, ela.id ASC LIMIT 1
  )
  SELECT COALESCE(json_agg(json_build_object('id', emp.id, 'name', emp.name) ORDER BY emp.name), '[]'::json)
  FROM employees emp CROSS JOIN caller c
  WHERE emp.status = '在職' AND emp.organization_id = c.organization_id
    AND public._is_early_leave_manager(c)
    AND (c.role IN ('admin','super_admin') OR emp.store_id = c.store_id)
$$;
GRANT EXECUTE ON FUNCTION public.liff_list_early_leave_employees(text) TO anon, authenticated;

-- 2) 列出已登記紀錄；非店長 → 空
CREATE OR REPLACE FUNCTION public.liff_list_early_leave(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH caller AS (
    SELECT e.* FROM employees e JOIN employee_line_accounts ela ON ela.employee_id = e.id
    WHERE ela.line_user_id = p_line_user_id AND e.status = '在職'
    ORDER BY ela.is_primary DESC, ela.id ASC LIMIT 1
  )
  SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.date DESC), '[]'::json)
  FROM (
    SELECT r.id, r.employee_id, emp.name, r.date, r.early_from, r.early_to, r.reason
    FROM early_leave_records r
    JOIN employees emp ON emp.id = r.employee_id
    CROSS JOIN caller c
    WHERE public._is_early_leave_manager(c)
      AND r.organization_id = c.organization_id
      AND (c.role IN ('admin','super_admin') OR r.store_id = c.store_id)
    ORDER BY r.date DESC
    LIMIT 100
  ) x
$$;
GRANT EXECUTE ON FUNCTION public.liff_list_early_leave(text) TO anon, authenticated;

-- 3) 新增/更新一筆（店長/管理者，且同店或 admin）
CREATE OR REPLACE FUNCTION public.liff_create_early_leave(
  p_line_user_id text,
  p_employee_id  int,
  p_date         date,
  p_early_from   time,
  p_early_to     time,
  p_reason       text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller employees;
  v_target employees;
BEGIN
  SELECT e.* INTO v_caller FROM employees e JOIN employee_line_accounts ela ON ela.employee_id = e.id
   WHERE ela.line_user_id = p_line_user_id AND e.status = '在職'
   ORDER BY ela.is_primary DESC, ela.id ASC LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN json_build_object('ok', false, 'error', '找不到綁定員工'); END IF;
  IF NOT public._is_early_leave_manager(v_caller) THEN
    RETURN json_build_object('ok', false, 'error', '僅店長/管理者可登記');
  END IF;

  SELECT * INTO v_target FROM employees WHERE id = p_employee_id;
  IF v_target.id IS NULL THEN RETURN json_build_object('ok', false, 'error', '找不到員工'); END IF;

  IF NOT (v_caller.role IN ('admin','super_admin') OR v_target.store_id = v_caller.store_id) THEN
    RETURN json_build_object('ok', false, 'error', '無權限登記此員工（非同店）');
  END IF;

  INSERT INTO early_leave_records (employee_id, date, store_id, early_from, early_to, reason, created_by, organization_id)
  VALUES (p_employee_id, p_date, v_target.store_id, p_early_from, p_early_to, p_reason, v_caller.id, v_target.organization_id)
  ON CONFLICT (employee_id, date) DO UPDATE
    SET early_from = EXCLUDED.early_from, early_to = EXCLUDED.early_to,
        reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, store_id = EXCLUDED.store_id;

  RETURN json_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.liff_create_early_leave(text, int, date, time, time, text) TO anon, authenticated;

-- 4) 刪除一筆（店長/管理者，且同店或 admin）
CREATE OR REPLACE FUNCTION public.liff_delete_early_leave(p_line_user_id text, p_id bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller employees;
  v_rec    early_leave_records;
BEGIN
  SELECT e.* INTO v_caller FROM employees e JOIN employee_line_accounts ela ON ela.employee_id = e.id
   WHERE ela.line_user_id = p_line_user_id AND e.status = '在職'
   ORDER BY ela.is_primary DESC, ela.id ASC LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN json_build_object('ok', false, 'error', '找不到綁定員工'); END IF;
  IF NOT public._is_early_leave_manager(v_caller) THEN
    RETURN json_build_object('ok', false, 'error', '僅店長/管理者可刪除');
  END IF;

  SELECT * INTO v_rec FROM early_leave_records WHERE id = p_id;
  IF v_rec.id IS NULL THEN RETURN json_build_object('ok', true); END IF;

  IF NOT (v_caller.role IN ('admin','super_admin') OR v_rec.store_id = v_caller.store_id) THEN
    RETURN json_build_object('ok', false, 'error', '無權限刪除');
  END IF;

  DELETE FROM early_leave_records WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.liff_delete_early_leave(text, bigint) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
