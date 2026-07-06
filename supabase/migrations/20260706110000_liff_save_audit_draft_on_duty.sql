-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核草稿：即時保存當班人員 + 簽名（草稿階段就存 DB，重開不消失）
-- 2026-07-06
--
-- 問題：LIFF 草稿的當班人員/簽名只在前端 state（draftOnDuty），只有「送出」時才
--   存進 store_audit_on_duty。草稿階段簽了名、關掉重開 → 簽名全不見（DB 0 筆）。
--
-- 解法：新增草稿專用 upsert RPC。草稿階段每次改當班人員/簽名就呼叫存 DB。
--   跟 submit_store_audit 不同：不驗證評分/簽名完整性、不推進 chain，允許不完整
--   （草稿本來就可以只填一半）。重開時 liff_get_store_audit_detail 會回 on_duty
--   → 前端載回（含簽名 URL）。
--
-- 只在 status='草稿' + 呼叫者是 auditor 才允許。DELETE+INSERT 整組覆寫。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_save_audit_draft_on_duty(
  p_line_user_id text,
  p_audit_id     int,
  p_on_duty      jsonb
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp      employees;
  v_audit  store_audits;
  r_staff  record;
  v_sort   int := 0;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;
  IF v_audit.auditor_id IS DISTINCT FROM emp.id THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUDITOR');
  END IF;
  IF v_audit.status <> '草稿' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status);
  END IF;

  -- 整組覆寫（草稿允許不完整：沒選員工的空列跳過、沒簽名的存 null）
  DELETE FROM store_audit_on_duty WHERE audit_id = p_audit_id;
  FOR r_staff IN SELECT * FROM jsonb_array_elements(COALESCE(p_on_duty, '[]'::jsonb)) AS x(d) LOOP
    CONTINUE WHEN (r_staff.d->>'employee_id') IS NULL OR (r_staff.d->>'employee_id') = '';
    INSERT INTO store_audit_on_duty
      (audit_id, employee_id, employee_name, sort_order, confirmed, signature_data_url)
    VALUES
      (p_audit_id, (r_staff.d->>'employee_id')::int, r_staff.d->>'employee_name',
       v_sort, false, NULLIF(btrim(COALESCE(r_staff.d->>'signature','')), ''));
    v_sort := v_sort + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'saved', v_sort);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_save_audit_draft_on_duty(text, int, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
