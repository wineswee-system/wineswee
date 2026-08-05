-- ════════════════════════════════════════════════════════════════════════════
-- 收款 v3：加盟金與訂金脫鉤（兩條獨立軌）
-- 2026-08-05
--
-- 修正：加盟金不再掛在「已完成訂金」底下 —— 訂金、加盟金是分開的兩件事。
--   拿掉 franchise_fees.deposit_id + 守門 trigger，改用自己的標的名稱 title。
--   訂金端不變（deposit_records 仍綁一位投資人、自行收款）。
-- 加盟金表尚無資料，安全。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TRIGGER  IF EXISTS trg_franchise_guard_deposit ON public.franchise_fees;
DROP FUNCTION IF EXISTS public.tg_franchise_guard_deposit() CASCADE;

ALTER TABLE public.franchise_fees ADD COLUMN IF NOT EXISTS title TEXT;
-- deposit_id 依賴的 index 會隨欄位一併移除
ALTER TABLE public.franchise_fees DROP COLUMN IF EXISTS deposit_id;

COMMENT ON TABLE public.franchise_fees IS '收款—加盟金主檔（獨立單，不綁訂金）：總額由多位投資人分攤，每位各自 45/45/10';

COMMIT;

NOTIFY pgrst, 'reload schema';
