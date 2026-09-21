-- 簽核:編輯重送→從關0重簽 — 擴充到 費用申請 + 自建表單 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:7/27(20260727160000)已對 HR 7 表做「重送歸0」。本支把同行為套到另外兩條
--       current_step 驅動的鏈:
--         expense_requests(費用申請):待簽='申請中'、被駁 IN('已駁回','已退回')
--         form_submissions(自建表單):待簽='申請中'、被駁 IN('已駁回','已退回')
--       兩者都靠 current_step + _notify_*_step(id, step) 推進/通知(與 HR 同構),
--       故重送只要「current_step 歸 0 + 重推關0」即可。實測(用戶 2026-07-28)確認
--       原本重送會停在被駁那關(跳關),本支修正為整條回關0。
--
-- 設計原則(同 7/27):全部用「新 trigger + 新函式」,現有 trigger/函式完全不動。
--   * 不參照 approval_chain_id(form_submissions 無此欄),只認 status 轉換。
--   * AFTER 通知吃 app.skip_chain_notify guard(批次/強簽時 0 通知)。
--   * workflow_instance/tasks 那條次要軌不在此處理(簽核 gate 是 current_step 那條)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. BEFORE UPDATE:重送(被駁→待簽)→ current_step 歸 0 ──────────────────────
CREATE OR REPLACE FUNCTION public._trg_chain_reset_step_resubmit_ext()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pending text := '申請中';   -- expense_requests / form_submissions 皆為此
BEGIN
  IF COALESCE(OLD.status,'') IN ('已駁回','已退回')
     AND NEW.status = v_pending THEN
    NEW.current_step := 0;
  END IF;
  RETURN NEW;
END $function$;

-- ── 2. AFTER UPDATE:重送後重推關0(重用現成 _notify_*_step)──────────────────────
CREATE OR REPLACE FUNCTION public._trg_chain_resubmit_renotify_ext()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  IF COALESCE(OLD.status,'') IN ('已駁回','已退回')
     AND NEW.status = '申請中' THEN
    IF    TG_TABLE_NAME = 'expense_requests' THEN
      PERFORM public._notify_expense_request_step(NEW.id, 0);
    ELSIF TG_TABLE_NAME = 'form_submissions' THEN
      PERFORM public._notify_form_submission_step(NEW.id, 0);
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ── 3. 掛到 2 張表(先 DROP 再 CREATE,idempotent)────────────────────────────────
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_requests','form_submissions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_chain_reset_step_resubmit_ext ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_chain_reset_step_resubmit_ext BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._trg_chain_reset_step_resubmit_ext()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_chain_resubmit_renotify_ext ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_chain_resubmit_renotify_ext AFTER UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._trg_chain_resubmit_renotify_ext()', t);
  END LOOP;
END $do$;

NOTIFY pgrst, 'reload schema';
