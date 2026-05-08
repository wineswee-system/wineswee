-- ============================================================
-- Hotfix #2：除了 target_type CHECK 外，還有一個
-- approval_chain_steps_target_consistency_chk 在強制 target_type 跟
-- target_*_id 的對應一致性，也用舊 enum 值（'role'/'department'/'employee'/'label'）。
-- 需要一起 drop + 用新 10 種 type 重建。
-- ============================================================

BEGIN;

-- 1. 砍所有相關 CHECK（連 target_consistency_chk 一起）
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.approval_chain_steps'::regclass
      AND contype = 'c'
      AND (conname LIKE '%target_type%' OR conname LIKE '%target_consistency%')
  LOOP
    EXECUTE format('ALTER TABLE public.approval_chain_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 2. 確認 target_type 都是新值（之前 hotfix 應該已 backfill，這裡防一次）
UPDATE public.approval_chain_steps SET target_type =
  CASE target_type
    WHEN 'employee'   THEN 'fixed_emp'
    WHEN 'role'       THEN 'fixed_role'
    WHEN 'department' THEN 'fixed_dept'
    WHEN 'label'      THEN 'fixed_emp'
    ELSE target_type
  END
WHERE target_type IN ('employee', 'role', 'department', 'label');

UPDATE public.approval_chain_steps SET target_type = 'fixed_emp' WHERE target_type IS NULL;

-- 3. 重新上 type CHECK（10 種新值）
ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_type
  CHECK (target_type IN (
    'fixed_emp','fixed_role','fixed_dept',
    'applicant_supervisor','applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
    'specific_dept_manager','specific_store_manager','specific_section_supervisor'
  ));

-- 4. 新 consistency CHECK：每種 type 對應該設哪幾個 target_*_id
ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_consistency
  CHECK (
    -- 寫死指定 → 對應 *_id 必填
    (target_type = 'fixed_emp'  AND target_emp_id  IS NOT NULL)
    OR (target_type = 'fixed_role' AND target_role_id IS NOT NULL)
    OR (target_type = 'fixed_dept' AND target_dept_id IS NOT NULL)
    -- 申請人連動 → 不需設 target_*_id（執行時動態解）
    OR (target_type IN ('applicant_supervisor','applicant_dept_manager',
                        'applicant_store_manager','applicant_section_supervisor'))
    -- 指定單位主管 → 對應的 *_id 必填
    OR (target_type = 'specific_dept_manager'    AND target_dept_id    IS NOT NULL)
    OR (target_type = 'specific_store_manager'   AND target_store_id   IS NOT NULL)
    OR (target_type = 'specific_section_supervisor' AND target_section_id IS NOT NULL)
  );

ALTER TABLE public.approval_chain_steps
  ALTER COLUMN target_type SET NOT NULL,
  ALTER COLUMN target_type SET DEFAULT 'fixed_emp';

NOTIFY pgrst, 'reload schema';

COMMIT;
