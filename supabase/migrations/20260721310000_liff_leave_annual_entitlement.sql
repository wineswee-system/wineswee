-- LIFF 特休額度 anon wrapper — 2026-07-21 [收斂階段3]
-- LIFF(anon)靠 line_user_id 認身分,包 leave_annual_entitlement 成單一真相,
-- 退掉 LIFF 端 client-side calcAnnualLeave/calcPTAnnualLeaveHours(weekly_hours/40 灌水版)。
-- 對齊 [[feedback_liff_anon_rls]]:LIFF 讀表一律走 SECURITY DEFINER RPC。

CREATE OR REPLACE FUNCTION public.liff_leave_annual_entitlement(
  p_line_user_id text,
  p_ref_year     int DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp_id int;
BEGIN
  SELECT ela.employee_id INTO v_emp_id
    FROM public.employee_line_accounts ela
   WHERE ela.line_user_id = p_line_user_id
   LIMIT 1;

  IF v_emp_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_LINE_BINDING', 'ft_days', 0, 'pt_hours', 0);
  END IF;

  -- 走同一支唯一真相(今天基準 p_ref_year=NULL / 指定週年期)
  RETURN public.leave_annual_entitlement(v_emp_id, p_ref_year);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_leave_annual_entitlement(text, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
