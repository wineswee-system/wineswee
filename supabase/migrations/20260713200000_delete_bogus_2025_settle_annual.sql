-- 刪除殘骸假別「2025結算特休」（104 匯入命名不一致的多餘結算列）
-- 2026-07-13  尤致皓年度假勤出現「2025結算特休」1天(已休0),使用者確認刪除。
--   保留:特休假2025結算 / 舊人資系統補休結算(先前指示要留)。
--   僅刪 leave_type 完全等於 '2025結算特休' 者;idempotent(不存在則 0 rows)。

DELETE FROM public.leave_balances
WHERE year = 2026
  AND leave_type = '2025結算特休';
