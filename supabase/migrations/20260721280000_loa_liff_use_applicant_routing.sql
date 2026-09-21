-- loa 留停:LIFF 送單改吃身分別分流(甲案,對齊離職) — 2026-07-21
-- liff_upsert_loa INSERT 原本用 category='留停'抓 #13 留停專屬鏈,與 form_chain_configs
-- (剛設 manager→#31/staff→#32/store_staff→#45)不一致 → 手機#13、web分流。
-- 甲案統一走身分別:INSERT 改插 NULL,由 _auto_apply_hr_form_chain('loa') trigger 依身分解鏈,
-- 與離職一致(離職已於 create_resignation_request 走同模式)。v_chain 上方 SELECT 成 dead code(無害)。

CREATE OR REPLACE FUNCTION public.liff_upsert_loa(p_line_user_id text, p_id integer, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp     employees;
  v_chain int;
  new_id  int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'employee not found' USING ERRCODE = '22023';
  END IF;

  -- 找這個 org 的 留停 簽核鏈
  SELECT id INTO v_chain FROM public.approval_chains
   WHERE category = '留停'
     AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
   ORDER BY id DESC LIMIT 1;

  IF p_id IS NULL THEN
    INSERT INTO public.leave_of_absence_requests (
      employee_id, organization_id,
      start_date, planned_end_date,
      reason_type, reason_detail,
      status, approval_chain_id, current_step
    )
    VALUES (
      emp.id, emp.organization_id,
      (p_payload->>'start_date')::date,
      (p_payload->>'planned_end_date')::date,
      p_payload->>'reason_type',
      NULLIF(p_payload->>'reason_detail', ''),
      '申請中', NULL, 0  -- ★甲案:鏈交給 _auto_apply_hr_form_chain('loa') trigger 依身分別(form_chain_configs #31/#32/#45)解,不用上面 category='留停'→#13
    )
    RETURNING id INTO new_id;
  ELSE
    UPDATE public.leave_of_absence_requests SET
      start_date       = (p_payload->>'start_date')::date,
      planned_end_date = (p_payload->>'planned_end_date')::date,
      reason_type      = p_payload->>'reason_type',
      reason_detail    = NULLIF(p_payload->>'reason_detail', ''),
      -- 編輯重送時清掉駁回原因 + 重設 chain 起點
      reject_reason    = NULL,
      status           = '申請中',
      current_step     = 0
    WHERE id = p_id AND employee_id = emp.id
    RETURNING id INTO new_id;
  END IF;

  RETURN json_build_object('id', new_id);
END $function$;

NOTIFY pgrst, 'reload schema';
