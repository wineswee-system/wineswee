-- =============================================
-- 重啟 威士威企業總部 (id=20) 與 台北測試中心 (id=22)
-- 2026-05-27
--
-- 背景：
--   20260504140000_org_cleanup_depts_stores.sql 當時把這 2 間設成
--   is_active=false（理由：總部不算門市、測試中心）。
--
--   但門市列表頁 (src/pages/org/Locations.jsx) 用的是 `status` 文字
--   欄位顯示「營運中」，沒看 is_active；而員工設定頁
--   (src/pages/org/EmployeeProfile.jsx) 與轉調申請
--   (src/pages/hr/TransferRequest.jsx) 兩處用 .eq('is_active', true)
--   篩選 → 兩邊資料不一致，使用者在員工頁無法把員工指派到這 2 間。
--
-- 修法：把 is_active 改回 true，跟 status 一致。
-- =============================================

BEGIN;

UPDATE stores SET is_active = true
WHERE id IN (20, 22);
-- 20 = 威士威企業總部 (S-014)
-- 22 = 台北測試中心 (S-016)

-- 驗證
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM stores
  WHERE id IN (20, 22) AND is_active = true;
  IF v_count <> 2 THEN
    RAISE EXCEPTION '預期 2 間重啟，實際 % 間', v_count;
  END IF;
END $$;

COMMIT;
