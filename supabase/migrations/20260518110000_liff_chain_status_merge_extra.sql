-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 進度時間軸 RPC：合併加簽（approval_extra_steps）
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：liff_get_expense_request_chain_status / liff_get_expense_settle_chain_status
--      只回 approval_chain_steps，沒 union approval_extra_steps，所以在 LIFF
--      進度 tab 看不到「加簽」這一關。
--
-- 修法：CTE union chain_rows + extra_rows
--   - chain_rows 跟原本一樣 (邏輯 1:1 從 20260513180000 搬來)
--   - extra_rows 把 pending/approved/rejected 的加簽轉成 step 物件
--   - 排序 sort_key：chain step.step_order (整數)
--                    extra step.insert_before_step - 0.5 (插在前一關之前)
--
-- 輸出仍與 LIFF ChainTimeline 元件相容（step_order/label/name/status/reject_reason）
-- 新增 kind 欄位（'chain'/'extra'）給未來想自訂樣式時用
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_get_expense_request_chain_status(
  p_id INT
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_record  RECORD;
  v_result  JSON;
BEGIN
  SELECT id, approval_chain_id, current_step, status, reject_reason, employee_id, organization_id
    INTO v_record
    FROM expense_requests
   WHERE id = p_id;

  IF v_record.id IS NULL OR v_record.approval_chain_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  WITH chain_rows AS (
    SELECT
      s.step_order::numeric                                            AS sort_key,
      s.step_order                                                     AS step_order,
      'chain'::text                                                    AS kind,
      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關') AS label,
      public._chain_step_display_names(s.id, v_record.employee_id)     AS name,
      CASE
        WHEN v_record.status = '已退回'        AND s.step_order = v_record.current_step THEN 'rejected'
        WHEN v_record.status IN ('已核銷','已核准')                                       THEN 'completed'
        WHEN s.step_order < v_record.current_step                                         THEN 'completed'
        WHEN s.step_order = v_record.current_step AND v_record.status = '申請中'         THEN 'current'
        ELSE 'pending'
      END                                                              AS status,
      CASE
        WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step
          THEN v_record.reject_reason
        ELSE NULL
      END                                                              AS reject_reason
    FROM approval_chain_steps s
    WHERE s.chain_id = v_record.approval_chain_id
  ),
  extra_rows AS (
    SELECT
      (es.insert_before_step - 0.5)::numeric                           AS sort_key,
      es.insert_before_step                                            AS step_order,
      'extra'::text                                                    AS kind,
      '🪶 加簽'::text                                                  AS label,
      COALESCE(
        (SELECT name FROM employees WHERE id = es.assignee_id LIMIT 1),
        ''
      )                                                                AS name,
      CASE es.status
        WHEN 'pending'  THEN 'current'
        WHEN 'approved' THEN 'completed'
        WHEN 'rejected' THEN 'rejected'
      END                                                              AS status,
      es.reject_reason                                                 AS reject_reason
    FROM approval_extra_steps es
    WHERE es.source_table = 'expense_requests'
      AND es.source_id   = v_record.id
      AND es.status     <> 'cancelled'
  ),
  all_rows AS (
    SELECT * FROM chain_rows
    UNION ALL
    SELECT * FROM extra_rows
  )
  SELECT json_agg(
    json_build_object(
      'step_order',    step_order,
      'kind',          kind,
      'label',         label,
      'name',          name,
      'status',        status,
      'reject_reason', reject_reason
    ) ORDER BY sort_key
  )
  INTO v_result
  FROM all_rows;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_expense_request_chain_status(INT)
  TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.liff_get_expense_settle_chain_status(
  p_id INT
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_record  RECORD;
  v_result  JSON;
BEGIN
  SELECT id, settle_chain_id, settle_current_step, status, settle_reject_reason, employee_id, organization_id
    INTO v_record
    FROM expense_requests
   WHERE id = p_id;

  IF v_record.id IS NULL OR v_record.settle_chain_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  WITH chain_rows AS (
    SELECT
      s.step_order::numeric                                            AS sort_key,
      s.step_order                                                     AS step_order,
      'chain'::text                                                    AS kind,
      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關') AS label,
      public._chain_step_display_names(s.id, v_record.employee_id)     AS name,
      CASE
        WHEN v_record.status = '核銷已退回' AND s.step_order = v_record.settle_current_step THEN 'rejected'
        WHEN v_record.status = '已核銷'                                                       THEN 'completed'
        WHEN s.step_order < v_record.settle_current_step                                       THEN 'completed'
        WHEN s.step_order = v_record.settle_current_step AND v_record.status = '待核銷'      THEN 'current'
        ELSE 'pending'
      END                                                              AS status,
      CASE
        WHEN v_record.status = '核銷已退回' AND s.step_order = v_record.settle_current_step
          THEN v_record.settle_reject_reason
        ELSE NULL
      END                                                              AS reject_reason
    FROM approval_chain_steps s
    WHERE s.chain_id = v_record.settle_chain_id
  ),
  extra_rows AS (
    -- 注意：approval_extra_steps 目前只在 expense_request 主鏈接著用，
    -- 核銷 chain 暫不接加簽。但保留 union 以便未來開啟核銷加簽不用再改 RPC。
    -- 篩 source_table='expense_settle' 區分；現在這條會回空。
    SELECT
      (es.insert_before_step - 0.5)::numeric                           AS sort_key,
      es.insert_before_step                                            AS step_order,
      'extra'::text                                                    AS kind,
      '🪶 加簽'::text                                                  AS label,
      COALESCE(
        (SELECT name FROM employees WHERE id = es.assignee_id LIMIT 1),
        ''
      )                                                                AS name,
      CASE es.status
        WHEN 'pending'  THEN 'current'
        WHEN 'approved' THEN 'completed'
        WHEN 'rejected' THEN 'rejected'
      END                                                              AS status,
      es.reject_reason                                                 AS reject_reason
    FROM approval_extra_steps es
    WHERE es.source_table = 'expense_settle'
      AND es.source_id   = v_record.id
      AND es.status     <> 'cancelled'
  ),
  all_rows AS (
    SELECT * FROM chain_rows
    UNION ALL
    SELECT * FROM extra_rows
  )
  SELECT json_agg(
    json_build_object(
      'step_order',    step_order,
      'kind',          kind,
      'label',         label,
      'name',          name,
      'status',        status,
      'reject_reason', reject_reason
    ) ORDER BY sort_key
  )
  INTO v_result
  FROM all_rows;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_expense_settle_chain_status(INT)
  TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
