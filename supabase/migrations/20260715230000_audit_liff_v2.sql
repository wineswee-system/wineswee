-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核 LIFF Phase 2 — 對齊新版評分制 — 2026-07-15
--   1. liff_get_store_audit_detail：items 回傳新欄位(relation_group/group_allot/
--      is_star/input_type/group_note)；audit 已含 photos/avg_score(row_to_json)
--   2. liff_update_store_audit_item：DROP 4 個舊 overload → 建一支乾淨的
--      (扣分/群組說明/打字內容)；扣分即時 clamp 群組配分、重算 avg_score
--   3. submit_store_audit：line_user_id 可空(web 用 auth.uid())；移除未評核擋關；
--      送出前未動項目自動當合格
--   4. liff_save_store_audit_photos：整張單共用照片(草稿+稽核員)
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. 明細：items 補新欄位 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_store_audit_detail(p_line_user_id text, p_audit_id integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  emp employees; v_audit store_audits; v_items json; v_on_duty json;
  v_step approval_chain_steps;
  v_can_see_all boolean := false; v_can_confirm boolean := false;
  v_can_approve boolean := false; v_is_related boolean := false;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT public.liff_employee_has_permission(emp.id, 'liff.store_audit.view_all') INTO v_can_see_all;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id AND organization_id = emp.organization_id;
  IF v_audit.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND'); END IF;

  IF NOT v_can_see_all THEN
    SELECT (
      v_audit.auditor_id = emp.id
      OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = v_audit.id AND od.employee_id = emp.id)
      OR (v_audit.status = '申請中' AND v_audit.approval_chain_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM approval_chain_steps acs
             WHERE acs.chain_id = v_audit.approval_chain_id AND acs.step_order = v_audit.current_step
               AND public._employee_matches_chain_step(emp.id::int, acs.id::int, v_audit.auditor_id::int, FALSE)))
    ) INTO v_is_related;
    IF NOT v_is_related THEN RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  END IF;

  SELECT json_agg(json_build_object(
    'id', id, 'category_code', category_code, 'category_name', category_name,
    'relation_group', relation_group, 'group_allot', group_allot,
    'is_star', is_star, 'input_type', input_type, 'group_note', group_note,
    'item_no', item_no, 'item_text', item_text, 'deduct_score', deduct_score,
    'passed', passed, 'remark', remark
  ) ORDER BY
    CASE category_code WHEN '一' THEN 1 WHEN '二' THEN 2 WHEN '三' THEN 3
      WHEN '四' THEN 4 WHEN '五' THEN 5 WHEN '六' THEN 6 ELSE 99 END,
    item_no
  ) INTO v_items FROM store_audit_items WHERE audit_id = p_audit_id;

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
      v_can_approve := public._employee_matches_chain_step(emp.id::int, v_step.id::int, v_audit.auditor_id::int, FALSE);
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'audit', row_to_json(v_audit),
    'items', COALESCE(v_items, '[]'::json), 'on_duty', COALESCE(v_on_duty, '[]'::json),
    'can_confirm', v_can_confirm, 'can_approve', v_can_approve);
END $function$;

-- ─── 2. 更新項目：DROP 4 舊 overload → 建乾淨版(評分制) ──────────────────────
DROP FUNCTION IF EXISTS public.liff_update_store_audit_item(text, integer, boolean, integer);
DROP FUNCTION IF EXISTS public.liff_update_store_audit_item(text, integer, boolean, integer, text);
DROP FUNCTION IF EXISTS public.liff_update_store_audit_item(text, integer, boolean, integer, text, jsonb);
DROP FUNCTION IF EXISTS public.liff_update_store_audit_item(text, integer, boolean, integer, text, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.liff_update_store_audit_item(
  p_line_user_id text, p_item_id integer,
  p_deduct_score integer DEFAULT NULL, p_group_note text DEFAULT NULL, p_remark text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  emp employees; v_item store_audit_items; v_audit store_audits;
  v_other int; v_ded int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_item FROM store_audit_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'ITEM_NOT_FOUND'); END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = v_item.audit_id;
  IF v_audit.status <> '草稿' THEN RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status); END IF;
  IF v_audit.auditor_id IS DISTINCT FROM emp.id THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUDITOR'); END IF;

  IF p_deduct_score IS NOT NULL THEN
    v_ded := GREATEST(0, p_deduct_score);
    -- clamp：同群組其他項已扣 + 本項 ≤ 群組配分
    SELECT COALESCE(SUM(deduct_score), 0) INTO v_other FROM store_audit_items
      WHERE audit_id = v_item.audit_id
        AND relation_group IS NOT DISTINCT FROM v_item.relation_group
        AND id <> p_item_id;
    IF v_ded > COALESCE(v_item.group_allot, 0) - v_other THEN
      v_ded := GREATEST(0, COALESCE(v_item.group_allot, 0) - v_other);
    END IF;
    UPDATE store_audit_items SET deduct_score = v_ded, passed = (v_ded = 0) WHERE id = p_item_id;
  END IF;

  IF p_group_note IS NOT NULL THEN UPDATE store_audit_items SET group_note = p_group_note WHERE id = p_item_id; END IF;
  IF p_remark    IS NOT NULL THEN UPDATE store_audit_items SET remark = p_remark WHERE id = p_item_id; END IF;

  -- 重算 total_deducted + avg_score(每大類 100 - 扣分,6 類平均)
  UPDATE store_audits SET
    total_deducted = COALESCE((SELECT SUM(deduct_score) FROM store_audit_items WHERE audit_id = v_item.audit_id), 0),
    avg_score = COALESCE((
      SELECT ROUND(AVG(GREATEST(0, 100 - cat_ded)), 2)
      FROM (SELECT category_code, SUM(deduct_score) AS cat_ded
              FROM store_audit_items WHERE audit_id = v_item.audit_id GROUP BY category_code) c
    ), 0)
  WHERE id = v_item.audit_id;

  RETURN json_build_object('ok', true);
END $function$;

-- ─── 3. submit：web(auth.uid) + LIFF(line) 共用；移除未評核擋關；自動補合格 ──
CREATE OR REPLACE FUNCTION public.submit_store_audit(
  p_line_user_id text DEFAULT NULL, p_audit_id integer DEFAULT NULL, p_on_duty jsonb DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  UPDATE store_audits SET
    total_deducted = COALESCE((SELECT SUM(deduct_score) FROM store_audit_items WHERE audit_id = p_audit_id AND passed = FALSE), 0),
    submitted_at = NOW()
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
END $function$;

-- ─── 4. 整張單共用照片(LIFF) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_save_store_audit_photos(
  p_line_user_id text, p_audit_id integer, p_photos jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees; v_audit store_audits;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND'); END IF;
  IF v_audit.status <> '草稿' THEN RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT'); END IF;
  IF v_audit.auditor_id IS DISTINCT FROM emp.id THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUDITOR'); END IF;
  UPDATE store_audits SET photos = COALESCE(p_photos, '[]'::jsonb) WHERE id = p_audit_id;
  RETURN json_build_object('ok', true);
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_save_store_audit_photos(text, integer, jsonb) TO anon, authenticated;

-- ─── 5. 清單回傳 avg_score(總平均) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_store_audits(p_line_user_id text, p_limit integer DEFAULT 50)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees; v_can_see_all boolean := FALSE; v_list json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT public.liff_employee_has_permission(emp.id, 'liff.store_audit.view_all') INTO v_can_see_all;

  SELECT json_agg(row_to_json(t) ORDER BY t.audit_date DESC, t.id DESC) INTO v_list
  FROM (
    SELECT DISTINCT
      sa.id, sa.store_name, sa.audit_date, sa.shift, sa.status,
      sa.auditor_name, sa.total_deducted, sa.total_max_score, sa.avg_score,
      sa.approval_chain_id, sa.current_step,
      CASE
        WHEN sa.auditor_id = emp.id THEN 'auditor'
        WHEN EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id) THEN 'on_duty'
        ELSE 'approver'
      END AS my_role,
      (sa.status = '申請中' AND sa.approval_chain_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM approval_chain_steps acs
          WHERE acs.chain_id = sa.approval_chain_id AND acs.step_order = sa.current_step
            AND public._employee_matches_chain_step(emp.id::int, acs.id::int, sa.auditor_id::int, FALSE))) AS need_my_approve
    FROM store_audits sa
    WHERE sa.organization_id = emp.organization_id
      AND (v_can_see_all OR sa.auditor_id = emp.id
        OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id)
        OR (sa.status = '申請中' AND sa.approval_chain_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM approval_chain_steps acs
               WHERE acs.chain_id = sa.approval_chain_id AND acs.step_order = sa.current_step
                 AND public._employee_matches_chain_step(emp.id::int, acs.id::int, sa.auditor_id::int, FALSE))))
    ORDER BY sa.audit_date DESC, sa.id DESC
    LIMIT p_limit
  ) t;

  RETURN json_build_object('ok', true, 'list', COALESCE(v_list, '[]'::json));
END $function$;

NOTIFY pgrst, 'reload schema';
