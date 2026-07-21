-- 修:LIFF 出差送單漏帶 employee_id — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- 根因:liff_upsert_business_trip 已解出 emp(整筆員工列,emp.id 在手),INSERT 卻只寫
--   employee(名字)不寫 employee_id → 每張 LIFF 出差單 employee_id=NULL。
--   後果(對齊 feedback_form_create_must_set_employee_id):
--     1. can_see_request(NULL) 一律回 false → 出差列表/簽核中心/本人 全都看不到(隱形)
--     2. _auto_apply_hr_form_chain 判不出申請人身分 → 分錯簽核鏈
--        (張庭瑋是經理卻被塞 #32 行政鏈,應走 #31 主管鏈)
--   實證:trip #8(張庭瑋,7/17,LIFF送,budget=NULL)emp_id=NULL、chain=32、卡死隱形;
--        對照同人 trip #6(7/6,web送)emp_id=62、chain=31 正常。
--   其餘 LIFF 送單(請假/加班/補打卡/費用)皆有帶 employee_id,僅此支漏。
-- 修:INSERT + UPDATE 都補 employee_id = emp.id(逐字重現 live 定義,只加該欄)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_upsert_business_trip(p_line_user_id text, p_id integer, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.business_trips (
      employee, employee_id, destination, start_date, end_date, purpose, organization_id
    )
    VALUES (
      emp.name,
      emp.id,                                    -- ★ 補:員工 id(供可見性 + 簽核鏈分類)
      p_payload->>'destination',
      (p_payload->>'start_date')::date,
      (p_payload->>'end_date')::date,
      p_payload->>'purpose',
      emp.organization_id
    )
    RETURNING id INTO new_id;
  ELSE
    UPDATE public.business_trips SET
      employee_id = emp.id,                      -- ★ 補:編輯/重送時一併補上(修既有 NULL)
      destination = p_payload->>'destination',
      start_date  = (p_payload->>'start_date')::date,
      end_date    = (p_payload->>'end_date')::date,
      purpose     = p_payload->>'purpose'
    WHERE id = p_id AND employee = emp.name
    RETURNING id INTO new_id;
  END IF;

  RETURN json_build_object('id', new_id);
END $function$;

NOTIFY pgrst, 'reload schema';
