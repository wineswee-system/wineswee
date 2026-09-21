-- 未送驗收費用單「驗收人」對齊現任負責人(部門經理換人/品牌行銷/新莊思源無店長) — 2026-08-07
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:expense_requests.settle_assignee_id 是申請時「凍結」的驗收人,部門經理/門市店長
--   換人不會自動更新 → 已核准未送驗收的單驗收時仍送舊人。
-- 修(經逐筆分析+老闆確認範圍):
--   A. 部門換人(明確):營運部 張庭瑋(62)→周容甄(425) 15筆;財務部 張庭瑋(62)→陳虹(52) 2筆
--   B. 品牌行銷部:陳虹(52)→陳家偉(424) 13筆(老闆確認要改)
--   C. 新莊思源(該店無店長):張庭瑋(62)→營運部主管 周容甄(425) 1筆(#430)
--   其他門市店長類(復興北/威耀/六張犁/高雄富民)未動 — 待確認 stores 店長。
-- 每條帶 settle_assignee_id=舊值 + settled_at IS NULL 守門 → 冪等,不動已結案。
-- dry-run:各組 15/2/13/1 全命中。
-- ════════════════════════════════════════════════════════════════════════════

-- A. 營運部:張庭瑋 → 周容甄
UPDATE public.expense_requests SET settle_assignee_id = 425
 WHERE id IN (436,437,409,438,425,454,433,406,434,368,377,455,447,453,435)
   AND settle_assignee_id = 62 AND settled_at IS NULL;

-- A. 財務部:張庭瑋 → 陳虹
UPDATE public.expense_requests SET settle_assignee_id = 52
 WHERE id IN (450,444)
   AND settle_assignee_id = 62 AND settled_at IS NULL;

-- B. 品牌行銷部:陳虹 → 陳家偉
UPDATE public.expense_requests SET settle_assignee_id = 424
 WHERE id IN (335,336,338,344,321,325,341,373,369,370,389,334,375)
   AND settle_assignee_id = 52 AND settled_at IS NULL;

-- C. 新莊思源(無店長):張庭瑋 → 營運部主管 周容甄
UPDATE public.expense_requests SET settle_assignee_id = 425
 WHERE id = 430
   AND settle_assignee_id = 62 AND settled_at IS NULL;
