-- ============================================================
-- Hotfix：20260508030000 沒考慮 approval_chain_steps.target_type 欄位早就被
-- 20260420020600 建過了（值：'role' / 'department' / 'employee' / 'label'）。
-- 我加新 CHECK 沒涵蓋這些舊值 → 23514。
--
-- 這裡：
--   1. 砍舊 CHECK（如果還在）
--   2. 把舊值 mapping 到新值
--   3. 重新上 CHECK
-- ============================================================

BEGIN;

-- 1. 砍舊 CHECK（multiple possible names — try common ones）
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.approval_chain_steps'::regclass
      AND contype = 'c'
      AND conname LIKE '%target_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.approval_chain_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 2. Backfill 舊值 → 新值
UPDATE public.approval_chain_steps SET target_type =
  CASE target_type
    WHEN 'employee'   THEN 'fixed_emp'
    WHEN 'role'       THEN 'fixed_role'
    WHEN 'department' THEN 'fixed_dept'
    WHEN 'label'      THEN 'fixed_emp'  -- label 是未解析的 placeholder，先當固定員工，admin 再從 UI 改
    ELSE target_type
  END
WHERE target_type IN ('employee', 'role', 'department', 'label');

-- 任何 NULL 也補成 fixed_emp（雖然 030000 已處理，再防一次）
UPDATE public.approval_chain_steps SET target_type = 'fixed_emp' WHERE target_type IS NULL;

-- 3. 重新上 CHECK（涵蓋全部 10 種新值）
ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_type
  CHECK (target_type IN (
    'fixed_emp','fixed_role','fixed_dept',
    'applicant_supervisor','applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
    'specific_dept_manager','specific_store_manager','specific_section_supervisor'
  ));

-- 4. 確保 NOT NULL + DEFAULT（030000 可能 partial fail）
ALTER TABLE public.approval_chain_steps
  ALTER COLUMN target_type SET NOT NULL,
  ALTER COLUMN target_type SET DEFAULT 'fixed_emp';

NOTIFY pgrst, 'reload schema';

COMMIT;
