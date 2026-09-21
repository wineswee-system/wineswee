-- ════════════════════════════════════════════════════════════════════════════
-- 補正：費用申請 chain 第 1 關 target_type → applicant_supervisor
-- ────────────────────────────────────────────────────────────────────────────
-- 000003 migration 因 role_name 已被 admin 改名（不再是「直屬主管」）導致 0 rows
-- 改用 step_order=0 + chain category='費用申請' 精確篩出第一關
--
-- 註：原本在 Supabase Studio 直接執行的 hotfix，2026-05-29 回填成 migration 檔
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 暫停 guard trigger（in-flight 單存在仍允許修改，修完後通知正確人員）
ALTER TABLE public.approval_chain_steps DISABLE TRIGGER trg_guard_chain_steps_update;

DO $$
DECLARE
  v_count INT;
BEGIN
  WITH upd AS (
    UPDATE public.approval_chain_steps SET
      target_type       = 'applicant_supervisor',
      target_emp_id     = NULL,
      target_role_id    = NULL,
      target_dept_id    = NULL,
      target_store_id   = NULL,
      target_section_id = NULL
    WHERE step_order = 0
      AND target_type = 'applicant_dept_manager'
      AND chain_id IN (
        SELECT id FROM public.approval_chains WHERE category = '費用申請'
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RAISE NOTICE '[expense_chain_fix_step0] Updated % step(s) → applicant_supervisor', v_count;
  IF v_count = 0 THEN
    RAISE NOTICE '[expense_chain_fix_step0] No rows matched — steps may already be correct or chain config differs';
  END IF;
END $$;

-- 恢復 guard trigger
ALTER TABLE public.approval_chain_steps ENABLE TRIGGER trg_guard_chain_steps_update;

COMMIT;

NOTIFY pgrst, 'reload schema';
