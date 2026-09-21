-- ════════════════════════════════════════════════════════════════════════════
-- Backfill：給商品調撥 3 條 chain 補 category 欄位
--
-- 之前 seed 時沒帶 category，前端做不到按分類 filter（申請/驗收分頁）。
-- 補：
--   '商品調撥-申請-倉↔門市'   → category='商品調撥-申請'
--   '商品調撥-申請-門市↔門市' → category='商品調撥-申請'
--   '商品調撥-驗收'           → category='商品調撥-驗收'
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.approval_chains
   SET category = '商品調撥-申請'
 WHERE name LIKE '商品調撥-申請-%'
   AND (category IS NULL OR category = '');

UPDATE public.approval_chains
   SET category = '商品調撥-驗收'
 WHERE name = '商品調撥-驗收'
   AND (category IS NULL OR category = '');

COMMIT;

NOTIFY pgrst, 'reload schema';
