-- 更正員工姓名：陳家瑋 → 陳家偉（瑋→偉）
-- 2026-07-06
-- emp id=424（品牌行銷部 經理 / EMP-424 / name_en=Ryan），2026-07-06 到職。
-- 已掃描反正規化名字欄位（各表 employee / supervisor / approved_by / assignee 等）：
--   「陳家瑋」僅存在 employees.name 一處，無其他文字副本（剛到職、無交易記錄）。
-- name_en(Ryan) 不動。idempotent：改過後 WHERE 不再命中。

UPDATE public.employees
SET name = '陳家偉'
WHERE id = 424
  AND name = '陳家瑋';
