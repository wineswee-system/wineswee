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

COMMIT;

NOTIFY pgrst, 'reload schema';
