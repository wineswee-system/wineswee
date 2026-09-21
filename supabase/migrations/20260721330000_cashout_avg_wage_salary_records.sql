-- 在職特休結清 cashout_annual_leave 改平均工資(salary_records) + 修 leave_type drift — 2026-07-21 [收斂階段5]
--
-- 兩個問題一起修:
--   ① leave_type drift:RPC 濾 '特休',但 104 重匯後 DB 全是 'annual' → 現在撈 0 筆(鈕形同壞掉)。改 'annual'。
--   ② 金額基準:原用 employees.base_salary/30(只本薪,且陳虹等人=0)。改平均工資/30,
--      平均工資走 salary_records(本薪+主管/伙食/交通,近6月均),與資遣費 calc_severance 同一套公式。
--
-- 順手抽共用 helper _employee_avg_monthly_wage,避免「平均工資」再多一份分歧定義。
-- 時薪制維持 base_salary/30(PT 折現另有語意,不在此收斂)。migration 本身不發錢(要按鈕+確認才寫入)。
-- 對齊 [[feedback_annual_payout_avg_wage]] / calc_severance。

BEGIN;

-- ── 共用:員工平均工資(本薪+固定津貼,不含加班)。優先 salary_records 近6月均 → structures → 員工主檔 ──
CREATE OR REPLACE FUNCTION public._employee_avg_monthly_wage(p_emp_id int, p_as_of date DEFAULT current_date)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v     numeric;
  v_emp public.employees;
BEGIN
  -- ① salary_records 近6個月均(已發布實薪,最可靠;含主管/職務/伙食/交通,不含加班)
  SELECT AVG(COALESCE(base_salary,0) + COALESCE(role_allowance,0)
           + COALESCE(meal_allowance,0) + COALESCE(transport_allowance,0))
    INTO v
    FROM public.salary_records
   WHERE employee_id = p_emp_id
     AND base_salary > 0
     AND month >= to_char(p_as_of - INTERVAL '6 months', 'YYYY-MM')
     AND month <  to_char(p_as_of, 'YYYY-MM');
  IF v IS NOT NULL AND v > 0 THEN RETURN ROUND(v, 2); END IF;

  -- ② salary_structures 最新
  SELECT COALESCE(base_salary,0) + COALESCE(supervisor_allowance,0) + COALESCE(role_allowance,0)
       + COALESCE(meal_allowance,0) + COALESCE(transport_allowance,0)
    INTO v
    FROM public.salary_structures
   WHERE employee_id = p_emp_id
   ORDER BY effective_from DESC NULLS LAST, id DESC
   LIMIT 1;
  IF v IS NOT NULL AND v > 0 THEN RETURN ROUND(v, 2); END IF;

  -- ③ employees 主檔
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  RETURN COALESCE(v_emp.base_salary,0) + COALESCE(v_emp.meal_allowance,0) + COALESCE(v_emp.transport_allowance,0);
END $$;

GRANT EXECUTE ON FUNCTION public._employee_avg_monthly_wage(int, date) TO service_role;


-- ── 在職特休結清:leave_type 'annual' + 日薪走平均工資 helper ──
CREATE OR REPLACE FUNCTION public.cashout_annual_leave(
  p_org     INT,
  p_year    INT,
  p_dry_run BOOLEAN DEFAULT TRUE
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_items json;
  v_count INT     := 0;
  v_total numeric := 0;
  r       RECORD;
BEGIN
  IF COALESCE(public.current_employee_role(), '') NOT IN ('admin','super_admin','manager','office_staff') THEN
    RAISE EXCEPTION '無權限執行特休結清';
  END IF;

  SELECT
    COALESCE(json_agg(json_build_object(
      'employee_id', t.employee_id,
      'name',        t.name,
      'balance_id',  t.balance_id,
      'unused_days', t.unused,
      'daily_rate',  t.daily_rate,
      'amount',      t.amount
    ) ORDER BY t.name), '[]'::json),
    COUNT(*),
    COALESCE(SUM(t.amount), 0)
  INTO v_items, v_count, v_total
  FROM (
    SELECT
      lb.id   AS balance_id,
      e.id    AS employee_id,
      e.name,
      (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) AS unused,
      -- 月薪:平均工資/30;時薪:維持 base_salary/30
      (CASE WHEN COALESCE(e.salary_type,'') = 'hourly'
            THEN COALESCE(e.base_salary,0) / 30.0
            ELSE public._employee_avg_monthly_wage(e.id) / 30.0 END) AS daily_rate,
      round(
        (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0))
        * (CASE WHEN COALESCE(e.salary_type,'') = 'hourly'
                THEN COALESCE(e.base_salary,0) / 30.0
                ELSE public._employee_avg_monthly_wage(e.id) / 30.0 END)
      ) AS amount
    FROM leave_balances lb
    JOIN employees e ON e.id = lb.employee_id
    WHERE lb.leave_type = 'annual'
      AND lb.year       = p_year
      AND lb.organization_id = p_org
      AND (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) > 0
  ) t;

  IF NOT p_dry_run THEN
    FOR r IN
      SELECT
        lb.id AS balance_id,
        e.id  AS employee_id,
        (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0)) AS new_used,
        round(
          (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0))
          * (CASE WHEN COALESCE(e.salary_type,'') = 'hourly'
                  THEN COALESCE(e.base_salary,0) / 30.0
                  ELSE public._employee_avg_monthly_wage(e.id) / 30.0 END)
        ) AS amount
      FROM leave_balances lb
      JOIN employees e ON e.id = lb.employee_id
      WHERE lb.leave_type = 'annual'
        AND lb.year       = p_year
        AND e.status      = '在職'
        AND e.organization_id = p_org
        AND (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) > 0
    LOOP
      INSERT INTO bonus_records(employee_id, category, amount, note, date, organization_id)
      VALUES (r.employee_id, '特休結清', r.amount, '特休結清 ' || p_year, current_date, p_org);

      UPDATE leave_balances SET used_days = r.new_used WHERE id = r.balance_id;
    END LOOP;
  END IF;

  RETURN json_build_object(
    'dry_run',         p_dry_run,
    'processed_count', v_count,
    'total_amount',    v_total,
    'items',           v_items
  );
END $$;

GRANT EXECUTE ON FUNCTION public.cashout_annual_leave(INT, INT, BOOLEAN)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
