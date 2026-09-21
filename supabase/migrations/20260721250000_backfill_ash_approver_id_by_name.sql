-- 回填 approval_step_history.approver_id — 有名字卻沒 id 的 — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- 「我簽過的」(_list_my_signed_approvals)靠 ash.approver_id = 我 過濾。
-- 歷史上約 876 筆 approved/rejected 的 approver_id=NULL。其中有 approver_name 者 126 筆,
--   實測「名字能唯一對到員工」的 ~67 筆可回填(0 撞名)→ 這些簽核歷史在「我簽過的」就找得回。
--   (其餘名字是「系統核准/系統自動跳過/-」等系統字串,非真人,正確跳過。)
-- 另 ~750 筆連名字都沒有 = 中間關修正前遺失,無法救,不臆造。
-- 安全:只補 approver_id IS NULL 且名字能唯一對到在職/離職員工者;冪等,可重複跑。
-- ════════════════════════════════════════════════════════════════════════════
UPDATE public.approval_step_history ash
   SET approver_id = e.id
  FROM public.employees e
 WHERE ash.approver_id IS NULL
   AND ash.approver_name IS NOT NULL
   AND btrim(ash.approver_name) <> ''
   AND e.name = btrim(ash.approver_name)
   -- org 對得上優先;對不上時仍靠唯一名字補(下方 NOT EXISTS 確保名字唯一)
   AND (ash.organization_id IS NULL OR e.organization_id = ash.organization_id)
   -- 只在該名字對到「唯一一位」員工時才補,避免撞名補錯
   AND NOT EXISTS (
     SELECT 1 FROM public.employees e2
      WHERE e2.name = btrim(ash.approver_name)
        AND (ash.organization_id IS NULL OR e2.organization_id = ash.organization_id)
        AND e2.id <> e.id
   );

DO $$
DECLARE v_remain int;
BEGIN
  SELECT count(*) INTO v_remain
    FROM public.approval_step_history
   WHERE approver_id IS NULL AND action IN ('approved','rejected');
  RAISE NOTICE '[ash backfill] 回填後仍 approver_id=NULL 的 approved/rejected: % 筆(多為無名字的中間關遺失,無法救)', v_remain;
END $$;

NOTIFY pgrst, 'reload schema';
