-- ════════════════════════════════════════════════════════════════════════════
-- 整合 expense_requests 退件狀態：只保留「已駁回」
--
-- 背景：expense_requests 有兩條寫入路徑：
--   1. 舊 LIFF 一關式  → 寫「已駁回」
--   2. 簽核鏈 advance  → 寫「已退回」
-- 使用者要求統一為「已駁回」。
--
-- 做法（不動任何現有寫入函式）：
--   A. Backfill：現有 '已退回' 列回填
--   B. BEFORE trigger：所有未來寫入若帶「已退回」，自動轉「已駁回」
--   C. 讀取函式：liff_get_expense_request_chain_status 改讀「已駁回」
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── A. Backfill ──────────────────────────────────────────────────────────────
UPDATE expense_requests
   SET status = '已駁回'
 WHERE status = '已退回';

-- ── B. BEFORE trigger（idempotent） ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._normalize_expense_reject_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = '已退回' THEN
    NEW.status := '已駁回';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_normalize_expense_reject ON expense_requests;
CREATE TRIGGER trg_normalize_expense_reject
  BEFORE INSERT OR UPDATE ON expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._normalize_expense_reject_status();

-- ── C. 更新讀取函式：接受兩個字串，觸發後 DB 只會有「已駁回」 ────────────────
CREATE OR REPLACE FUNCTION public.liff_get_expense_request_chain_status(
  p_id INT
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_record RECORD;
  v_result JSON;
BEGIN
  SELECT id, approval_chain_id, current_step, status, reject_reason, employee_id
    INTO v_record FROM expense_requests WHERE id = p_id;
  IF v_record.id IS NULL THEN RETURN '[]'::json; END IF;

  -- 有快照 → 讀快照
  IF EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_id
  ) THEN
    SELECT json_agg(
      json_build_object(
        'step_order', s.step_order,
        'label',      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
        'name', (
          SELECT string_agg(a.emp_name, '、' ORDER BY a.emp_name)
          FROM public.resolve_snapshot_step_approvers(
            'expense_request', p_id, s.step_order, v_record.employee_id
          ) a
        ),
        'status', (
          CASE
            WHEN v_record.status IN ('已退回','已駁回') AND s.step_order = v_record.current_step THEN 'rejected'
            WHEN v_record.status IN ('已核銷','已核准') THEN 'completed'
            WHEN s.step_order < v_record.current_step THEN 'completed'
            WHEN s.step_order = v_record.current_step AND v_record.status = '申請中' THEN 'current'
            ELSE 'pending'
          END
        ),
        'reject_reason', (
          CASE WHEN v_record.status IN ('已退回','已駁回') AND s.step_order = v_record.current_step
               THEN v_record.reject_reason ELSE NULL END
        )
      ) ORDER BY s.step_order
    )
    INTO v_result
    FROM public.request_chain_snapshots s
    WHERE s.request_type = 'expense_request' AND s.request_id = p_id;

    RETURN COALESCE(v_result, '[]'::json);
  END IF;

  -- fallback：live chain（舊單）
  IF v_record.approval_chain_id IS NULL THEN RETURN '[]'::json; END IF;
  SELECT json_agg(
    json_build_object(
      'step_order', s.step_order,
      'label',      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
      'name',       public._chain_step_display_names(s.id, v_record.employee_id),
      'status', (
        CASE
          WHEN v_record.status IN ('已退回','已駁回') AND s.step_order = v_record.current_step THEN 'rejected'
          WHEN v_record.status IN ('已核銷','已核准') THEN 'completed'
          WHEN s.step_order < v_record.current_step THEN 'completed'
          WHEN s.step_order = v_record.current_step AND v_record.status = '申請中' THEN 'current'
          ELSE 'pending'
        END
      ),
      'reject_reason', (
        CASE WHEN v_record.status IN ('已退回','已駁回') AND s.step_order = v_record.current_step
             THEN v_record.reject_reason ELSE NULL END
      )
    ) ORDER BY s.step_order
  )
  INTO v_result
  FROM approval_chain_steps s WHERE s.chain_id = v_record.approval_chain_id;

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_expense_request_chain_status(INT) TO anon, authenticated;

COMMIT;
