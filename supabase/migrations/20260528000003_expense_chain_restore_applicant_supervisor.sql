-- ════════════════════════════════════════════════════════════════════════════
-- 修費用申請 chain「直屬主管」步驟 target_type 錯置問題
-- ────────────────────────────────────────────────────────────────────────────
-- Root cause：
--   20260508080000 把所有 applicant_supervisor → applicant_dept_manager
--   20260519040000 又做了一次同樣轉換（防呆）
--   20260519280000 雖還原 CHECK constraint + function，但沒還原 data row
--
--   結果：費用申請 chain 的第 1 關（直屬主管）仍是 applicant_dept_manager，
--   解析時走 departments.manager_id，導致部門主管收到原本該給直屬主管的通知。
--
-- 修法：
--   把 category IN ('費用申請','費用核銷') 的 chain 裡，
--   role_name='直屬主管' 且 target_type='applicant_dept_manager' 的 row
--   改回 applicant_supervisor（依 employees.supervisor_id / reporting_to 解析）
--
-- 註：原本在 Supabase Studio 直接執行的 hotfix，2026-05-29 回填成 migration 檔
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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
    WHERE role_name = '直屬主管'
      AND target_type = 'applicant_dept_manager'
      AND chain_id IN (
        -- 費用申請 / 費用核銷 chains（含停用的，避免遺漏）
        SELECT id FROM public.approval_chains
         WHERE category IN ('費用申請', '費用核銷')
        UNION
        -- form_chain_configs 掛的 expense_request 鏈
        SELECT chain_id FROM public.form_chain_configs
         WHERE form_type IN ('expense_request', 'expense')
           AND chain_id IS NOT NULL
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RAISE NOTICE '[expense_chain_restore_applicant_supervisor] Updated % step(s) to applicant_supervisor', v_count;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
