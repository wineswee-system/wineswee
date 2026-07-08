-- 修:加簽新增/更新的通知觸發器沒在 approval_extra_steps 上 fire → 重新掛 — 2026-07-08
-- 症狀:用 request_extra_signer 加簽(web/LIFF)後，加簽人收不到 LINE 卡；
--       但手動呼叫 _notify_extra_signer 會送達 → 代表 AFTER INSERT 觸發器沒觸發。
--       (整個「加簽人沒收到」saga 的真正根源。)
-- 作法:DROP IF EXISTS + 重新 CREATE 兩個觸發器綁定到 approval_extra_steps。
--       觸發器函式(_trg_extra_signer_inserted / _updated)本來就在，只補綁定。idempotent。

DROP TRIGGER IF EXISTS trg_extra_signer_inserted ON public.approval_extra_steps;
CREATE TRIGGER trg_extra_signer_inserted
  AFTER INSERT ON public.approval_extra_steps
  FOR EACH ROW EXECUTE FUNCTION public._trg_extra_signer_inserted();

DROP TRIGGER IF EXISTS trg_extra_signer_updated ON public.approval_extra_steps;
CREATE TRIGGER trg_extra_signer_updated
  AFTER UPDATE ON public.approval_extra_steps
  FOR EACH ROW EXECUTE FUNCTION public._trg_extra_signer_updated();
