-- ════════════════════════════════════════════════════════════════════════════
-- 修:LIFF 經常性費用送出 — INSERT 補 organization_id + employee_id
-- 2026-06-25
--
-- liff_upsert_expense 的 INSERT 沒帶 organization_id → auto-apply 簽核鏈 trigger
-- (_auto_apply_hr_form_chain) 看到 org IS NULL 直接 return 不套鏈 → approval_chain_id 留 null
-- → guard trg_z_guard_chain_required 擋掉 → LIFF 跳「尚未設定費用報銷簽核鏈」送不出。
-- 也順手補 employee_id(record 完整 + 跟 web 一致)。
--
-- 只動 INSERT 欄位,UPDATE 分支不變。idempotent(CREATE OR REPLACE)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_upsert_expense(p_line_user_id text, p_id integer, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees; new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.expenses (
      employee, employee_id, date, category, amount, description, status, organization_id
    ) VALUES (
      emp.name,
      emp.id,
      (p_payload->>'date')::date,
      p_payload->>'category',
      (p_payload->>'amount')::numeric,
      p_payload->>'description',
      COALESCE(p_payload->>'status', '待核銷'),
      emp.organization_id
    ) RETURNING id INTO new_id;
  ELSE
    UPDATE public.expenses SET
      date = (p_payload->>'date')::date,
      category = p_payload->>'category',
      amount = (p_payload->>'amount')::numeric,
      description = p_payload->>'description'
    WHERE id = p_id AND employee = emp.name
    RETURNING id INTO new_id;
  END IF;
  RETURN json_build_object('id', new_id);
END $function$;
