-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核可見性補洞 + 獨立核准 RPC
-- 2026-07-01
--
-- 三個 bug 一次解：
--   Bug ①：主系統 稽核室(有 liff.store_audit.view_all)一張都看不到
--          - store_audits SELECT policy 只認 can_see_store(store_id)
--          - 稽核室的人不隸屬門市 → 全 false
--          - store_audit_on_duty 同樣 can_see_own 擋掉
--          修法：加獨立 SELECT policy — has view_all → 直接放行（不動舊 policy，OR 邏輯）
--          admin/super_admin 已由 can_see_store 內 is_admin() 分支放行，不變
--          其他人維持 can_see_store 舊行為（只看自己相關）
--   Bug ②：LIFF/LINE 核准噴 INVALID_TYPE
--          - liff_approve_request 原本在 20260522050000 有 store_audit 分支
--          - 20260604110000 CREATE OR REPLACE 復活 expense_settle 時把它洗掉
--          - 慘案模式 [[feedback_migration_partial_overwrite_disaster]]
--          修法：不重寫 500 行大 function，另建獨立 liff_store_audit_approve RPC
--                LIFF / postback-approval 改呼這支（比照 off_request / goods_transfer 模式）
--
-- 不動：liff_approve_request、can_see_store、既有 policy
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. store_audits：加 view_all SELECT policy（保留 can_see_store 舊 policy 走 OR）═══
DROP POLICY IF EXISTS store_audits_view_all_sel ON public.store_audits;
CREATE POLICY store_audits_view_all_sel ON public.store_audits
  FOR SELECT USING (
    public.liff_employee_has_permission(
      public.current_employee_id(),
      'liff.store_audit.view_all'
    )
  );

-- ═══ 2. store_audit_on_duty：加 view_all SELECT policy ═══
DROP POLICY IF EXISTS store_audit_on_duty_view_all_sel ON public.store_audit_on_duty;
CREATE POLICY store_audit_on_duty_view_all_sel ON public.store_audit_on_duty
  FOR SELECT USING (
    public.liff_employee_has_permission(
      public.current_employee_id(),
      'liff.store_audit.view_all'
    )
  );

-- store_audit_items 已用 org_visible(organization_id)，同 org 就通，無需動

-- ═══ 3. 獨立 RPC：liff_store_audit_approve ═══
-- 抽自 20260522050000 store_audit_liff.sql 的 store_audit 分支邏輯
-- 兩階段：
--   '待確認' 階段 → 當班人員確認/退回
--   '申請中' 階段 → 簽核鏈推進（走 _employee_matches_chain_step 4-param）
-- 不做 chain snapshot（store_audit 本來就 live chain check）
CREATE OR REPLACE FUNCTION public.liff_store_audit_approve(
  p_line_user_id text,
  p_id           int,
  p_action       text,
  p_reason       text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp         employees;
  v_audit     store_audits;
  v_step      approval_chain_steps;
  v_total     int;
  v_is_last   boolean;
  v_pending   int;
  v_row_id    int;
  reject_val  text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  reject_val := COALESCE(p_reason, '');

  SELECT * INTO v_audit FROM store_audits WHERE id = p_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;
  IF v_audit.organization_id IS NOT NULL
     AND v_audit.organization_id <> emp.organization_id THEN
    RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
  END IF;

  -- ─── 「待確認」階段：當班人員確認/退回 ───
  IF v_audit.status = '待確認' THEN
    SELECT id INTO v_row_id FROM store_audit_on_duty
     WHERE audit_id = p_id AND employee_id = emp.id AND confirmed = FALSE
     LIMIT 1;
    IF v_row_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN_OR_ALREADY_CONFIRMED');
    END IF;

    IF p_action = 'reject' THEN
      UPDATE store_audit_on_duty SET reject_reason = reject_val WHERE id = v_row_id;
      UPDATE store_audits SET status = '已退回', reject_reason = reject_val WHERE id = p_id;
      RETURN json_build_object('ok', true, 'event', 'rejected_by_on_duty', 'status', '已退回');
    END IF;

    -- confirm
    UPDATE store_audit_on_duty SET confirmed = TRUE, confirmed_at = NOW() WHERE id = v_row_id;

    SELECT COUNT(*) INTO v_pending FROM store_audit_on_duty
     WHERE audit_id = p_id AND confirmed = FALSE;
    IF v_pending > 0 THEN
      RETURN json_build_object('ok', true, 'event', 'partial_confirmed', 'pending_count', v_pending);
    END IF;

    -- 全部確認完：進入簽核 or 直接核准
    IF v_audit.approval_chain_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id) THEN
      UPDATE store_audits SET status = '申請中', current_step = 0 WHERE id = p_id;
      RETURN json_build_object('ok', true, 'event', 'advanced_to_chain', 'status', '申請中');
    ELSE
      UPDATE store_audits SET status = '已核准', approved_at = NOW(), approver = emp.name WHERE id = p_id;
      RETURN json_build_object('ok', true, 'event', 'auto_approved_no_chain', 'status', '已核准');
    END IF;
  END IF;

  -- ─── 「申請中」階段：簽核鏈推進 ───
  IF v_audit.status = '申請中' THEN
    IF v_audit.approval_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
    END IF;
    -- 4-param signature：p_via_delegation 預設 FALSE
    IF NOT public._employee_matches_chain_step(
         emp.id::int, v_step.id::int, v_audit.auditor_id::int, FALSE
       ) THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    SELECT COUNT(*) INTO v_total FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id;
    v_is_last := (v_audit.current_step + 1 >= v_total);

    IF p_action = 'reject' THEN
      UPDATE store_audits SET status = '已退回', reject_reason = reject_val, approver = emp.name
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'event', 'rejected',
        'rejected_at_step', v_audit.current_step);
    END IF;

    IF v_is_last THEN
      UPDATE store_audits SET status = '已核准', approver = emp.name, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'event', 'approved', 'is_last_step', true);
    ELSE
      UPDATE store_audits SET current_step = current_step + 1 WHERE id = p_id;
      RETURN json_build_object('ok', true, 'event', 'advanced',
        'advanced_to_step', v_audit.current_step + 1);
    END IF;
  END IF;

  RETURN json_build_object('ok', false, 'error', 'NOT_ACTIONABLE', 'status', v_audit.status);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_store_audit_approve(text, int, text, text)
  TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
