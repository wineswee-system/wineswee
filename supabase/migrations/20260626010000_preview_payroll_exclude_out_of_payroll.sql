-- ════════════════════════════════════════════════════════════════════════════
-- preview_payroll：排除 in_payroll = FALSE 的編制外員工
-- 2026-06-26
--
-- 加一個 AND (e.in_payroll IS NOT FALSE) 條件，保證試算不含編制外員工。
-- idempotent：CREATE OR REPLACE
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
    AND (e.in_payroll IS NOT FALSE)   -- 編制外員工不納入薪資計算
    -- 到職<=月底 且 (在職 或 當月離職)，以計薪月份為準、非相對今天
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
