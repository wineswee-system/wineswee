-- =============================================
-- stores: status ↔ is_active 自動同步
-- 2026-05-27
--
-- 背景：
--   stores 同時有 `status` (text: 營運中/籌備中/已停業) 跟 `is_active`
--   (boolean) 兩個欄位。UI (Locations.jsx) 只能改 status；員工頁、
--   轉調申請、LIFF 表單 RPC 卻用 is_active 篩選。歷史上靠手動跑
--   SQL 同步 → 必然 drift（這次 S-014 / S-016 就是這樣消失）。
--
-- 規則：
--   status = '營運中'  → is_active = true
--   status != '營運中' → is_active = false
-- =============================================

BEGIN;

-- 1) Trigger function
CREATE OR REPLACE FUNCTION public.tg_stores_sync_is_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_active := (NEW.status = '營運中');
  RETURN NEW;
END;
$$;

-- 2) Trigger（BEFORE INSERT OR UPDATE，只在 status 真的有變才同步，
--    避免 UPDATE 其他欄位時也跑）
DROP TRIGGER IF EXISTS trg_stores_sync_is_active ON public.stores;
CREATE TRIGGER trg_stores_sync_is_active
BEFORE INSERT OR UPDATE OF status ON public.stores
FOR EACH ROW
EXECUTE FUNCTION public.tg_stores_sync_is_active();

-- 3) 一次性 backfill：把現有資料對齊
UPDATE public.stores
SET is_active = (status = '營運中')
WHERE is_active IS DISTINCT FROM (status = '營運中');

-- 4) 驗證
DO $$
DECLARE
  v_mismatch INT;
BEGIN
  SELECT COUNT(*) INTO v_mismatch
  FROM public.stores
  WHERE is_active IS DISTINCT FROM (status = '營運中');
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'backfill 後仍有 % 筆 status/is_active 不一致', v_mismatch;
  END IF;
END $$;

COMMIT;
