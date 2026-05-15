-- ════════════════════════════════════════════════════════════
-- DRY RUN ④ 哪些員工是 applicant_* 系列的目標 → 容易踩雷的人
--
-- 用法：Supabase Studio SQL Editor 貼進去跑
-- 不會動任何資料
--
-- 期待結果：
--   列出所有「管部門 / 管門市 / 管組室」的在職員工
--   同時管 2 個以上位子的人 = 高風險（可能連續多關都跳）
--
-- 用 LATERAL + STRING_AGG 處理一人管多個的情況
-- ════════════════════════════════════════════════════════════

SELECT
  e.id,
  e.name                                     AS "姓名",
  e.position                                 AS "職稱",
  d.name                                     AS "所屬部門",
  managed_depts.names                        AS "管理的部門",
  managed_stores.names                       AS "管理的門市",
  managed_sections.names                     AS "管理的組室"
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN LATERAL (
  SELECT STRING_AGG(name, ', ' ORDER BY name) AS names
    FROM departments WHERE manager_id = e.id
) managed_depts ON true
LEFT JOIN LATERAL (
  SELECT STRING_AGG(name, ', ' ORDER BY name) AS names
    FROM stores WHERE manager_id = e.id
) managed_stores ON true
LEFT JOIN LATERAL (
  SELECT STRING_AGG(name, ', ' ORDER BY name) AS names
    FROM department_sections WHERE supervisor_id = e.id
) managed_sections ON true
WHERE e.status = '在職'
  AND (
    managed_depts.names IS NOT NULL
    OR managed_stores.names IS NOT NULL
    OR managed_sections.names IS NOT NULL
  )
ORDER BY e.id;
