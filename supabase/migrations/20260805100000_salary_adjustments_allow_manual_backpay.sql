-- salary_adjustments CHECK 補上 manual_backpay(補發前月差額)— 2026-08-05
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:批次記薪後逐筆調整選「補發前月差額」存不進去 —— 報 violates check constraint
--   "salary_adjustments_check"。
-- 根因:前端(SalaryAdjust.jsx)後來加了 source_type='manual_backpay',引擎
--   (payrollAdjustments.js:139)也有處理,但建表當初兩個 CHECK 只允許
--   attendance/leave/overtime/manual_bonus/manual_deduction —— 沒放 manual_backpay。
-- 修法:改「pattern 式」約束,避免每加一種手動自由項就要改一次約束(治本):
--   系統類 attendance/leave/overtime → 需帶 source_id(來自原始出勤/請假/加班);
--   任何 manual_ 開頭 → 人工自由項,source_id 為 null。
--   → 未來前端新增的 manual_xxx 一律 DB 吃得進去,不必再動約束。
--   (⚠️ DB 不擋不代表會生效:要真的影響薪資,payrollAdjustments.js 仍要對該類型加處理分支)
-- 用 DO block 依定義比對名稱 drop 舊的(不怕約束名漂移),再建 pattern 版。冪等可重跑。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.salary_adjustments'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%manual_bonus%'
  LOOP
    EXECUTE format('ALTER TABLE public.salary_adjustments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- 重建:source_type 允許集(系統三類 + 任何 manual_*)
ALTER TABLE public.salary_adjustments
  ADD CONSTRAINT salary_adjustments_source_type_check
  CHECK (source_type IN ('attendance','leave','overtime') OR source_type LIKE 'manual\_%');

-- 重建:source_id 規則(系統類要 source_id、manual_* 為 null)
ALTER TABLE public.salary_adjustments
  ADD CONSTRAINT salary_adjustments_check CHECK (
    (source_type IN ('attendance','leave','overtime') AND source_id IS NOT NULL)
    OR
    (source_type LIKE 'manual\_%' AND source_id IS NULL)
  );
