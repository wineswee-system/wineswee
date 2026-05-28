-- ════════════════════════════════════════════════════════════════════════════
-- 補推：費用申請在飛單（step 0）重發 LINE 通知給正確的直屬主管
-- ────────────────────────────────────────────────────────────────────────────
-- 背景：000004 把費用申請 chain step 0 從 applicant_dept_manager 改成
--       applicant_supervisor，但已在飛的單（current_step=0）通知已發給部門主管。
--       這支 migration 對 step 0 在飛單重推一次，讓直屬主管收到待審通知。
--
-- 註：原本在 Supabase Studio 直接執行的 hotfix，2026-05-29 回填成 migration 檔
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_req  RECORD;
  v_sent INT := 0;
BEGIN
  FOR v_req IN
    SELECT er.id, er.current_step
      FROM public.expense_requests er
     WHERE er.status IN ('申請中', '待審', '待審核')
       AND er.current_step = 0
       AND er.approval_chain_id IN (
         SELECT id FROM public.approval_chains WHERE category = '費用申請'
       )
     ORDER BY er.id
  LOOP
    PERFORM public._notify_expense_request_step(v_req.id, v_req.current_step);
    v_sent := v_sent + 1;
    RAISE NOTICE '[resend_expense_step0] 補推 request #%', v_req.id;
  END LOOP;
  RAISE NOTICE '[resend_expense_step0] 共補推 % 張在飛單', v_sent;
END $$;

COMMIT;
