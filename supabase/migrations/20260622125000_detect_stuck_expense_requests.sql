-- ════════════════════════════════════════════════════════════════════════════
-- B：費用單「卡死偵測」唯讀 RPC（裝警報器，零風險）
-- 2026-06-22
--
-- 抓出 step 已到/超過末步、但 status 還停在審批中/待核銷 的單（= #195 那種矛盾態）。
-- 步數以「快照」為準（沒快照才退回活鏈 approval_chain_steps）→ 對齊在飛單真實步數。
-- 純 SELECT、SECURITY DEFINER、限本租戶；任何登入員工可呼叫（資訊量低：只回卡住清單）。
-- 用法：SELECT * FROM detect_stuck_expense_requests();  （可掛後台健檢頁/未來接 cron）
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.detect_stuck_expense_requests()
RETURNS TABLE(
  r_id          int,
  r_employee    text,
  r_title       text,
  phase         text,
  r_status      text,
  step_at       int,
  total_steps   int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org int;
BEGIN
  SELECT e.organization_id INTO v_org FROM employees e WHERE e.auth_user_id = auth.uid() LIMIT 1;

  RETURN QUERY
  -- ── 核銷階段卡死：待核銷 但 settle_current_step >= 末步 ──
  SELECT er.id, er.employee, er.title, 'settle'::text, er.status,
         er.settle_current_step, st.n
  FROM expense_requests er
  JOIN LATERAL (
    SELECT COALESCE(NULLIF(
             (SELECT count(*)::int FROM request_chain_snapshots s
               WHERE s.request_type='expense_settle' AND s.request_id=er.id), 0),
             (SELECT count(*)::int FROM approval_chain_steps cs
               WHERE cs.chain_id=er.settle_chain_id)) AS n
  ) st ON TRUE
  WHERE er.deleted_at IS NULL
    AND (v_org IS NULL OR er.organization_id = v_org)
    AND er.status = '待核銷'
    AND er.settle_chain_id IS NOT NULL
    AND st.n > 0
    AND er.settle_current_step >= st.n

  UNION ALL
  -- ── 審批階段卡死：申請中 但 current_step >= 末步 ──
  SELECT er.id, er.employee, er.title, 'approval'::text, er.status,
         er.current_step, st.n
  FROM expense_requests er
  JOIN LATERAL (
    SELECT COALESCE(NULLIF(
             (SELECT count(*)::int FROM request_chain_snapshots s
               WHERE s.request_type='expense_request' AND s.request_id=er.id), 0),
             (SELECT count(*)::int FROM approval_chain_steps cs
               WHERE cs.chain_id=er.approval_chain_id)) AS n
  ) st ON TRUE
  WHERE er.deleted_at IS NULL
    AND (v_org IS NULL OR er.organization_id = v_org)
    AND er.status = '申請中'
    AND er.approval_chain_id IS NOT NULL
    AND st.n > 0
    AND er.current_step >= st.n;
END
$function$;

GRANT EXECUTE ON FUNCTION public.detect_stuck_expense_requests() TO authenticated;
