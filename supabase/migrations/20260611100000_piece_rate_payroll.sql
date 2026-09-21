-- ════════════════════════════════════════════════════════════════════
-- 計件薪資 (piece-rate) 支援 — 2026-06-11
-- ════════════════════════════════════════════════════════════════════
-- 新需求：部分員工是計件制（例如廚房師傅 2000/件），需要：
--   1. 員工分類擴成 4 種：regular(正職門市) / admin(行政) / parttime(兼職) / piece(計件)
--   2. 計件員工：月薪 = 件數 × 單價，不算加班費，勞健保比照 PT 固定級距
--
-- 設計：
--   - salary_structures.employment_category（NULL → 走舊邏輯不動）
--   - salary_structures.piece_rate（每件單價）
--   - salary_structures.current_piece_count（本月件數，計薪前由 HR 手動更新）
--
-- 為什麼 piece_count 放 salary_structures 而不是 payroll_records：
--   每月計薪前，HR 在員工編輯頁更新「本月件數」一次，按下儲存，
--   月底跑批次計薪時自動讀這個值。batch 演算法不需要額外輸入入口。
--   下個月初 HR 再更新一次。簡單暴力但 work。
-- ════════════════════════════════════════════════════════════════════

-- ═══ 1. 員工分類欄位 ═══
ALTER TABLE public.salary_structures
  ADD COLUMN IF NOT EXISTS employment_category VARCHAR(20);

COMMENT ON COLUMN public.salary_structures.employment_category IS
  '員工分類：regular=正職門市(1.34/1.67階梯) / admin=行政(月薪含OT×1) / parttime=兼職 / piece=計件(無OT, 月薪=件數×單價)；NULL→payrollCalc 用 store 工時+isHourly 自動判（舊員工向後相容）';

-- 4 個值之一或 NULL
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'salary_structures' AND constraint_name = 'salary_structures_employment_category_check'
  ) THEN
    ALTER TABLE public.salary_structures
      ADD CONSTRAINT salary_structures_employment_category_check
      CHECK (employment_category IS NULL OR employment_category IN ('regular', 'admin', 'parttime', 'piece'));
  END IF;
END $$;

-- ═══ 2. 計件單價 ═══
ALTER TABLE public.salary_structures
  ADD COLUMN IF NOT EXISTS piece_rate NUMERIC(10, 2) DEFAULT 0;

COMMENT ON COLUMN public.salary_structures.piece_rate IS
  '每件單價（NT$）— 只在 employment_category=piece 時生效，月薪 = current_piece_count × piece_rate';

-- ═══ 3. 本月件數（計薪前 HR 手動更新） ═══
ALTER TABLE public.salary_structures
  ADD COLUMN IF NOT EXISTS current_piece_count INTEGER DEFAULT 0;

COMMENT ON COLUMN public.salary_structures.current_piece_count IS
  '本月計件數 — 每月計薪前由 HR 在員工編輯頁手動更新；batch 計薪自動讀這欄。下個月初再更新一次。';
