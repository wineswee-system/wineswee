-- 開單撈人=員工∪門市manager本人∪manager主管;角色先看職稱(督導/店長/代理)
CREATE OR REPLACE FUNCTION public._guess_employee_bonus_role(p_emp_id integer, p_store_id integer)
 RETURNS text LANGUAGE plpgsql STABLE AS $function$
DECLARE v_emp_type TEXT; v_position TEXT; v_mgr_id INT;
BEGIN
  SELECT employment_type, position INTO v_emp_type, v_position FROM employees WHERE id = p_emp_id;
  SELECT manager_id INTO v_mgr_id FROM stores WHERE id = p_store_id;
  IF COALESCE(v_position,'') ILIKE '%督導%' THEN RETURN '督導'; END IF;
  IF v_mgr_id = p_emp_id THEN RETURN '店長'; END IF;
  IF COALESCE(v_position,'') ILIKE '%代理%' THEN RETURN '代理人'; END IF;
  IF v_emp_type IN ('兼職','PT','工讀','實習','part_time') THEN RETURN '兼職'; END IF;
  RETURN '正職';
END $function$;
CREATE OR REPLACE FUNCTION public.initialize_store_bonus(p_store_id integer, p_year_month text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id   INT;
  v_monthly_id INT;
  v_emp      RECORD;
  v_role     TEXT;
  v_weight   NUMERIC;
BEGIN
  SELECT organization_id INTO v_org_id FROM stores WHERE id = p_store_id;
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND'; END IF;

  -- 確保 role_config 有預設值
  PERFORM public._ensure_store_bonus_role_config(v_org_id);

  -- 找現有的 monthly 或新建
  SELECT id INTO v_monthly_id FROM store_bonus_monthly
   WHERE store_id = p_store_id AND year_month = p_year_month;

  IF v_monthly_id IS NULL THEN
    INSERT INTO store_bonus_monthly (organization_id, store_id, year_month)
    VALUES (v_org_id, p_store_id, p_year_month)
    RETURNING id INTO v_monthly_id;
  END IF;

  -- 不要動已 finalized 的單
  IF (SELECT status FROM store_bonus_monthly WHERE id = v_monthly_id) = 'finalized' THEN
    RAISE EXCEPTION 'ALREADY_FINALIZED';
  END IF;

  -- 拉該店在職員工（包含 store_id 直接 link 跟 store 名字 fallback）
  FOR v_emp IN
    SELECT e.id, e.name
      FROM employees e
     WHERE e.organization_id = v_org_id
       AND e.status = '在職'
       AND (
         e.store_id = p_store_id
         OR e.id = (SELECT manager_id FROM stores WHERE id = p_store_id)
         OR e.id = (SELECT e1.supervisor_id FROM stores s JOIN employees e1 ON e1.id = s.manager_id WHERE s.id = p_store_id)
       )
     ORDER BY e.id
  LOOP
    v_role := public._guess_employee_bonus_role(v_emp.id, p_store_id);
    SELECT weight INTO v_weight FROM store_bonus_role_config
     WHERE organization_id = v_org_id AND role = v_role;

    INSERT INTO store_bonus_employee (
      monthly_id, employee_id, employee_name, role, weight
    ) VALUES (
      v_monthly_id, v_emp.id, v_emp.name, v_role, COALESCE(v_weight, 1)
    )
    ON CONFLICT (monthly_id, employee_id) DO UPDATE
      SET employee_name = EXCLUDED.employee_name,
          role          = EXCLUDED.role,
          weight        = EXCLUDED.weight;
  END LOOP;

  -- 第一輪 recalculate（業績欄都 0 所以 bonus_pool=0，員工只先建出 row）
  PERFORM public.recalculate_store_bonus(v_monthly_id);

  RETURN v_monthly_id;
END $function$
;

NOTIFY pgrst, 'reload schema';
