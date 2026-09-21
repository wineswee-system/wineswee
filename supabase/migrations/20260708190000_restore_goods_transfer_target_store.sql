-- 補回失蹤的 _goods_transfer_target_store — 2026-07-08
-- 根因:此 helper 原定義在 20260609131000,但 live DB 已無此函式(drift:未跑到/被洗掉)。
--   它被簽核核心 resolve_snapshot_step_approvers + _employee_matches_snapshot_step 呼叫,
--   用來依調撥單回「調出店(from)/調入店(to)」門市 id → 解店長/督導簽核關。
--   缺它 → 任何 goods_transfer 的店長/督導關「按了不推進 / 解不出簽核人」(執行才炸)。
-- 純唯讀 SELECT;比照原始定義;idempotent。零資料影響。

CREATE OR REPLACE FUNCTION public._goods_transfer_target_store(
  p_request_id INT,
  p_direction  TEXT  -- 'from'(調出店) or 'to'(調入店)
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_direction
    WHEN 'from' THEN from_store_id
    WHEN 'to'   THEN to_store_id
  END
  FROM goods_transfer_requests
  WHERE id = p_request_id
$$;

GRANT EXECUTE ON FUNCTION public._goods_transfer_target_store(INT, TEXT) TO service_role, authenticated, anon;
NOTIFY pgrst, 'reload schema';
