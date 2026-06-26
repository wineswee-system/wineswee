-- ════════════════════════════════════════════════════════════════════════════
-- 員工「編制內/編制外」欄位
-- 2026-06-26
--
-- 背景：老闆或外部接案者需要用系統，但不應納入薪資計算。
--       新增 in_payroll 旗標讓前端設定，計薪 RPC 據此篩選。
--
-- 設計：
--   in_payroll BOOLEAN NOT NULL DEFAULT TRUE
--     TRUE  → 編制內（預設，現有員工不受影響）
--     FALSE → 編制外（老闆/外包/合約商，不計薪、不寄薪資單）
--
-- idempotent：ADD COLUMN IF NOT EXISTS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS in_payroll BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.employees.in_payroll IS
  '編制內(TRUE)/編制外(FALSE)；FALSE→不納入薪資計算，不寄薪資單';

NOTIFY pgrst, 'reload schema';
