-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核 — 當班人員現場簽名（canvas）取代事後 LINE 確認
-- ────────────────────────────────────────────────────────────────────────────
-- 變更：
--   1. store_audit_on_duty 新增 signature_data_url（base64 PNG，現場簽名圖）
--   2. submit_store_audit 改：要求每位當班人員都有簽名
--      送出後直接跳過「待確認」狀態，依 chain 設定走「申請中」or「已核准」
--   3. liff_get_store_audit_detail 回傳簽名 URL（讓 LIFF 詳情頁顯示）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 加簽名欄位 ──────────────────────────────────────────────────────────
ALTER TABLE public.store_audit_on_duty
  ADD COLUMN IF NOT EXISTS signature_data_url TEXT;


-- ─── 2. submit_store_audit 改：要求簽名 + 跳過「待確認」 ──────────────────
-- p_on_duty 結構改為：
--   [{"employee_id":1,"employee_name":"張三","signature":"data:image/png;base64,..."}]
CREATE OR REPLACE FUNCTION public.submit_store_audit(
  p_audit_id  INT,
  p_on_duty   JSONB DEFAULT '[]'::jsonb
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_audit       store_audits;
  v_count       INT;
  r_staff       record;
  v_idx         INT := 0;
  v_has_chain   BOOLEAN;
  v_emp         employees;
  v_sig         TEXT;
BEGIN
  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;

  IF v_audit.status <> '草稿' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status);
  END IF;

  IF p_on_duty IS NULL OR jsonb_array_length(p_on_duty) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ON_DUTY_REQUIRED');
  END IF;

  -- 至少要評核完成（任何項目都 NULL 表示未評核）
  SELECT COUNT(*) INTO v_count FROM store_audit_items WHERE audit_id = p_audit_id AND passed IS NULL;
  IF v_count > 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ITEMS_NOT_EVALUATED', 'pending_count', v_count);
  END IF;

  -- 檢查每位當班人員都有簽名
  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d) LOOP
    v_sig := r_staff.d->>'signature';
    IF v_sig IS NULL OR v_sig = '' OR length(v_sig) < 100 THEN
      RETURN json_build_object('ok', false, 'error', 'SIGNATURE_REQUIRED',
        'employee_name', r_staff.d->>'employee_name');
    END IF;
  END LOOP;

  -- 重寫 on_duty（先清掉舊的）
  DELETE FROM store_audit_on_duty WHERE audit_id = p_audit_id;
  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d) LOOP
    INSERT INTO store_audit_on_duty (audit_id, employee_id, employee_name, sort_order, confirmed, confirmed_at, signature_data_url)
    VALUES (
      p_audit_id,
      NULLIF((r_staff.d->>'employee_id'), '')::INT,
      r_staff.d->>'employee_name',
      v_idx,
      TRUE,                              -- 簽名即視為已確認
      NOW(),
      r_staff.d->>'signature'
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- 算扣分
  UPDATE store_audits SET
    total_deducted = COALESCE((SELECT SUM(deduct_score) FROM store_audit_items WHERE audit_id = p_audit_id AND passed = FALSE), 0),
    submitted_at   = NOW()
  WHERE id = p_audit_id;

  -- 有 chain → 直接進「申請中」；無 chain → 直接「已核准」
  v_has_chain := v_audit.approval_chain_id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id);

  IF v_has_chain THEN
    UPDATE store_audits SET status = '申請中', current_step = 0 WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'status', '申請中', 'event', 'submitted_to_chain');
  ELSE
    SELECT * INTO v_emp FROM employees WHERE id = v_audit.auditor_id;
    UPDATE store_audits SET status = '已核准', approved_at = NOW(), approver = v_emp.name WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'auto_approved_no_chain');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_store_audit(INT, JSONB) TO authenticated;


-- ─── 3. liff_get_store_audit_detail 回傳簽名 URL ──────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_store_audit_detail(
  p_line_user_id text,
  p_audit_id     int
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_audit    store_audits;
  v_items    json;
  v_on_duty  json;
  v_step     approval_chain_steps;
  v_can_confirm boolean := false;
  v_can_approve boolean := false;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;

  SELECT json_agg(json_build_object(
    'id', id, 'category_code', category_code, 'category_name', category_name,
    'item_no', item_no, 'item_text', item_text, 'deduct_score', deduct_score,
    'passed', passed,
    'responsible_employee_id', responsible_employee_id,
    'responsible_employee_name', responsible_employee_name
  ) ORDER BY category_code, item_no) INTO v_items
  FROM store_audit_items WHERE audit_id = p_audit_id;

  SELECT json_agg(json_build_object(
    'employee_id', employee_id, 'employee_name', employee_name,
    'confirmed', confirmed, 'confirmed_at', confirmed_at,
    'signature_data_url', signature_data_url
  ) ORDER BY sort_order) INTO v_on_duty
  FROM store_audit_on_duty WHERE audit_id = p_audit_id;

  IF v_audit.status = '申請中' AND v_audit.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
    IF v_step.id IS NOT NULL THEN
      v_can_approve := public._employee_matches_chain_step(emp.id, v_step.id, v_audit.auditor_id);
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'audit', row_to_json(v_audit),
    'items', COALESCE(v_items, '[]'::json),
    'on_duty', COALESCE(v_on_duty, '[]'::json),
    'can_confirm', v_can_confirm,
    'can_approve', v_can_approve
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_store_audit_detail(text, int) TO authenticated, anon;


-- ─── 4. LIFF 列表 RPC：使用者相關的稽核 ─────────────────────────────────────
-- 回傳：當班過的 + 簽核中需要我簽的
CREATE OR REPLACE FUNCTION public.liff_list_store_audits(
  p_line_user_id text,
  p_limit        int DEFAULT 30
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_list json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 當班 + 簽核中需簽 + 我發起的（auditor）
  SELECT json_agg(row_to_json(t) ORDER BY t.audit_date DESC, t.id DESC) INTO v_list
  FROM (
    SELECT DISTINCT
      sa.id, sa.store_name, sa.audit_date, sa.shift, sa.status,
      sa.auditor_name, sa.total_deducted, sa.total_max_score,
      sa.approval_chain_id, sa.current_step,
      CASE
        WHEN sa.auditor_id = emp.id THEN 'auditor'
        WHEN EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id) THEN 'on_duty'
        ELSE 'approver'
      END AS my_role,
      (sa.status = '申請中'
       AND sa.approval_chain_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM approval_chain_steps acs
          WHERE acs.chain_id = sa.approval_chain_id
            AND acs.step_order = sa.current_step
            AND public._employee_matches_chain_step(emp.id, acs.id, sa.auditor_id)
       )) AS need_my_approve
    FROM store_audits sa
    WHERE sa.organization_id = emp.organization_id
      AND (
        sa.auditor_id = emp.id
        OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id)
        OR (sa.status = '申請中'
            AND sa.approval_chain_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM approval_chain_steps acs
               WHERE acs.chain_id = sa.approval_chain_id
                 AND acs.step_order = sa.current_step
                 AND public._employee_matches_chain_step(emp.id, acs.id, sa.auditor_id)
            ))
      )
    ORDER BY sa.audit_date DESC, sa.id DESC
    LIMIT p_limit
  ) t;

  RETURN json_build_object('ok', true, 'list', COALESCE(v_list, '[]'::json));
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_store_audits(text, int) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
