-- 稽核送出改用 calc_store_audit_score 統一算分 — 2026-07-21
-- submit_store_audit 原本只算 total_deducted(且用 passed=FALSE,與前端顯示的「非bonus」公式不同源)、
--   且沒算 avg_score。改成呼叫 calc_store_audit_score(單一來源)一次算 avg_score/total_deducted/total_max_score。
-- 其餘邏輯(員工解析/草稿檢查/簽名/on_duty/簽核鏈分流)逐字保留不動。
-- 註:實務上 passed=FALSE 集合 = 非bonus扣分項(bonus恆passed=TRUE、扣分項恆passed=FALSE),
--    故 total_deducted 值不變,只是換成與畫面同源的公式 + 補寫 avg_score。

CREATE OR REPLACE FUNCTION public.submit_store_audit(p_line_user_id text DEFAULT NULL::text, p_audit_id integer DEFAULT NULL::integer, p_on_duty jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees; v_audit store_audits; v_has_chain boolean;
  r_staff record; v_idx int := 0; v_sig text;
BEGIN
  IF p_line_user_id IS NOT NULL THEN
    SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  ELSE
    SELECT * INTO emp FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  END IF;
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND'); END IF;
  IF v_audit.auditor_id IS DISTINCT FROM emp.id THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUDITOR'); END IF;
  IF v_audit.status <> '草稿' THEN RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status); END IF;
  IF p_on_duty IS NULL OR jsonb_array_length(p_on_duty) = 0 THEN RETURN json_build_object('ok', false, 'error', 'ON_DUTY_REQUIRED'); END IF;

  -- 評分制：未動的項目視為合格（不再擋未評核）
  UPDATE store_audit_items SET passed = TRUE WHERE audit_id = p_audit_id AND passed IS NULL;

  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d) LOOP
    v_sig := r_staff.d->>'signature';
    IF v_sig IS NULL OR btrim(v_sig) = '' THEN
      RETURN json_build_object('ok', false, 'error', 'SIGNATURE_REQUIRED', 'employee_name', r_staff.d->>'employee_name');
    END IF;
  END LOOP;

  DELETE FROM store_audit_on_duty WHERE audit_id = p_audit_id;
  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d) LOOP
    INSERT INTO store_audit_on_duty (audit_id, employee_id, employee_name, sort_order, confirmed, confirmed_at, signature_data_url)
    VALUES (p_audit_id, NULLIF((r_staff.d->>'employee_id'), '')::INT, r_staff.d->>'employee_name', v_idx, TRUE, NOW(), r_staff.d->>'signature');
    v_idx := v_idx + 1;
  END LOOP;

  -- ★ 分數(avg_score/total_deducted/total_max_score)統一由 calc_store_audit_score 算並寫入(單一來源)
  UPDATE store_audits SET submitted_at = NOW() WHERE id = p_audit_id;
  PERFORM public.calc_store_audit_score(p_audit_id);

  v_has_chain := v_audit.approval_chain_id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id);

  IF v_has_chain THEN
    UPDATE store_audits SET status = '申請中', current_step = 0 WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'status', '申請中', 'event', 'submitted_to_chain');
  ELSE
    UPDATE store_audits SET status = '待確認' WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'status', '待確認', 'event', 'submitted_to_on_duty');
  END IF;
END $function$;

NOTIFY pgrst, 'reload schema';
