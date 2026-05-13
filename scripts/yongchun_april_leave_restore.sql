-- =============================================
-- 永春店 2026/04 請假記錄匯入（2 筆）
-- 2026-05-13
--
-- 資料來源：廠商系統匯出 PDF「請假申請明細」(2026-05-13)
--
-- 1. 許亦翎 (L2025001) 4/21 生理假 8 小時 (11:00~20:00)
-- 2. 徐宥芯 (L2025063) 4/09 特休 8 小時 (11:00~20:00)
--    PDF 顯示「2025 年結算特休」— 系統暫存 type='特休'，reason 註明
--
-- 全部 status='已核准'。Idempotent：已存在就 RAISE 中止。
-- =============================================

BEGIN;

DO $$
DECLARE
  v_org_id  INT;
  v_xu2_id  INT;  -- 許亦翎
  v_xu_id   INT;  -- 徐宥芯
  v_existing INT;
BEGIN
  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;

  SELECT id INTO v_xu2_id FROM employees WHERE name = '許亦翎' AND organization_id = v_org_id;
  SELECT id INTO v_xu_id  FROM employees WHERE name = '徐宥芯' AND organization_id = v_org_id;

  IF v_xu2_id IS NULL THEN RAISE EXCEPTION '找不到員工：許亦翎'; END IF;
  IF v_xu_id  IS NULL THEN RAISE EXCEPTION '找不到員工：徐宥芯'; END IF;

  -- 防呆：檢查既有資料
  SELECT COUNT(*) INTO v_existing FROM leave_requests
    WHERE start_date BETWEEN '2026-04-01' AND '2026-04-30'
      AND employee_id IN (v_xu2_id, v_xu_id);

  IF v_existing > 0 THEN
    RAISE EXCEPTION '⚠️ 永春 4 月已有 % 筆許亦翎/徐宥芯 請假記錄，請先檢查避免重灌', v_existing;
  END IF;

  -- 許亦翎 4/21 生理假 8h
  INSERT INTO leave_requests
    (employee_id, employee, organization_id, type, start_date, end_date,
     start_time, end_time, hours, days, unit, status, reason)
  VALUES
    (v_xu2_id, '許亦翎', v_org_id, '生理假',
     '2026-04-21', '2026-04-21',
     '11:00', '20:00', 8, 1, '小時', '已核准', '生理期身體不適');

  -- 徐宥芯 4/09 特休 8h（廠商 PDF 標「2025 年結算特休」）
  INSERT INTO leave_requests
    (employee_id, employee, organization_id, type, start_date, end_date,
     start_time, end_time, hours, days, unit, status, reason)
  VALUES
    (v_xu_id, '徐宥芯', v_org_id, '特休',
     '2026-04-09', '2026-04-09',
     '11:00', '20:00', 8, 1, '小時', '已核准', '2025 年結算特休');

  RAISE NOTICE '✅ 永春 4 月請假匯入完成：許亦翎 1 + 徐宥芯 1 = 2 筆';
END $$;

COMMIT;

-- 驗證查詢
SELECT
  e.name      AS 員工,
  l.type      AS 假別,
  l.start_date AS 起,
  l.start_time AS 起時,
  l.end_time   AS 迄時,
  l.hours     AS 時數,
  l.days      AS 天數,
  l.unit,
  l.status,
  l.reason    AS 原因
FROM leave_requests l
JOIN employees e ON e.id = l.employee_id
WHERE l.start_date BETWEEN '2026-04-01' AND '2026-04-30'
  AND e.name IN ('許亦翎','徐宥芯')
ORDER BY l.start_date;
