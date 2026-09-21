-- ════════════════════════════════════════════════════════════════════════════
-- Fix: _guard_chain_steps_in_flight 加 SECURITY DEFINER
-- 2026-06-01
--
-- 慘案：
--   20260601130000 把 guard 改成「有 snapshot 就放行」，但 guard 沒 SECURITY DEFINER，
--   會用 caller (authenticated) 身分查 request_chain_snapshots。
--   而 request_chain_snapshots = RLS ON + 0 policies → 對 authenticated 完全不可見 →
--   guard 看不到 snapshot → 誤判「無快照在飛單」→ 拋 P0001 → DELETE 回 400。
--
--   Studio 用 service_role bypass RLS → guard 看得到 → 放行 ✅
--   前端用 authenticated → guard 看不到 → 擋下 ❌
--
-- 修：guard 改 SECURITY DEFINER + 鎖 search_path（best practice）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._guard_chain_steps_in_flight()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  -- ─── 已切快照（放行 snapshotted）───

  -- expense_requests
  SELECT COUNT(*) INTO v_count
    FROM public.expense_requests T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審')
     AND NOT EXISTS (
       SELECT 1 FROM public.request_chain_snapshots rcs
        WHERE rcs.request_type = 'expense_request' AND rcs.request_id = T.id
     );
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張無快照的在飛 expense_requests，請先等完成或補快照',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- form_submissions
  SELECT COUNT(*) INTO v_count
    FROM public.form_submissions fs
    JOIN public.form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = OLD.chain_id
     AND fs.status IN ('申請中', '待審', '待審核', 'pending')
     AND NOT EXISTS (
       SELECT 1 FROM public.request_chain_snapshots rcs
        WHERE rcs.request_type = 'form_submission' AND rcs.request_id = fs.id
     );
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張無快照的在飛 form_submissions，請先等完成或補快照',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- ─── 讀路徑尚未切（整批擋）───

  SELECT COUNT(*) INTO v_count FROM public.leave_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 leave_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.overtime_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 overtime_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.business_trips T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 business_trips，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.clock_corrections T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 clock_corrections，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.resignation_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 resignation_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.leave_of_absence_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 leave_of_absence_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.personnel_transfer_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 personnel_transfer_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.headcount_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 headcount_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END $$;

COMMENT ON FUNCTION public._guard_chain_steps_in_flight() IS
  '改 approval_chain_steps 前 guard — SECURITY DEFINER（避免 authenticated 看不到 request_chain_snapshots 誤判，2026-06-01）';

COMMIT;
NOTIFY pgrst, 'reload schema';
