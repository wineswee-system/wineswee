-- LIFF Clock 用 anon key 直查 attendance_records 被 RLS 擋住
-- (policy: employee = current_employee_name()，anon 沒 auth 連 name 都拿不到)
-- → 用 SECURITY DEFINER RPC 對 LINE user 驗證後回今天紀錄。
-- 對齊 [feedback_liff_anon_rls] 慘案模式。

CREATE OR REPLACE FUNCTION public.liff_get_today_attendance(
  p_line_user_id TEXT,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS SETOF public.attendance_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id INT;
BEGIN
  -- 從 LINE user_id 解出 employee_id（必須 verified）
  SELECT employee_id INTO v_employee_id
  FROM public.employee_line_accounts
  WHERE line_user_id = p_line_user_id AND is_verified = TRUE
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RETURN;  -- 沒綁定 → 回空
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.attendance_records
    WHERE employee_id = v_employee_id
      AND date = p_date
    ORDER BY id DESC
    LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_today_attendance(TEXT, DATE) TO anon, authenticated;
