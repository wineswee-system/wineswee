-- ════════════════════════════════════════════════════════════
-- Fix: LIFF anon client 無法讀 employee_line_accounts (RLS 擋)
-- ────────────────────────────────────────────────────────────
-- 症狀：approvalNotify.js getLineTarget() 直查 employee_line_accounts
--       → anon RLS 擋 → 永遠回 [] → silent skip → LINE 永遠不推
-- 修法：包成 SECURITY DEFINER RPC，繞過 RLS（沿用 LIFF 全頁的 RPC 模式）
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_resolve_line_target(p_emp_id INT)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- 優先序（對齊原 JS getLineTarget）：
  --   1. status='active' 優先（不是 active 的 channel 推不出去）
  --   2. is_default 的 channel 優先（系統預設 channel）
  --   3. is_primary 的綁定優先（員工主要 LINE）
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'line_user_id', ela.line_user_id,
       'channel_code', lc.code
     )
     FROM public.employee_line_accounts ela
     JOIN public.line_channels lc ON lc.id = ela.channel_id
     WHERE ela.employee_id = p_emp_id
       AND ela.line_user_id IS NOT NULL
     ORDER BY
       CASE WHEN lc.status = 'active' THEN 0 ELSE 1 END,
       CASE WHEN lc.is_default THEN 0 ELSE 1 END,
       CASE WHEN ela.is_primary THEN 0 ELSE 1 END
     LIMIT 1),
    jsonb_build_object('line_user_id', NULL, 'channel_code', NULL)
  );
$$;

GRANT EXECUTE ON FUNCTION public.liff_resolve_line_target(INT) TO authenticated, anon;

COMMENT ON FUNCTION public.liff_resolve_line_target(INT) IS
  'LIFF 推 LINE 用：依 emp_id 解析最佳 line_user_id + channel_code（active>default>primary 優先序）。SECURITY DEFINER 繞 RLS。';

COMMIT;
