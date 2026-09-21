-- 招募職缺可手動排序:新增 sort_order 欄 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:招募職缺列表可上下調整順序,新增候選人的職缺下拉也照此順序。
-- 加 sort_order int,回填現有(每 org 依刊登日新→舊、id 新→舊給序號)。前端 ▲▼ 交換 sort_order。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.recruitment_jobs ADD COLUMN IF NOT EXISTS sort_order integer;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY organization_id
           ORDER BY posted DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.recruitment_jobs
  WHERE sort_order IS NULL
)
UPDATE public.recruitment_jobs r
   SET sort_order = ranked.rn
  FROM ranked
 WHERE r.id = ranked.id;

NOTIFY pgrst, 'reload schema';
