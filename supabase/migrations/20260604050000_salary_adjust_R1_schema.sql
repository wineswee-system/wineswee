-- ════════════════════════════════════════════════════════════════
-- R1 — Salary Adjustment Schema
--
-- 純新增：
--   - salary_records 加 status / finalized_at / finalized_by 三欄
--     （既存資料全部 backfill 為 'finalized'，與目前行為一致）
--   - 新表 salary_adjustments：版本化儲存逐筆調整
--   - salary.adjust 權限沿用既有（R0 沒刪）
--
-- 不動：secure_upsert_salary_v2 / Salary.jsx / payroll.js
--
-- 設計：
--   - 透過 salary_record_id FK（CASCADE）綁定批次與員工，「整月草稿砍掉」=
--     DELETE FROM salary_records WHERE month=X AND status='draft' AND org=Y
--     會自動連同 adjustments 一起清掉。
--   - source_type: attendance/leave/overtime → source_id 指向原始紀錄 PK
--                  manual_bonus/manual_deduction → source_id = NULL
--   - 版本化：「修改」 = supersede 舊列 + INSERT 新列
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. salary_records 加 status 欄位（向下相容）───
ALTER TABLE public.salary_records ADD COLUMN IF NOT EXISTS status        TEXT;
ALTER TABLE public.salary_records ADD COLUMN IF NOT EXISTS finalized_at  TIMESTAMPTZ;
ALTER TABLE public.salary_records ADD COLUMN IF NOT EXISTS finalized_by  INT REFERENCES public.employees(id);

-- 既存資料先補 'finalized'
UPDATE public.salary_records SET status = 'finalized' WHERE status IS NULL;

-- 補 DEFAULT + NOT NULL + CHECK
ALTER TABLE public.salary_records ALTER COLUMN status SET DEFAULT 'finalized';
ALTER TABLE public.salary_records ALTER COLUMN status SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_salary_records_status') THEN
    ALTER TABLE public.salary_records
      ADD CONSTRAINT chk_salary_records_status CHECK (status IN ('draft', 'finalized'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_salary_records_status
  ON public.salary_records (organization_id, month, status);

-- ─── 2. salary_adjustments 表 ───
CREATE TABLE IF NOT EXISTS public.salary_adjustments (
  id                SERIAL PRIMARY KEY,
  salary_record_id  INT NOT NULL REFERENCES public.salary_records(id) ON DELETE CASCADE,
  employee_id       INT NOT NULL REFERENCES public.employees(id),
  source_type       TEXT NOT NULL
                       CHECK (source_type IN ('attendance','leave','overtime','manual_bonus','manual_deduction')),
  source_id         INT,
  field             TEXT NOT NULL,
  original_value    JSONB,
  new_value         JSONB,
  reason            TEXT,                                    -- 選填
  created_by        INT REFERENCES public.employees(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at     TIMESTAMPTZ,                             -- NULL = active
  superseded_by_id  INT REFERENCES public.salary_adjustments(id),
  CHECK (
    (source_type IN ('attendance','leave','overtime') AND source_id IS NOT NULL)
    OR
    (source_type IN ('manual_bonus','manual_deduction') AND source_id IS NULL)
  )
);

-- 唯一約束：同一 salary_record 內同源紀錄的同欄位同時只能 1 個 active
CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_adjustments_active_source
  ON public.salary_adjustments (salary_record_id, source_type, source_id, field)
  WHERE superseded_at IS NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_salary_adjustments_record
  ON public.salary_adjustments (salary_record_id);
CREATE INDEX IF NOT EXISTS idx_salary_adjustments_employee
  ON public.salary_adjustments (employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_adjustments_creator
  ON public.salary_adjustments (created_by);
CREATE INDEX IF NOT EXISTS idx_salary_adjustments_active
  ON public.salary_adjustments (salary_record_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_salary_adjustments_created
  ON public.salary_adjustments (created_at DESC);

COMMENT ON TABLE public.salary_adjustments IS
  '薪資逐筆人工調整 — 版本化（superseded_at IS NULL = active）；原始 attendance/leave/overtime 永不變動';
COMMENT ON COLUMN public.salary_adjustments.source_type IS
  'attendance / leave / overtime / manual_bonus / manual_deduction';
COMMENT ON COLUMN public.salary_adjustments.field IS
  '被調的邏輯欄：late_minutes / ot_hours_weekday / ot_hours_holiday / leave_days / leave_pay_mode / amount';

ALTER TABLE public.salary_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_salary_adjustments" ON public.salary_adjustments;
CREATE POLICY "allow_all_salary_adjustments" ON public.salary_adjustments
  FOR ALL USING (true) WITH CHECK (true);

-- ─── 3. 確保 salary.adjust 權限存在 + super_admin 已授權 ───
INSERT INTO public.permissions (code, name, module)
VALUES ('salary.adjust', '逐筆調整薪資', '人資')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 1, p.id FROM public.permissions p WHERE p.code = 'salary.adjust'
ON CONFLICT DO NOTHING;

COMMIT;

DO $$
DECLARE
  v_draft_cnt    INT;
  v_finalized_cnt INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status = 'draft'),
         COUNT(*) FILTER (WHERE status = 'finalized')
  INTO v_draft_cnt, v_finalized_cnt
  FROM public.salary_records;
  RAISE NOTICE 'R1: salary_records 共 % 筆 (draft=% finalized=%)，salary_adjustments 表已建立',
    v_draft_cnt + v_finalized_cnt, v_draft_cnt, v_finalized_cnt;
END $$;

NOTIFY pgrst, 'reload schema';
