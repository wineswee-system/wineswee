-- ════════════════════════════════════════════════════════════════════════════
-- get_approval_timeline: current 關卡也算「已停留 NOW - entered_at」
-- ────────────────────────────────────────────────────────────────────────────
-- 之前 duration_seconds 是 STORED column 只在 exited_at NOT NULL 才算，
-- 所以 current 關卡（還沒簽核完）拿到 duration_text='進行中…'，畫面
-- 上看不到「等多久了」這個資訊。
--
-- 修法：在 RPC 內判斷 exited_at IS NULL → 改用 NOW() - entered_at 算，
-- 文案前綴「已停留」跟 completed 的「停留」做區分。
--
-- 1:1 重寫 20260513090000 版本，唯一變動是 duration_text CASE 加 current 分支。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_approval_timeline(
  p_request_type TEXT,
  p_request_id   INT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'step_order',  step_order,
      'step_label',  step_label,
      'target_type', target_type,
      'entered_at',  entered_at,
      'exited_at',   exited_at,
      'duration_seconds', duration_seconds,
      'duration_text', CASE
        -- ★ current 關卡（exited_at IS NULL）：用 NOW() 算「已停留 X」
        WHEN exited_at IS NULL THEN
          (
            CASE
              WHEN EXTRACT(EPOCH FROM (NOW() - entered_at))::INT < 60 THEN
                '已停留 ' || EXTRACT(EPOCH FROM (NOW() - entered_at))::INT || ' 秒'
              WHEN EXTRACT(EPOCH FROM (NOW() - entered_at))::INT < 3600 THEN
                '已停留 ' || (EXTRACT(EPOCH FROM (NOW() - entered_at))::INT / 60) || ' 分'
              WHEN EXTRACT(EPOCH FROM (NOW() - entered_at))::INT < 86400 THEN
                '已停留 ' || (EXTRACT(EPOCH FROM (NOW() - entered_at))::INT / 3600) || ' 小時 ' ||
                ((EXTRACT(EPOCH FROM (NOW() - entered_at))::INT % 3600) / 60) || ' 分'
              ELSE
                '已停留 ' || (EXTRACT(EPOCH FROM (NOW() - entered_at))::INT / 86400) || ' 天 ' ||
                ((EXTRACT(EPOCH FROM (NOW() - entered_at))::INT % 86400) / 3600) || ' 小時'
            END
          )
        -- completed / rejected 關卡：原本邏輯（用 STORED duration_seconds）
        WHEN duration_seconds < 60 THEN duration_seconds || ' 秒'
        WHEN duration_seconds < 3600 THEN (duration_seconds / 60) || ' 分'
        WHEN duration_seconds < 86400 THEN
          (duration_seconds / 3600) || ' 小時 ' ||
          ((duration_seconds % 3600) / 60) || ' 分'
        ELSE
          (duration_seconds / 86400) || ' 天 ' ||
          ((duration_seconds % 86400) / 3600) || ' 小時'
      END,
      'action',         action,
      'approver_name',  approver_name
    ) ORDER BY step_order, entered_at)
      FROM approval_step_history
     WHERE request_type = p_request_type
       AND request_id   = p_request_id
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.get_approval_timeline(TEXT, INT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
