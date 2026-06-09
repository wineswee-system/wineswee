-- ════════════════════════════════════════════════════════════════════════════
-- Fix: 20260609131000 加 CHECK 時漏了 section 系列 target_type，
-- 導致現有 row 撞 constraint → seed chains migration 跑不下去。
--
-- 補上 applicant_section_supervisor / specific_section_supervisor。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.approval_chain_steps'::regclass
       AND contype  = 'c'
       AND conname LIKE '%target_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.approval_chain_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT approval_chain_steps_target_type_check CHECK (
    target_type IS NULL OR target_type IN (
      'fixed_emp','fixed_role','fixed_dept',
      'applicant_supervisor','applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
      'specific_dept_manager','specific_store_manager','specific_section_supervisor',
      'transfer_in_store_manager','transfer_out_store_manager',
      'transfer_in_store_supervisor','transfer_out_store_supervisor',
      'warehouse_supervisor'
    )
  );

-- 同步 consistency CHECK：新 dynamic target type 不需要 FK 欄位，
-- 跟 applicant_* 一樣只靠 target_type 解析
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.approval_chain_steps'::regclass
       AND contype  = 'c'
       AND conname LIKE '%target_consistency%'
  LOOP
    EXECUTE format('ALTER TABLE public.approval_chain_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_consistency CHECK (
    target_type IS NULL
    OR (target_type = 'fixed_emp'  AND target_emp_id  IS NOT NULL)
    OR (target_type = 'fixed_role' AND target_role_id IS NOT NULL)
    OR (target_type = 'fixed_dept' AND target_dept_id IS NOT NULL)
    OR (target_type IN (
        'applicant_supervisor','applicant_dept_manager',
        'applicant_store_manager','applicant_section_supervisor',
        -- 商品調撥 dynamic types（從 transfer_requests 反查，不需 FK）
        'transfer_in_store_manager','transfer_out_store_manager',
        'transfer_in_store_supervisor','transfer_out_store_supervisor',
        'warehouse_supervisor'
       ))
    OR (target_type = 'specific_dept_manager'    AND target_dept_id    IS NOT NULL)
    OR (target_type = 'specific_store_manager'   AND target_store_id   IS NOT NULL)
    OR (target_type = 'specific_section_supervisor' AND target_section_id IS NOT NULL)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
