-- ============================================================
-- 20260705200000_ledger_type.sql
-- F-A6 多帳本欄位（PLAN_fin-tax-inv_2026-07-04 一/F-A6）
--
-- journal_entries 加 ledger_type（財務帳 vs 稅務帳）。
-- 本次僅補資料模型：預設「財務」；稅務帳報表為後續工作，
-- 先保留欄位不做報表（依計畫定案）。
--
-- 冪等：可重複執行。
-- ============================================================

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS ledger_type TEXT DEFAULT '財務';

-- CHECK 約束分開補（重跑時 ADD COLUMN IF NOT EXISTS 不會重建約束）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'journal_entries_ledger_type_check'
      AND conrelid = 'public.journal_entries'::regclass
  ) THEN
    ALTER TABLE public.journal_entries
      ADD CONSTRAINT journal_entries_ledger_type_check
      CHECK (ledger_type IN ('財務', '稅務'));
  END IF;
END $$;

COMMENT ON COLUMN public.journal_entries.ledger_type IS
  '帳本別（F-A6 多帳本）：財務＝財務帳（預設）、稅務＝稅務帳；稅務帳報表為後續工作，欄位先就位';

-- 報表帳本篩選用部分索引（查詢固定帶 organization_id + ledger_type）
CREATE INDEX IF NOT EXISTS journal_entries_org_ledger_type_idx
  ON public.journal_entries (organization_id, ledger_type)
  WHERE ledger_type IS NOT NULL;

NOTIFY pgrst, 'reload schema';
