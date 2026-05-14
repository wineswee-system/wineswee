-- 復活 applicant_supervisor target_type + 改請假 chain 第 1 關
-- 註：5/8 那支 (20260508080000_drop_applicant_supervisor_type) 砍掉了這個 type，
-- 但實際需求是「行政走部門主管 / 門市走店長」需要 employees.supervisor_id 區分。
BEGIN;

-- ═══ 1. 還原 CHECK constraint 加回 applicant_supervisor ═══
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

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_type
  CHECK (target_type IN (
    'fixed_emp','fixed_role','fixed_dept',
    'applicant_supervisor',
    'applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
    'specific_dept_manager','specific_store_manager','specific_section_supervisor'
  ));

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_consistency
  CHECK (
    (target_type = 'fixed_emp'  AND target_emp_id  IS NOT NULL)
    OR (target_type = 'fixed_role' AND target_role_id IS NOT NULL)
    OR (target_type = 'fixed_dept' AND target_dept_id IS NOT NULL)
    OR (target_type IN ('applicant_supervisor','applicant_dept_manager','applicant_store_manager','applicant_section_supervisor'))
    OR (target_type = 'specific_dept_manager'    AND target_dept_id    IS NOT NULL)
    OR (target_type = 'specific_store_manager'   AND target_store_id   IS NOT NULL)
    OR (target_type = 'specific_section_supervisor' AND target_section_id IS NOT NULL)
  );

-- ═══ 2. 改請假 chain 第 1 關 target_type ═══
DO $$
DECLARE
  v_count INT;
BEGIN
  WITH upd AS (
    UPDATE approval_chain_steps SET
      target_type = 'applicant_supervisor',
      target_store_id = NULL,
      target_emp_id = NULL,
      target_dept_id = NULL,
      target_role_id = NULL,
      target_section_id = NULL
    WHERE step_order = 0
      AND target_type IN ('applicant_dept_manager', 'applicant_store_manager')
      AND chain_id IN (
        SELECT chain_id FROM form_chain_configs
         WHERE form_type = 'leave' AND COALESCE(is_active, true) = true
        UNION
        SELECT id FROM approval_chains
         WHERE name LIKE '%請假%' AND COALESCE(is_active, true) = true
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RAISE NOTICE 'Updated % leave-chain step(s) to applicant_supervisor', v_count;
END $$;

COMMIT;
