-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核第三態：三角形（△）
-- 2026-07-01
--
-- 需求：稽核項目除了 合格/不合格，多一個「△ 三角形」按鈕（紫色）
--   Q1 label：都不用（只顯示 △）
--   Q2 扣分：完全不扣分（純視覺標註）
--   Q3 展開欄位：不用（不開責任人/備註/附件）
--
-- 三態欄位設計：
--   passed=TRUE,  partial=FALSE → 合格 ✓（綠）
--   passed=FALSE, partial=FALSE → 不合格 ✗（紅、扣 deduct_score）
--   passed=NULL,  partial=TRUE  → 三角形 △（紫、不扣分）
--   passed=NULL,  partial=FALSE → 未評核（原本行為）
--
-- 涉及物件：
--   1. store_audit_items 加 partial 欄位
--   2. liff_get_store_audit_detail 回傳 partial
--   3. liff_update_store_audit_item 加 p_partial 參數（三選一互斥邏輯）
--   4. submit_store_audit 未評核檢查改成 (passed IS NULL AND NOT partial)
--      → △ 不會被當成未評核擋住送出
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 加欄位（idempotent）═══
ALTER TABLE public.store_audit_items
  ADD COLUMN IF NOT EXISTS partial BOOLEAN NOT NULL DEFAULT FALSE;

-- ═══ 2. liff_get_store_audit_detail 回傳 partial ═══
CREATE OR REPLACE FUNCTION public.liff_get_store_audit_detail(
  p_line_user_id text,
  p_audit_id     int
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_audit       store_audits;
  v_items       json;
  v_on_duty     json;
  v_step        approval_chain_steps;
  v_can_see_all boolean := false;
  v_can_confirm boolean := false;
  v_can_approve boolean := false;
  v_is_related  boolean := false;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT public.liff_employee_has_permission(emp.id, 'liff.store_audit.view_all')
    INTO v_can_see_all;

  SELECT * INTO v_audit FROM store_audits
   WHERE id = p_audit_id AND organization_id = emp.organization_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;

  IF NOT v_can_see_all THEN
    SELECT (
      v_audit.auditor_id = emp.id
      OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = v_audit.id AND od.employee_id = emp.id)
      OR (v_audit.status = '申請中' AND v_audit.approval_chain_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM approval_chain_steps acs
             WHERE acs.chain_id = v_audit.approval_chain_id
               AND acs.step_order = v_audit.current_step
               AND public._employee_matches_chain_step(emp.id::int, acs.id::int, v_audit.auditor_id::int, FALSE)
          ))
    ) INTO v_is_related;
    IF NOT v_is_related THEN
      RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  SELECT json_agg(json_build_object(
    'id', id, 'category_code', category_code, 'category_name', category_name,
    'item_no', item_no, 'item_text', item_text, 'deduct_score', deduct_score,
    'passed', passed,
    'partial', partial,                         -- ★ 新
    'responsible_employee_id', responsible_employee_id,
    'responsible_employee_name', responsible_employee_name,
    'remark', remark,
    'attachments', COALESCE(attachments, '[]'::jsonb)
  ) ORDER BY
    CASE category_code
      WHEN '一' THEN 1 WHEN '二' THEN 2 WHEN '三' THEN 3
      WHEN '四' THEN 4 WHEN '五' THEN 5 WHEN '六' THEN 6
      ELSE 99
    END,
    item_no
  ) INTO v_items
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
      v_can_approve := public._employee_matches_chain_step(
        emp.id::int, v_step.id::int, v_audit.auditor_id::int, FALSE
      );
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

GRANT EXECUTE ON FUNCTION public.liff_get_store_audit_detail(text, int)
  TO authenticated, anon;

-- ═══ 3. liff_update_store_audit_item 加 p_partial（7-param 版）═══
-- 三選一互斥：p_partial=TRUE → 按 △，強制 passed=NULL、partial=TRUE
--            p_partial=FALSE → 按合格/不合格，強制 partial=FALSE
--            p_partial=NULL   → 舊行為（相容 6-param client）
CREATE OR REPLACE FUNCTION public.liff_update_store_audit_item(
  p_line_user_id text,
  p_item_id      int,
  p_passed       boolean DEFAULT NULL,
  p_responsible_employee_id int DEFAULT NULL,
  p_remark       text    DEFAULT NULL,
  p_attachments  jsonb   DEFAULT NULL,
  p_partial      boolean DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_item     store_audit_items;
  v_audit    store_audits;
  v_resp_name text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_item FROM store_audit_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ITEM_NOT_FOUND');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = v_item.audit_id;
  IF v_audit.status <> '草稿' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status);
  END IF;
  IF v_audit.auditor_id IS DISTINCT FROM emp.id THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUDITOR');
  END IF;

  IF p_responsible_employee_id IS NOT NULL THEN
    SELECT name INTO v_resp_name FROM employees WHERE id = p_responsible_employee_id;
  END IF;

  IF p_partial = TRUE THEN
    -- 按 △：清 passed、清責任人、設 partial=TRUE
    UPDATE store_audit_items SET
      passed  = NULL,
      partial = TRUE,
      responsible_employee_id   = NULL,
      responsible_employee_name = NULL,
      remark      = CASE WHEN p_remark IS NOT NULL THEN p_remark ELSE remark END,
      attachments = CASE WHEN p_attachments IS NOT NULL THEN p_attachments ELSE attachments END
    WHERE id = p_item_id;
  ELSIF p_partial = FALSE THEN
    -- 按合格/不合格：明確清 partial=FALSE
    UPDATE store_audit_items SET
      passed  = COALESCE(p_passed, passed),
      partial = FALSE,
      responsible_employee_id   = CASE WHEN p_responsible_employee_id IS NOT NULL THEN p_responsible_employee_id ELSE responsible_employee_id END,
      responsible_employee_name = CASE WHEN p_responsible_employee_id IS NOT NULL THEN v_resp_name ELSE responsible_employee_name END,
      remark      = CASE WHEN p_remark IS NOT NULL THEN p_remark ELSE remark END,
      attachments = CASE WHEN p_attachments IS NOT NULL THEN p_attachments ELSE attachments END
    WHERE id = p_item_id;
    IF p_passed = TRUE THEN
      UPDATE store_audit_items SET
        responsible_employee_id = NULL,
        responsible_employee_name = NULL
      WHERE id = p_item_id;
    END IF;
  ELSE
    -- p_partial 沒傳（舊 6-param client）：舊行為
    UPDATE store_audit_items SET
      passed = COALESCE(p_passed, passed),
      responsible_employee_id   = CASE WHEN p_responsible_employee_id IS NOT NULL THEN p_responsible_employee_id ELSE responsible_employee_id END,
      responsible_employee_name = CASE WHEN p_responsible_employee_id IS NOT NULL THEN v_resp_name ELSE responsible_employee_name END,
      remark      = CASE WHEN p_remark IS NOT NULL THEN p_remark ELSE remark END,
      attachments = CASE WHEN p_attachments IS NOT NULL THEN p_attachments ELSE attachments END
    WHERE id = p_item_id;
    IF p_passed = TRUE THEN
      UPDATE store_audit_items SET
        responsible_employee_id = NULL,
        responsible_employee_name = NULL
      WHERE id = p_item_id;
    END IF;
  END IF;

  RETURN json_build_object('ok', true);
END $$;

-- 三個簽名版 GRANT（新 7、舊 6、更舊 5，讓所有 client 都能跑）
GRANT EXECUTE ON FUNCTION public.liff_update_store_audit_item(text, int, boolean, int, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.liff_update_store_audit_item(text, int, boolean, int, text, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.liff_update_store_audit_item(text, int, boolean, int, text, jsonb, boolean) TO authenticated, anon;

-- ═══ 4. submit_store_audit：△ 不算未評核 ═══
-- 直接 CREATE OR REPLACE 全文（比照 20260522070000 版本，只改 pending 檢查那條 WHERE）
CREATE OR REPLACE FUNCTION public.submit_store_audit(
  p_line_user_id text,
  p_audit_id     int,
  p_on_duty      jsonb
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_audit       store_audits;
  v_count       int;
  v_has_chain   boolean;
  r_staff       record;
  v_idx         int := 0;
  v_sig         text;
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

  IF p_on_duty IS NULL OR jsonb_array_length(p_on_duty) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ON_DUTY_REQUIRED');
  END IF;

  -- ★ 未評核檢查：passed IS NULL AND NOT partial（△ 算已評，不擋送出）
  SELECT COUNT(*) INTO v_count FROM store_audit_items
   WHERE audit_id = p_audit_id AND passed IS NULL AND NOT partial;
  IF v_count > 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ITEMS_NOT_EVALUATED', 'pending_count', v_count);
  END IF;

  -- 驗證每位都有簽名
  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d) LOOP
    v_sig := r_staff.d->>'signature';
    IF v_sig IS NULL OR btrim(v_sig) = '' THEN
      RETURN json_build_object('ok', false, 'error', 'SIGNATURE_REQUIRED',
        'employee_name', r_staff.d->>'employee_name');
    END IF;
  END LOOP;

  DELETE FROM store_audit_on_duty WHERE audit_id = p_audit_id;
  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d) LOOP
    INSERT INTO store_audit_on_duty (audit_id, employee_id, employee_name, sort_order, confirmed, confirmed_at, signature_data_url)
    VALUES (
      p_audit_id,
      NULLIF((r_staff.d->>'employee_id'), '')::INT,
      r_staff.d->>'employee_name',
      v_idx,
      TRUE,
      NOW(),
      r_staff.d->>'signature'
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- total_deducted 只算 passed=FALSE（△ 完全不扣分）
  UPDATE store_audits SET
    total_deducted = COALESCE(
      (SELECT SUM(deduct_score) FROM store_audit_items
        WHERE audit_id = p_audit_id AND passed = FALSE),
      0),
    submitted_at   = NOW()
  WHERE id = p_audit_id;

  v_has_chain := v_audit.approval_chain_id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id);

  IF v_has_chain THEN
    UPDATE store_audits SET status = '申請中', current_step = 0 WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'status', '申請中', 'event', 'submitted_to_chain');
  ELSE
    UPDATE store_audits SET status = '待確認' WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'status', '待確認', 'event', 'submitted_to_on_duty');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_store_audit(text, int, jsonb) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
