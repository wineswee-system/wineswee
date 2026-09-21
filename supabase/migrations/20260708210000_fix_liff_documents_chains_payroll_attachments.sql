-- Tier2 修:documents 欄 drift / 簽核鏈欄改名 / 薪資 GROUP BY / 附件型別 — 2026-07-08
-- 全部已對 live schema 驗證。idempotent。

-- 1) documents:url/notes 欄被 drift 掉 → 補回。
--    主系統 src/pages/hr/Documents.jsx 上傳就寫這兩欄 → 現在主系統上傳也是壞的;
--    liff_list_documents 也讀這兩欄。補回一次修好兩邊。純加法。
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS url   text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS notes text;

-- 2) liff_list_approval_chains:approval_chains.steps 已改名 steps_legacy_jsonb
CREATE OR REPLACE FUNCTION public.liff_list_approval_chains(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', c.id,
      'name', c.name,
      'description', c.description,
      'steps_count', COALESCE(jsonb_array_length(c.steps_legacy_jsonb), 0)
    ) ORDER BY c.name)
    FROM public.approval_chains c
    WHERE (c.organization_id IS NULL OR c.organization_id = emp.organization_id)
  ), '[]'::json);
END $function$;

-- 3) liff_get_my_payroll_records:原本在 aggregate 查詢外層 ORDER BY/LIMIT 非聚合欄 → 42803。
--    改成先子查詢 ORDER BY+LIMIT,再 json_agg。
CREATE OR REPLACE FUNCTION public.liff_get_my_payroll_records(p_line_user_id text, p_limit integer DEFAULT 6)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'records', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                          sub.id,
        'pay_period',                  sub.pay_period,
        'base_salary',                 sub.base_salary,
        'role_allowance',              sub.role_allowance,
        'meal_allowance',              sub.meal_allowance,
        'transport_allowance',         sub.transport_allowance,
        'attendance_bonus_earned',     sub.attendance_bonus_earned,
        'overtime_pay',                sub.overtime_pay,
        'custom_allowances_total',     sub.custom_allowances_total,
        'custom_allowances_breakdown', sub.custom_allowances_breakdown,
        'gross_salary',                sub.gross_salary,
        'leave_deduction',             sub.leave_deduction,
        'late_deduction',              sub.late_deduction,
        'labor_ins_employee',          sub.labor_ins_employee,
        'health_ins_employee',         sub.health_ins_employee,
        'legal_deduction_total',       sub.legal_deduction_total,
        'legal_deduction_breakdown',   sub.legal_deduction_breakdown,
        'total_deductions',            sub.total_deductions,
        'net_salary',                  sub.net_salary
      ) ORDER BY sub.pay_period DESC), '[]'::json)
      FROM (
        SELECT * FROM public.payroll_records pr
        WHERE pr.employee_id = emp.id
        ORDER BY pr.pay_period DESC
        LIMIT p_limit
      ) sub
    )
  );
END $function$;

-- 4) 附件欄是 text[],原本塞 jsonb → 型別錯。轉成 text[]。
CREATE OR REPLACE FUNCTION public.liff_set_expense_attachments(p_line_user_id text, p_id integer, p_urls jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  UPDATE public.expenses
     SET attachments = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_urls, '[]'::jsonb)))
   WHERE id = p_id AND employee_id = emp.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense % not found or not owned', p_id; END IF;
  RETURN json_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.liff_set_leave_attachments(p_line_user_id text, p_id integer, p_urls jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  UPDATE public.leave_requests
     SET attachments = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_urls, '[]'::jsonb)))
   WHERE id = p_id AND employee_id = emp.id;   -- 只能改本人的單
  IF NOT FOUND THEN RAISE EXCEPTION 'leave request % not found or not owned', p_id; END IF;
  RETURN json_build_object('ok', true);
END $function$;

NOTIFY pgrst, 'reload schema';
