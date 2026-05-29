-- LIFF 員工自己看當月所有打卡紀錄
-- SECURITY DEFINER 繞 anon RLS（attendance_records policy 要 current_employee_name()，
-- anon 拿不到 → 永遠看不到自己的紀錄）

CREATE OR REPLACE FUNCTION public.liff_get_my_attendance_month(
  p_line_user_id TEXT,
  p_year_month   TEXT   -- YYYY-MM 格式
)
RETURNS SETOF public.attendance_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id INT;
  v_start DATE;
  v_end   DATE;
BEGIN
  -- 從 LINE user_id 解出 employee_id
  SELECT employee_id INTO v_employee_id
  FROM public.employee_line_accounts
  WHERE line_user_id = p_line_user_id AND is_verified = TRUE
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RETURN;
  END IF;

  -- 算月初/月底
  v_start := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + INTERVAL '1 month - 1 day')::DATE;

  RETURN QUERY
    SELECT *
    FROM public.attendance_records
    WHERE employee_id = v_employee_id
      AND date BETWEEN v_start AND v_end
    ORDER BY date DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_my_attendance_month(TEXT, TEXT)
  TO anon, authenticated;
