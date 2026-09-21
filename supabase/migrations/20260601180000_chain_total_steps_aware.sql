-- ════════════════════════════════════════════════════════════════════════════
-- chain_total_steps 改 snapshot 感知 — Helper RPC
-- 2026-06-01
--
-- 背景：
--   `liff_list_pending_approvals` 759 行的巨函式，回傳 expense_request 卡片時
--   把 chain_total_steps 算成 `(SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = ...)`，
--   讀 live。改 chain 之後 LIFF 卡片「第 X/Y 關」的 Y 會跟 snapshot 對不上。
--
--   不重寫 759 行（鐵則 feedback_migration_partial_overwrite_disaster 警告太多次），
--   改加一個 batch helper：LIFF 載完 pending approvals 後呼叫一次，覆蓋 chain_total_steps。
--
-- 設計：
--   - 通用：takes (rt, ids[]) 回 [(id, total_steps)]
--   - 有 snapshot 用 snapshot 數，沒 snapshot fallback 對應 row 的 live chain 數
--   - SECURITY DEFINER（看得到 RLS-locked snapshots 表）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_get_chain_total_steps_batch(
  p_request_type text,    -- 'expense_request' | 'leave_request' | 'form_submission' | ...
  p_ids          int[]
) RETURNS TABLE (id int, total_steps int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_table_name   text;
  v_sql          text;
BEGIN
  -- form_submission 特殊處理：chain 來自 form_templates.approval_chain_id（不在 row 本身）
  IF p_request_type = 'form_submission' THEN
    RETURN QUERY
      SELECT
        fs.id,
        COALESCE(
          NULLIF((SELECT COUNT(*)::int FROM public.request_chain_snapshots rcs
                   WHERE rcs.request_type = 'form_submission' AND rcs.request_id = fs.id), 0),
          (SELECT COUNT(*)::int FROM public.approval_chain_steps acs
            WHERE acs.chain_id = ft.approval_chain_id)
        )
      FROM public.form_submissions fs
      JOIN public.form_templates ft ON ft.id = fs.template_id
      WHERE fs.id = ANY(p_ids);
    RETURN;
  END IF;

  -- 其他 9 種：row 自己有 approval_chain_id
  v_table_name := CASE p_request_type
    WHEN 'expense_request'  THEN 'expense_requests'
    WHEN 'leave_request'    THEN 'leave_requests'
    WHEN 'overtime_request' THEN 'overtime_requests'
    WHEN 'trip'             THEN 'business_trips'
    WHEN 'correction'       THEN 'clock_corrections'
    WHEN 'resignation'      THEN 'resignation_requests'
    WHEN 'loa'              THEN 'leave_of_absence_requests'
    WHEN 'transfer'         THEN 'personnel_transfer_requests'
    WHEN 'headcount'        THEN 'headcount_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN RETURN; END IF;

  v_sql := format($f$
    SELECT
      T.id,
      COALESCE(
        NULLIF((SELECT COUNT(*)::int FROM public.request_chain_snapshots rcs
                 WHERE rcs.request_type = %L AND rcs.request_id = T.id), 0),
        (SELECT COUNT(*)::int FROM public.approval_chain_steps acs
          WHERE acs.chain_id = T.approval_chain_id)
      )
    FROM public.%I T
    WHERE T.id = ANY($1)
  $f$, p_request_type, v_table_name);

  RETURN QUERY EXECUTE v_sql USING p_ids;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_chain_total_steps_batch(text, int[])
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.liff_get_chain_total_steps_batch(text, int[]) IS
  'Batch helper: snapshot 感知的 chain total_steps，供 LIFF 列表覆蓋 live count（2026-06-01）';

COMMIT;
NOTIFY pgrst, 'reload schema';
