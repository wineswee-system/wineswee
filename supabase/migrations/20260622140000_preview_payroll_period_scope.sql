-- ════════════════════════════════════════════════════════════════════════════
-- preview_payroll：員工範圍改「以計薪月份為準」，不要相對今天
-- 2026-06-22
--
-- BUG：原本離職判斷是 resign_date >= (本月初 - 1個月)，那個「本月」是 current_date
--      (今天)，不是計薪月份 → 算 6 月薪資時還會撈到 4/5 月離職的人；算舊月份時又會
--      漏掉當月離職的人。
--
-- 修正：當月有上班過的人才入該月薪資 =
--        到職日 <= 月底  AND  (未離職 OR 離職日 >= 月初)
--      純以 p_period 推出的月初/月底判斷，與 current_date 無關。
--      改用 resign_date 而非 status，順便擋掉「已離職但 status 沒更新」的髒資料。
--
-- 只重定義 preview_payroll(list 函式)，_compute_payroll_for_employee 不動。
-- idempotent：CREATE OR REPLACE。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.preview_payroll(
  p_period       TEXT,
  p_org          INT,
  p_store_filter TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_year   INT  := split_part(p_period,'-',1)::int;
  v_month  INT  := split_part(p_period,'-',2)::int;
  v_mstart date := make_date(v_year, v_month, 1);
  v_mend   date := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_result json;
BEGIN
  SELECT COALESCE(json_agg(public._compute_payroll_for_employee(e.id, p_period) ORDER BY e.name), '[]'::json)
    INTO v_result
  FROM employees e
  WHERE e.organization_id = p_org
    -- 員工範圍「與 generate_payroll(入帳) 完全一致」，保證試算=入帳同一批人：
    -- 到職<=月底 且 (在職 或 當月離職)，以計薪月份為準、非相對今天
    -- → 6月薪資不會再撈到4/5月離職的人
    AND (e.join_date IS NULL OR e.join_date <= v_mend)
    AND (
      e.status = '在職'
      OR (e.status = '離職'
          AND e.resign_date IS NOT NULL
          AND e.resign_date >= v_mstart
          AND e.resign_date <= v_mend)
    )
    AND (
      p_store_filter IS NULL
      OR e.store = p_store_filter
      OR (e.additional_stores IS NOT NULL AND p_store_filter = ANY(e.additional_stores))
    );
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.preview_payroll(TEXT, INT, TEXT)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
