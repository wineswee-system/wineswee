-- 2026-08-17 還原:batch1(20260817240000)對「LIFF anon / LINE 推播」DEFINER RPC 加的 caller-org 守門用錯機制。
--   _same_org_or_super() 對 anon(無 org)回 NULL:SQL 版 `WHERE … AND guard` 會把資料整列濾掉
--   → 打卡/GPS(liff_get_stores_for_employee)、申請人資訊、LINE 推播目標、加班計算全爆。
--   這些 RPC 本就是靠 DEFINER 繞過呼叫者身分供 anon 用,不能用呼叫者 org 當守門。
--   → 還原下列 6 支到「加守門前」的定義。web 管理員操作(apply_employee_resignation /
--     reset_all_employee_permission_overrides)保留守門,不在此檔。
--   跨租戶單筆讀取的正確收法=改用 line_user_id 驗證(另開),非此檔範圍。

-- ── _employee_line_target ──(LINE 推播目標,非 anon 但推播 context 無呼叫者 org)
CREATE OR REPLACE FUNCTION public._employee_line_target(p_emp_id integer)
 RETURNS TABLE(line_user_id text, channel_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ela.line_user_id, lc.code
    FROM employee_line_accounts ela
    JOIN line_channels lc ON lc.id = ela.channel_id
   WHERE ela.employee_id = p_emp_id
     AND lc.status = 'active'
   ORDER BY lc.is_default DESC NULLS LAST,
            ela.is_primary DESC NULLS LAST,
            ela.id
   LIMIT 1;
$function$
;

-- ── _ot_category ──(LIFF 加班計算 + 計薪引擎共用)
CREATE OR REPLACE FUNCTION public._ot_category(p_emp_id integer, p_date date, p_ot_category text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT string_agg(COALESCE(shift,''), ' ') AS shifts
    FROM public.schedules WHERE employee_id = p_emp_id AND date = p_date
  )
  SELECT CASE
    WHEN sc.shifts LIKE '%例假%' THEN 'weekly_off'
    WHEN sc.shifts LIKE '%休息%' THEN 'restday'
    WHEN public._is_national_holiday(p_emp_id, p_date) THEN 'holiday'
    WHEN COALESCE((
      SELECT COALESCE(ss.salary_type,'')='hourly' OR COALESCE(ss.employment_category,'')='admin'
      FROM public.salary_structures ss WHERE ss.employee_id = p_emp_id LIMIT 1
    ), false)
      THEN CASE extract(dow from p_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END
    ELSE 'weekday'
  END
  FROM sc
$function$
;

-- ── liff_get_applicant_meta ──(LIFF anon)
CREATE OR REPLACE FUNCTION public.liff_get_applicant_meta(p_emp_id integer)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id',              e.id,
    'name',            e.name,
    'store_name',      s.name,
    'department_name', d.name
  )
  FROM public.employees e
  LEFT JOIN public.stores      s ON s.id = e.store_id
  LEFT JOIN public.departments d ON d.id = e.department_id
  WHERE e.id = p_emp_id
  LIMIT 1
$function$
;

-- ── liff_get_store_for_employee ──(LIFF anon)
CREATE OR REPLACE FUNCTION public.liff_get_store_for_employee(p_employee_id integer)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id',                     s.id,
    'name',                   s.name,
    'lat',                    s.lat,
    'lng',                    s.lng,
    'clock_radius',           s.clock_radius,
    'allowed_wifi',           s.allowed_wifi,
    'late_tolerance_minutes', s.late_tolerance_minutes,
    'early_clock_minutes',    s.early_clock_minutes,
    'clock_in_method',        s.clock_in_method
  )
  FROM public.stores s
  JOIN public.employees e ON e.store_id = s.id
  WHERE e.id = p_employee_id
  LIMIT 1
$function$
;

-- ── liff_get_stores_for_employee ──(LIFF anon,打卡候選店/GPS)
CREATE OR REPLACE FUNCTION public.liff_get_stores_for_employee(p_employee_id integer)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_agg(
    json_build_object(
      'id',                     s.id,
      'name',                   s.name,
      'lat',                    s.lat,
      'lng',                    s.lng,
      'clock_radius',           s.clock_radius,
      'allowed_wifi',           s.allowed_wifi,
      'late_tolerance_minutes', s.late_tolerance_minutes,
      'early_clock_minutes',    s.early_clock_minutes,
      'clock_in_method',        s.clock_in_method,
      'is_primary',             (s.id = e.store_id)
    )
    ORDER BY (s.id = e.store_id) DESC, s.name
  )
  FROM public.employees e
  CROSS JOIN LATERAL (
    SELECT * FROM public.stores
     WHERE id = e.store_id
        OR name = ANY(COALESCE(e.additional_stores, '{}'::TEXT[]))
  ) s
  WHERE e.id = p_employee_id;
$function$
;

-- ── liff_resolve_line_target ──(LINE 推播目標)
CREATE OR REPLACE FUNCTION public.liff_resolve_line_target(p_emp_id integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 優先序（對齊原 JS getLineTarget）：
  --   1. status='active' 優先（不是 active 的 channel 推不出去）
  --   2. is_default 的 channel 優先（系統預設 channel）
  --   3. is_primary 的綁定優先（員工主要 LINE）
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'line_user_id', ela.line_user_id,
       'channel_code', lc.code
     )
     FROM public.employee_line_accounts ela
     JOIN public.line_channels lc ON lc.id = ela.channel_id
     WHERE ela.employee_id = p_emp_id
       AND ela.line_user_id IS NOT NULL
     ORDER BY
       CASE WHEN lc.status = 'active' THEN 0 ELSE 1 END,
       CASE WHEN lc.is_default THEN 0 ELSE 1 END,
       CASE WHEN ela.is_primary THEN 0 ELSE 1 END
     LIMIT 1),
    jsonb_build_object('line_user_id', NULL, 'channel_code', NULL)
  );
$function$
;
