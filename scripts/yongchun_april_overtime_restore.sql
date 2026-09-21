-- =============================================
-- 永春店 2026/04 加班記錄還原（22 筆）
-- 2026-05-13
--
-- 背景：今天稍早這 22 筆被誤刪（cascade LINE drain 處理時誤判方向）。
--       本檔案依廠商 PDF「加班申請明細」原樣還原。
--
-- 資料來源：廠商系統匯出 PDF（2026-05-11 匯出，4/01~4/30）
--
-- 處理規則（與使用者確認）：
--   - 永春採「四週變形工時」 → ot_category 手動指定，覆寫 trigger 的 DOW 自動分類
--   - 工作日 → weekday、休息日 → restday、國定假日 → holiday
--   - 空班日 → restday（無固定排班的休息日加班）
--   - 折補休的那筆 → ot_type='leave'（計薪 RPC 會排除，不折錢）
--   - 跨夜加班用「加班歸屬日」當 request_date（廠商 PDF 已標好）
--   - 全部 status='已核准'
--   - 4/29 PDF 標「國定假日」雖然不在 2026 國定清單，但尊重廠商認定
--     （可能是四週變形調班 / 公司特休）
--
-- Idempotent：偵測到既有資料會 RAISE EXCEPTION 中止，避免重複插入。
--             若要強制重灌，請手動 DELETE 後再執行。
-- =============================================

BEGIN;

DO $$
DECLARE
  v_org_id   INT;
  v_store_name TEXT;
  v_chen_id  INT;  -- 陳嘉益
  v_xu_id    INT;  -- 徐宥芯
  v_xu2_id   INT;  -- 許亦翎
  v_lin_id   INT;  -- 林思妤
  v_cai_id   INT;  -- 蔡伊真
  v_existing INT;
BEGIN
  -- 取 org
  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION '無 organization，先建立';
  END IF;

  -- 取永春店「名稱」(overtime_requests.store 是 text 欄位，不是 fk)
  SELECT name INTO v_store_name FROM stores
    WHERE name LIKE '%永春%' AND organization_id = v_org_id
    ORDER BY id LIMIT 1;
  IF v_store_name IS NULL THEN
    RAISE EXCEPTION '找不到永春店（請先建立或確認 store name）';
  END IF;

  -- 找 5 個員工 id
  SELECT id INTO v_chen_id FROM employees WHERE name = '陳嘉益' AND organization_id = v_org_id;
  SELECT id INTO v_xu_id   FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;
  SELECT id INTO v_xu2_id  FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  SELECT id INTO v_lin_id  FROM employees WHERE name = '林思妤' AND organization_id = v_org_id;
  SELECT id INTO v_cai_id  FROM employees WHERE name = '蔡伊真' AND organization_id = v_org_id;

  IF v_chen_id IS NULL THEN RAISE EXCEPTION '找不到員工：陳嘉益'; END IF;
  IF v_xu_id   IS NULL THEN RAISE EXCEPTION '找不到員工：徐宥芯'; END IF;
  IF v_xu2_id  IS NULL THEN RAISE EXCEPTION '找不到員工：許亦翎'; END IF;
  IF v_lin_id  IS NULL THEN RAISE EXCEPTION '找不到員工：林思妤'; END IF;
  IF v_cai_id  IS NULL THEN RAISE EXCEPTION '找不到員工：蔡伊真'; END IF;

  -- 防呆：確認沒有殘留資料（用 employee_id 過濾，比較精準）
  SELECT COUNT(*) INTO v_existing FROM overtime_requests
    WHERE request_date BETWEEN '2026-04-01' AND '2026-04-30'
      AND employee_id IN (v_chen_id, v_xu_id, v_xu2_id, v_lin_id, v_cai_id);

  IF v_existing > 0 THEN
    RAISE EXCEPTION '⚠️ 永春 4 月已有 % 筆加班記錄（5 位員工），請先檢查是否重複（避免重灌）。如確認要重來，請先 DELETE 該區間資料後再執行。', v_existing;
  END IF;

  -- ═══ 還原 22 筆加班記錄 ═══

  -- 陳嘉益 (L2021080) 7 筆
  INSERT INTO overtime_requests
    (employee_id, employee, store, organization_id, request_date, date, hours, ot_hours, ot_category, ot_type, status, reason)
  VALUES
    (v_chen_id, '陳嘉益', v_store_name, v_org_id, '2026-04-11', '2026-04-11', 0.5, 0.5, 'weekday', 'pay', '已核准', '加班'),
    (v_chen_id, '陳嘉益', v_store_name, v_org_id, '2026-04-17', '2026-04-17', 1.0, 1.0, 'weekday', 'pay', '已核准', '加班'),
    (v_chen_id, '陳嘉益', v_store_name, v_org_id, '2026-04-19', '2026-04-19', 0.5, 0.5, 'weekday', 'pay', '已核准', '加班'),
    (v_chen_id, '陳嘉益', v_store_name, v_org_id, '2026-04-21', '2026-04-21', 1.0, 1.0, 'weekday', 'pay', '已核准', '加班'),
    (v_chen_id, '陳嘉益', v_store_name, v_org_id, '2026-04-23', '2026-04-23', 2.0, 2.0, 'weekday', 'pay', '已核准', '加班'),
    (v_chen_id, '陳嘉益', v_store_name, v_org_id, '2026-04-24', '2026-04-24', 2.0, 2.0, 'weekday', 'pay', '已核准', '加班'),
    (v_chen_id, '陳嘉益', v_store_name, v_org_id, '2026-04-29', '2026-04-29', 8.0, 8.0, 'weekday', 'pay', '已核准', '加班');  -- 2026-04-29 是星期三平日（之前手寫成 holiday 是錯）

  -- 徐宥芯 (L2025063) 1 筆
  INSERT INTO overtime_requests
    (employee_id, employee, store, organization_id, request_date, date, hours, ot_hours, ot_category, ot_type, status, reason)
  VALUES
    (v_xu_id, '徐宥芯', v_store_name, v_org_id, '2026-04-30', '2026-04-30', 1.5, 1.5, 'weekday', 'pay', '已核准', '加班');

  -- 許亦翎 (L2025001) 2 筆
  INSERT INTO overtime_requests
    (employee_id, employee, store, organization_id, request_date, date, hours, ot_hours, ot_category, ot_type, status, reason)
  VALUES
    (v_xu2_id, '許亦翎', v_store_name, v_org_id, '2026-04-02', '2026-04-02', 1.0, 1.0, 'weekday', 'pay', '已核准', '加班'),
    (v_xu2_id, '許亦翎', v_store_name, v_org_id, '2026-04-10', '2026-04-10', 0.5, 0.5, 'weekday', 'pay', '已核准', '加班');

  -- 林思妤 (P20260030) 2 筆
  INSERT INTO overtime_requests
    (employee_id, employee, store, organization_id, request_date, date, hours, ot_hours, ot_category, ot_type, status, reason)
  VALUES
    (v_lin_id, '林思妤', v_store_name, v_org_id, '2026-04-24', '2026-04-24', 0.5, 0.5, 'weekday', 'pay', '已核准', '加班'),
    (v_lin_id, '林思妤', v_store_name, v_org_id, '2026-04-25', '2026-04-25', 0.5, 0.5, 'weekday', 'pay', '已核准', '加班');

  -- 蔡伊真 (P20260024) 10 筆（含 1 筆折補休 ot_type='leave'，2 筆空班日 → restday）
  INSERT INTO overtime_requests
    (employee_id, employee, store, organization_id, request_date, date, hours, ot_hours, ot_category, ot_type, status, reason)
  VALUES
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-01', '2026-04-01', 0.5, 0.5, 'weekday', 'pay',  '已核准', '加班'),
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-04', '2026-04-04', 0.5, 0.5, 'restday', 'pay',  '已核准', '加班'),
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-07', '2026-04-07', 0.5, 0.5, 'weekday', 'pay',  '已核准', '加班'),
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-11', '2026-04-11', 1.5, 1.5, 'restday', 'leave','已核准', '加班'),  -- 空班日，折補休
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-14', '2026-04-14', 0.5, 0.5, 'restday', 'pay',  '已核准', NULL),    -- 空班日，折錢
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-16', '2026-04-16', 0.5, 0.5, 'weekday', 'pay',  '已核准', '加班'),
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-22', '2026-04-22', 0.5, 0.5, 'weekday', 'pay',  '已核准', '加班'),
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-23', '2026-04-23', 0.5, 0.5, 'weekday', 'pay',  '已核准', '加班'),
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-24', '2026-04-24', 0.5, 0.5, 'weekday', 'pay',  '已核准', '加班'),
    (v_cai_id, '蔡伊真', v_store_name, v_org_id, '2026-04-28', '2026-04-28', 0.5, 0.5, 'weekday', 'pay',  '已核准', '加班');

  RAISE NOTICE '✅ 永春 4 月加班記錄還原完成：陳嘉益 7、徐宥芯 1、許亦翎 2、林思妤 2、蔡伊真 10 = 共 22 筆';
END $$;

COMMIT;

-- ─────────────────────────────────────
-- 驗證查詢（手動跑，確認結果）
-- ─────────────────────────────────────
SELECT
  e.name           AS 員工,
  o.request_date   AS 歸屬日,
  o.ot_hours       AS 時數,
  o.ot_category    AS 類別,
  o.ot_type        AS 折算,
  o.status,
  o.reason
FROM overtime_requests o
JOIN employees e ON e.id = o.employee_id
WHERE o.request_date BETWEEN '2026-04-01' AND '2026-04-30'
  AND o.store LIKE '%永春%'
ORDER BY e.name, o.request_date;

-- 預期 22 筆：
--   陳嘉益: 7 筆（6 weekday + 1 holiday）
--   徐宥芯: 1 筆 weekday
--   許亦翎: 2 筆 weekday
--   林思妤: 2 筆 weekday
--   蔡伊真: 10 筆（7 weekday + 2 restday(pay) + 1 restday(leave)）
