-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核系統 — 送出/當班確認/簽核鏈 RPC
-- ────────────────────────────────────────────────────────────────────────────
-- 提供四支 RPC：
--   1. submit_store_audit         — 草稿 → 待確認（並寫入當班人員清單）
--   2. confirm_store_audit_on_duty — 當班人員確認/退回
--   3. web_approve_store_audit    — 簽核鏈推進（chain 模式，無 chain 視為跳過）
--   4. cancel_store_audit         — 把退回的單退回草稿狀態（讓稽核員重編）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. submit_store_audit ────────────────────────────────────────────────
-- 草稿 → 待確認，並寫入當班人員清單
-- p_on_duty: jsonb array, e.g. [{"employee_id":1,"employee_name":"張三"}, ...]
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
BEGIN
  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;

  IF v_audit.status <> '草稿' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status);
  END IF;

  -- 當班人員至少 1 人
  IF p_on_duty IS NULL OR jsonb_array_length(p_on_duty) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ON_DUTY_REQUIRED');
  END IF;

  -- 至少要評核完成（任何項目都 NULL 表示未評核）
  SELECT COUNT(*) INTO v_count FROM store_audit_items WHERE audit_id = p_audit_id AND passed IS NULL;
  IF v_count > 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ITEMS_NOT_EVALUATED', 'pending_count', v_count);
  END IF;

  -- 重寫 on_duty（先清掉舊的）
  DELETE FROM store_audit_on_duty WHERE audit_id = p_audit_id;
  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d)
  LOOP
    INSERT INTO store_audit_on_duty (audit_id, employee_id, employee_name, sort_order)
    VALUES (
      p_audit_id,
      NULLIF((r_staff.d->>'employee_id'), '')::INT,
      r_staff.d->>'employee_name',
      v_idx
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- 更新 total_deducted
  UPDATE store_audits SET
    total_deducted = COALESCE((SELECT SUM(deduct_score) FROM store_audit_items WHERE audit_id = p_audit_id AND passed = FALSE), 0),
    status         = '待確認',
    submitted_at   = NOW()
  WHERE id = p_audit_id;

  RETURN json_build_object('ok', true, 'status', '待確認');
END $$;


-- ─── 2. confirm_store_audit_on_duty ───────────────────────────────────────
-- 當班人員確認/退回。confirm 完若全部都確認，自動進入簽核鏈或直接核准
CREATE OR REPLACE FUNCTION public.confirm_store_audit_on_duty(
  p_audit_id  INT,
  p_action    TEXT,                   -- 'confirm' | 'reject'
  p_reason    TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_audit         store_audits;
  v_emp_id        INT;
  v_row_id        INT;
  v_pending       INT;
  v_has_chain     BOOLEAN;
  v_first_step    approval_chain_steps;
BEGIN
  -- 解 emp from auth.uid()
  SELECT id INTO v_emp_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('confirm', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;
  IF v_audit.status <> '待確認' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_CONFIRM', 'status', v_audit.status);
  END IF;

  -- 找對應的 on_duty row
  SELECT id INTO v_row_id FROM store_audit_on_duty
   WHERE audit_id = p_audit_id AND employee_id = v_emp_id AND confirmed = FALSE
   LIMIT 1;
  IF v_row_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN_OR_ALREADY_CONFIRMED');
  END IF;

  IF p_action = 'reject' THEN
    -- 任一人退回：整單退回
    UPDATE store_audit_on_duty SET reject_reason = btrim(p_reason) WHERE id = v_row_id;
    UPDATE store_audits SET status = '已退回', reject_reason = btrim(p_reason) WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'event', 'rejected_by_on_duty');
  END IF;

  -- confirm
  UPDATE store_audit_on_duty SET confirmed = TRUE, confirmed_at = NOW() WHERE id = v_row_id;

  -- 還有沒確認的 → 維持「待確認」
  SELECT COUNT(*) INTO v_pending FROM store_audit_on_duty
   WHERE audit_id = p_audit_id AND confirmed = FALSE;
  IF v_pending > 0 THEN
    RETURN json_build_object('ok', true, 'event', 'partial_confirmed', 'pending_count', v_pending);
  END IF;

  -- 全部確認完
  v_has_chain := v_audit.approval_chain_id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id);

  IF v_has_chain THEN
    UPDATE store_audits SET status = '申請中', current_step = 0 WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'event', 'advanced_to_chain', 'status', '申請中');
  ELSE
    -- 沒設簽核鏈 → 直接核准（trigger 會 sync 缺失）
    UPDATE store_audits SET status = '已核准', approved_at = NOW(), approver = (SELECT name FROM employees WHERE id = v_emp_id) WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'event', 'auto_approved_no_chain', 'status', '已核准');
  END IF;
END $$;


-- ─── 3. web_approve_store_audit ───────────────────────────────────────────
-- 簽核鏈推進（在「申請中」狀態下，依 chain step 推進）
CREATE OR REPLACE FUNCTION public.web_approve_store_audit(
  p_audit_id  INT,
  p_action    TEXT,                   -- 'approve' | 'reject'
  p_reason    TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_audit       store_audits;
  v_emp_id      INT;
  v_emp_name    TEXT;
  v_step        approval_chain_steps;
  v_total       INT;
  v_is_last     BOOLEAN;
BEGIN
  -- 解 emp from auth.uid()
  SELECT id, name INTO v_emp_id, v_emp_name FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;
  IF v_audit.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_APPROVAL', 'status', v_audit.status);
  END IF;
  IF v_audit.approval_chain_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
  END IF;

  -- 取當前 step
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  -- 驗證當前 user 能簽這關（複用 _employee_matches_chain_step，applicant 傳 auditor_id）
  IF NOT public._employee_matches_chain_step(v_emp_id, v_step.id, v_audit.auditor_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id;
  v_is_last := (v_audit.current_step + 1 >= v_total);

  IF p_action = 'reject' THEN
    UPDATE store_audits SET
      status        = '已退回',
      reject_reason = btrim(p_reason),
      approver      = v_emp_name
    WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'event', 'rejected', 'rejected_at_step', v_audit.current_step);
  END IF;

  -- approve
  IF v_is_last THEN
    UPDATE store_audits SET
      status      = '已核准',
      approver    = v_emp_name,
      approved_at = NOW()
    WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'event', 'approved', 'is_last_step', true);
  ELSE
    UPDATE store_audits SET current_step = current_step + 1 WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'event', 'advanced', 'advanced_to_step', v_audit.current_step + 1);
  END IF;
END $$;


-- ─── 4. cancel_store_audit ────────────────────────────────────────────────
-- 把退回的單退回草稿，讓稽核員重編再送
CREATE OR REPLACE FUNCTION public.cancel_store_audit(p_audit_id INT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_audit  store_audits;
BEGIN
  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;
  IF v_audit.status NOT IN ('已退回', '待確認') THEN
    RETURN json_build_object('ok', false, 'error', 'CANNOT_CANCEL', 'status', v_audit.status);
  END IF;

  DELETE FROM store_audit_on_duty WHERE audit_id = p_audit_id;
  UPDATE store_audits SET
    status        = '草稿',
    submitted_at  = NULL,
    reject_reason = NULL,
    current_step  = 0
  WHERE id = p_audit_id;

  RETURN json_build_object('ok', true, 'status', '草稿');
END $$;


GRANT EXECUTE ON FUNCTION public.submit_store_audit(INT, JSONB)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_store_audit_on_duty(INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.web_approve_store_audit(INT, TEXT, TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_store_audit(INT)                    TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
