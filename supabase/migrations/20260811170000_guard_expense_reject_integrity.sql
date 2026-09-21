-- ════════════════════════════════════════════════════════════════════════════
-- 費用申請「駁回完整性」守門 — 2026-08-11
--   背景:#441 被加簽人駁回(系統當下正確標成已駁回),但事後被「繞過 RPC 手動推進」
--         復活,從已駁回變回申請中一路核准到財務會簽,畫面同時掛「加簽駁回+簽核失敗+
--         簽核中」鬼打牆。正常 RPC(expense_request_step_advance)本就擋非待審狀態,
--         reset trigger 也會把「已駁回→申請中」的 current_step 歸 0;此案是手動 UPDATE 繞過。
--   本 migration 加兩道 DB 層硬守門(不誤傷合法重新送出):
--     ① 已駁回/已退回/已拒絕 → 已核准/已核銷 的「直接跳」一律擋(絕對不變量)
--     ② 已駁回單被重新開啟(→申請中/待審核)時,順手作廢殘留的加簽(pending/rejected),
--        免得重跑時還拖著上一輪的駁回標記
--   idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- ① 絕對不變量:駁回態不得「直接」變成核准/核銷態
--   (合法重跑是 已駁回→申請中(step 歸0)→…逐關→已核准,每一步 OLD 都不是駁回態,不受影響)
CREATE OR REPLACE FUNCTION public._guard_expense_reject_no_approve()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status IN ('已駁回','已退回','已拒絕')
     AND NEW.status IN ('已核准','已核銷') THEN
    RAISE EXCEPTION '已駁回單(#%)不得直接改為「%」;要重跑請走「重新送出」(狀態回申請中、整鏈重跑)',
      OLD.id, NEW.status
      USING ERRCODE = 'P0001',
            HINT = '若確定要放行,請先讓申請人/系統以重新送出流程處理,而非直接改狀態';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_guard_reject_no_approve ON public.expense_requests;
CREATE TRIGGER trg_guard_reject_no_approve
  BEFORE UPDATE OF status ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._guard_expense_reject_no_approve();

-- ② 重新開啟(駁回→申請中/待審核)時,作廢殘留加簽,避免拖著舊駁回標記
CREATE OR REPLACE FUNCTION public._clean_extra_steps_on_expense_reopen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_old_skip text;
BEGIN
  IF OLD.status IN ('已駁回','已退回','已拒絕')
     AND NEW.status IN ('申請中','待審核') THEN
    -- 作廢殘留加簽;僅在這筆 UPDATE 期間壓掉加簽 trigger 的 LINE 通知(避免對舊加簽人亂發),
    -- 用完即還原,不影響同交易後段(如重新送出的 re-notify)。
    v_old_skip := current_setting('app.skip_chain_notify', true);
    PERFORM set_config('app.skip_chain_notify', 'true', true);
    UPDATE public.approval_extra_steps
       SET status = 'cancelled', cancelled_at = now()
     WHERE source_table = 'expense_requests'
       AND source_id = NEW.id
       AND status IN ('pending', 'rejected');
    PERFORM set_config('app.skip_chain_notify', COALESCE(v_old_skip, ''), true);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_clean_extra_on_expense_reopen ON public.expense_requests;
CREATE TRIGGER trg_clean_extra_on_expense_reopen
  AFTER UPDATE OF status ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._clean_extra_steps_on_expense_reopen();
